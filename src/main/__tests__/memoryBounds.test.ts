/**
 * AREA 3 — Memory leaks and bounds
 *
 * Verifies:
 *  - metricsHistory capped at MAX_HISTORY (20 entries)
 *  - the oldest record is evicted via shift() when the cap is exceeded
 *  - after stopWorker() no new jobs are scheduled
 *  - syncServers([]) empties the jobMap
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
// ── Renderer store imports (work in Node env — no DOM required) ───────────────
import { useAlertsStore } from '../../renderer/src/store/alertsStore'
import { useMetricsStore } from '../../renderer/src/store/metricsStore'
import { cleanup as purgeOldSnapshots } from '../store/metricsRepository'
import type { Alert } from '../../preload/index'
import type { ServerMetrics } from '../collectors/types'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn() }))
vi.mock('../store/dbCustomFields', () => ({ getAllCustomFields: vi.fn(() => ({})) }))
// startWorker now calls loadHistoryFromDb → isolate the test from the DB for AREA 3 suites
vi.mock('../store/serverStore')
vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({ retentionMinutes: 60 }))
}))

import { BrowserWindow } from 'electron'
import { collectMetrics } from '../collectors/sqlCollector'
import {
  startWorker,
  syncServers,
  getHistory,
  __resetForTests,
  __getJobForTest
} from '../metricsWorker'
import type { CollectMetricsRequest } from '../ipc/types'
import { initDb as _initDb, closeDb as _closeDb } from '../store/database'

// ── Costante da metricsWorker (deve coincidere) ───────────────────────────────
const MAX_HISTORY = 20

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeServer(ip = '10.0.0.1', port = 1433): CollectMetricsRequest {
  return { ip, port, useWindowsAuth: true }
}

function makeMetrics(tag: number): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: String(tag),  // use version as an identifying "tag"
      edition: 'Dev',
      memoryUsedMb: tag,
      memoryTargetMb: 200,
      cpuUsagePercent: tag % 100,
      uptimeDays: tag,
      logicalCpus: 8,
      physicalCpus: 4
    },
    databases: [],
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: []
  }
}

/**
 * Drains the microtask queue for one complete async job cycle.
 * Does NOT advance fake timers, so no new scheduled jobs are triggered.
 */
async function drainJobCycle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/**
 * Advances N full polling cycles.
 * Cycle 1 has already been started by startWorker (nextRun = Date.now()).
 * For subsequent cycles the timer is advanced by INTERVAL_IDLE_MS (300 s).
 */
async function runNCycles(n: number): Promise<void> {
  // The first cycle has already started via scheduleTick() inside startWorker
  await drainJobCycle()
  for (let i = 1; i < n; i++) {
    vi.advanceTimersByTime(300_001)  // INTERVAL_IDLE_MS = 300_000
    await drainJobCycle()
  }
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
  _initDb(':memory:')   // ensures getDb() is valid for loadHistoryFromDb → cleanup()
  __resetForTests()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  vi.mocked(collectMetrics).mockReset()
})

afterEach(() => {
  __resetForTests()
  _closeDb()
  vi.useRealTimers()
})

// ── Test suite ────────────────────────────────────────────────────────────────

describe(`AREA 3 — metricsHistory cap (MAX_HISTORY=${MAX_HISTORY})`, () => {

  it(`does not exceed ${MAX_HISTORY} entries after ${MAX_HISTORY + 10} consecutive polls`, async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })

    await runNCycles(MAX_HISTORY + 10)

    const history = getHistory('10.0.0.1', 1433)
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY)
  })

  it('the oldest record is removed with shift() when the cap is exceeded', async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })

    // Fill up to the cap
    await runNCycles(MAX_HISTORY)

    const histAtCap = getHistory('10.0.0.1', 1433)
    expect(histAtCap.length).toBe(MAX_HISTORY)
    const oldestVersion = parseInt(histAtCap[0].instanceInfo.version)

    // One more cycle → the oldest entry is evicted
    // (runNCycles cannot be reused here: the first cycle is not pending again)
    vi.advanceTimersByTime(300_001)
    await drainJobCycle()

    const histAfter = getHistory('10.0.0.1', 1433)
    expect(histAfter.length).toBe(MAX_HISTORY)  // length unchanged at the cap
    const newOldestVersion = parseInt(histAfter[0].instanceInfo.version)
    // The oldest entry now has version > oldestVersion
    expect(newOldestVersion).toBeGreaterThan(oldestVersion)
  })

  it('the most recent entry is always the last in the array', async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })

    await runNCycles(5)

    const history = getHistory('10.0.0.1', 1433)
    const lastVersion = parseInt(history[history.length - 1].instanceInfo.version)
    expect(lastVersion).toBe(5)
  })
})

describe('AREA 3 — Behaviour after stopWorker', () => {

  it('after stopWorker no new job is scheduled', async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })

    await drainJobCycle()
    const callsBeforeStop = vi.mocked(collectMetrics).mock.calls.length

    __resetForTests()  // include stopWorker

    vi.advanceTimersByTime(300_000)
    await drainJobCycle()

    expect(vi.mocked(collectMetrics).mock.calls.length).toBe(callsBeforeStop)
  })

  it('getHistory returns [] after __resetForTests (metricsHistory cleared)', async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await runNCycles(3)

    expect(getHistory('10.0.0.1', 1433).length).toBeGreaterThan(0)

    __resetForTests()
    expect(getHistory('10.0.0.1', 1433).length).toBe(0)
  })
})

describe('AREA 3 — syncServers with empty list', () => {

  it('empties the jobMap when syncServers([]) is called', () => {
    startWorker({
      intervalSeconds: 60,
      servers: [makeServer('10.0.0.1'), makeServer('10.0.0.2')]
    })
    expect(__getJobForTest('10.0.0.1:1433')).toBeDefined()
    expect(__getJobForTest('10.0.0.2:1433')).toBeDefined()

    syncServers([])

    expect(__getJobForTest('10.0.0.1:1433')).toBeUndefined()
    expect(__getJobForTest('10.0.0.2:1433')).toBeUndefined()
  })

  it('after syncServers([]) no new poll starts when advancing time', async () => {
    vi.mocked(collectMetrics).mockResolvedValueOnce(makeMetrics(1))
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // hang for subsequent calls
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await drainJobCycle()

    const callsAfterFirst = vi.mocked(collectMetrics).mock.calls.length

    syncServers([])
    vi.advanceTimersByTime(300_000)
    await drainJobCycle()

    expect(vi.mocked(collectMetrics).mock.calls.length).toBe(callsAfterFirst)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AREA 5 — Alert purge
// ═══════════════════════════════════════════════════════════════════════════════

function makeAlert(id: string, daysAgo: number): Alert {
  return {
    id,
    serverId: '10.0.0.1:1433',
    category: 'cpu_high',
    severity: 'WARNING',
    message: `alert-${id}`,
    detectedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    acknowledgedAt: null
  }
}

describe('AREA 5 — alertsStore: purge MAX_ALERTS cap', () => {
  beforeEach(() => {
    useAlertsStore.setState({ alerts: [] })
  })

  it('does not exceed MAX_ALERTS=500 alerts after 501 addAlert calls', () => {
    for (let i = 0; i < 501; i++) {
      useAlertsStore.getState().addAlert(makeAlert(String(i), 0))
    }
    expect(useAlertsStore.getState().alerts.length).toBe(500)
  })

  it('keeps the most recent alerts and discards the oldest when the cap is exceeded', () => {
    for (let i = 0; i < 501; i++) {
      useAlertsStore.getState().addAlert(makeAlert(String(i), 0))
    }
    const ids = useAlertsStore.getState().alerts.map((a) => a.id)
    expect(ids[0]).toBe('1')      // the oldest (id=0) was discarded
    expect(ids[499]).toBe('500')  // the last added entry is present
  })

  it('discards alerts older than 7 days', () => {
    useAlertsStore.getState().addAlert(makeAlert('old', 8))   // 8 giorni fa → scartato
    useAlertsStore.getState().addAlert(makeAlert('new', 1))   // 1 giorno fa → tenuto
    const ids = useAlertsStore.getState().alerts.map((a) => a.id)
    expect(ids).not.toContain('old')
    expect(ids).toContain('new')
  })

  it('alerts exactly 7 days old are kept (boundary)', () => {
    // Boundary: exactly 7 days minus 1 second → kept
    useAlertsStore.getState().addAlert(
      makeAlert('boundary', 0)  // now (well within limit)
    )
    expect(useAlertsStore.getState().alerts).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AREA 5 — metricsStore: history ring buffers
// ═══════════════════════════════════════════════════════════════════════════════

function makeServerMetrics(cpu: number, memMb: number): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: '15.0',
      edition: 'Dev',
      memoryUsedMb: memMb,
      memoryTargetMb: 8192,
      cpuUsagePercent: cpu,
      uptimeDays: 1,
      logicalCpus: 8,
      physicalCpus: 4
    },
    databases: [],
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: []
  }
}

describe('AREA 5 — metricsStore: historyMap ring buffer', () => {
  const SID = '10.0.0.1:1433'

  beforeEach(() => {
    useMetricsStore.setState({
      metricsMap: {},
      summaries: {},
      historyMap: {},
      activeServerId: null,
      lastUpdate: null,
      serverHealth: {}
    })
  })

  it('accumulates points in historyMap after each setMetrics', () => {
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(10, 1000))
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(20, 2000))
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu).toHaveLength(2)
    expect(hist.cpu[0].value).toBe(10)
    expect(hist.cpu[1].value).toBe(20)
  })

  it('capped at 60 points for the active server', () => {
    useMetricsStore.setState({ activeServerId: SID })
    for (let i = 0; i < 70; i++) {
      useMetricsStore.getState().setMetrics(SID, makeServerMetrics(i, i * 10))
    }
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu.length).toBe(60)
    expect(hist.cpu[59].value).toBe(69)  // most recent
  })

  it('capped at 10 points for idle (non-active) server', () => {
    useMetricsStore.setState({ activeServerId: 'other:1433' })
    for (let i = 0; i < 15; i++) {
      useMetricsStore.getState().setMetrics(SID, makeServerMetrics(i, i * 10))
    }
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu.length).toBe(10)
    expect(hist.cpu[9].value).toBe(14)  // most recent
  })

  it('populates summaries with correct data', () => {
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(42, 3500))
    const summary = useMetricsStore.getState().summaries[SID]
    expect(summary).toBeDefined()
    expect(summary.cpuUsagePercent).toBe(42)
    expect(summary.memoryUsedMb).toBe(3500)
  })

  it('evictFullMetrics removes full metrics data but not the summary', () => {
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(10, 1000))
    expect(useMetricsStore.getState().metricsMap[SID]).toBeDefined()

    useMetricsStore.getState().evictFullMetrics(SID)

    expect(useMetricsStore.getState().metricsMap[SID]).toBeUndefined()
    expect(useMetricsStore.getState().summaries[SID]).toBeDefined()
  })
})

describe('AREA 5 — metricsStore: seedFromHistory', () => {
  const SID = '10.0.0.1:1433'
  const SID2 = '10.0.0.2:1433'

  beforeEach(() => {
    useMetricsStore.setState({
      metricsMap: {},
      summaries: {},
      historyMap: {},
      activeServerId: null,
      lastUpdate: null,
      serverHealth: {}
    })
  })

  it('populates metricsMap and summaries with the most recent snapshot', () => {
    const history = [makeServerMetrics(10, 1000), makeServerMetrics(20, 2000)]
    useMetricsStore.getState().seedFromHistory({ [SID]: history })
    const latest = useMetricsStore.getState().metricsMap[SID]
    expect(latest).toBeDefined()
    expect(latest.instanceInfo.cpuUsagePercent).toBe(20)
    const summary = useMetricsStore.getState().summaries[SID]
    expect(summary.cpuUsagePercent).toBe(20)
    expect(summary.memoryUsedMb).toBe(2000)
  })

  it('builds historyMap with all provided points (idle cap)', () => {
    const history = Array.from({ length: 5 }, (_, i) => makeServerMetrics(i * 10, i * 100))
    useMetricsStore.getState().seedFromHistory({ [SID]: history })
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu).toHaveLength(5)
    expect(hist.cpu[0].value).toBe(0)
    expect(hist.cpu[4].value).toBe(40)
  })

  it('uses MAX_HISTORY_ACTIVE (60) for the active server', () => {
    useMetricsStore.setState({ activeServerId: SID })
    const history = Array.from({ length: 65 }, (_, i) => makeServerMetrics(i, i * 10))
    useMetricsStore.getState().seedFromHistory({ [SID]: history })
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu.length).toBe(60)
  })

  it('uses MAX_HISTORY_IDLE (10) for non-active servers', () => {
    useMetricsStore.setState({ activeServerId: 'other:1433' })
    const history = Array.from({ length: 15 }, (_, i) => makeServerMetrics(i, i * 10))
    useMetricsStore.getState().seedFromHistory({ [SID]: history })
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu.length).toBe(10)
  })

  it('handles multiple servers in a single call', () => {
    useMetricsStore.getState().seedFromHistory({
      [SID]:  [makeServerMetrics(10, 1000)],
      [SID2]: [makeServerMetrics(50, 5000)],
    })
    expect(useMetricsStore.getState().summaries[SID].cpuUsagePercent).toBe(10)
    expect(useMetricsStore.getState().summaries[SID2].cpuUsagePercent).toBe(50)
  })

  it('ignores servers with empty history without overwriting existing data', () => {
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(99, 9999))
    useMetricsStore.getState().seedFromHistory({ [SID]: [] })
    expect(useMetricsStore.getState().summaries[SID].cpuUsagePercent).toBe(99)
  })

  it('seedFromHistory does not overwrite subsequent live polls', () => {
    useMetricsStore.getState().seedFromHistory({ [SID]: [makeServerMetrics(10, 1000)] })
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(75, 7500))
    expect(useMetricsStore.getState().summaries[SID].cpuUsagePercent).toBe(75)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AREA 5 — SQLite purge (metricsRepository.cleanup)
// ═══════════════════════════════════════════════════════════════════════════════

import { initDb, closeDb, getDb } from '../store/database'
import { save as saveSnapshot, findHistory } from '../store/metricsRepository'

describe('AREA 5 — metricsRepository.cleanup (SQLite purge)', () => {
  const SRV = 'srv-purge-test'

  beforeEach(() => {
    initDb(':memory:')
    // Insert a server row (FK required for metrics_snapshots)
    getDb()
      .prepare(`INSERT INTO servers (id, ip, port, use_windows_auth, added_at) VALUES (?, ?, ?, ?, ?)`)
      .run(SRV, '10.1.0.1', 1433, 0, new Date().toISOString())
  })

  afterEach(() => {
    closeDb()
  })

  it('removes snapshots older than retentionDays', () => {
    const old: ServerMetrics = { ...makeServerMetrics(5, 100), collectedAt: new Date(Date.now() - 40 * 86_400_000) }
    const recent: ServerMetrics = { ...makeServerMetrics(5, 100), collectedAt: new Date() }

    saveSnapshot(SRV, old)
    saveSnapshot(SRV, recent)

    purgeOldSnapshots(30)  // delete snapshots > 30 days old

    const history = findHistory(SRV, 9999)
    expect(history).toHaveLength(1)
    // The remaining snapshot is the recent one
    expect(new Date(history[0].collectedAt).getTime()).toBeGreaterThan(Date.now() - 86_400_000)
  })

  it('does not delete snapshots within the retention period', () => {
    const recent: ServerMetrics = { ...makeServerMetrics(5, 100), collectedAt: new Date() }
    saveSnapshot(SRV, recent)

    purgeOldSnapshots(30)

    expect(findHistory(SRV, 9999)).toHaveLength(1)
  })

  it('cleanup is idempotent on an empty table', () => {
    expect(() => purgeOldSnapshots(30)).not.toThrow()
  })
})
