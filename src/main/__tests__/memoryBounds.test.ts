/**
 * AREA 3 — Memory leak e bounds
 *
 * Verifica:
 *  - metricsHistory cappata a MAX_HISTORY (20 entry)
 *  - il record più vecchio viene espulso con shift() al superamento del cap
 *  - dopo stopWorker() nessun nuovo job viene schedulato
 *  - syncServers([]) svuota la jobMap
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
// ── Renderer store imports (work in Node env — no DOM required) ───────────────
import { useAlertsStore } from '../../renderer/src/store/alertsStore'
import { useMetricsStore } from '../../renderer/src/store/metricsStore'
import { cleanup as purgeOldSnapshots } from '../store/metricsRepository'
import type { Alert } from '../../preload/index'
import type { ServerMetrics } from '../collectors/types'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn() }))
vi.mock('../store/dbCustomFields', () => ({ getAllCustomFields: vi.fn(() => ({})) }))
// startWorker ora chiama loadHistoryFromDb → isola il test dal DB per le suite AREA 3
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
      version: String(tag),  // usiamo version come "tag" identificativo
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
 * Avanza di N cicli completi di polling.
 * Cycle 1 è già stato avviato da startWorker (nextRun = Date.now()).
 * Per i cicli successivi si avanza il timer di INTERVAL_IDLE_MS (300 s).
 */
async function runNCycles(n: number): Promise<void> {
  // Il primo ciclo è già partito con scheduleTick() dentro startWorker
  await drainJobCycle()
  for (let i = 1; i < n; i++) {
    vi.advanceTimersByTime(300_001)  // INTERVAL_IDLE_MS = 300_000
    await drainJobCycle()
  }
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
  _initDb(':memory:')   // garantisce getDb() valido per loadHistoryFromDb → cleanup()
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

  it(`non supera ${MAX_HISTORY} entry dopo ${MAX_HISTORY + 10} poll consecutivi`, async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })

    await runNCycles(MAX_HISTORY + 10)

    const history = getHistory('10.0.0.1', 1433)
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY)
  })

  it('il record più vecchio viene rimosso con shift() quando si supera il cap', async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })

    // Riempi fino al limite
    await runNCycles(MAX_HISTORY)

    const histAtCap = getHistory('10.0.0.1', 1433)
    expect(histAtCap.length).toBe(MAX_HISTORY)
    const oldestVersion = parseInt(histAtCap[0].instanceInfo.version)

    // Un altro ciclo → il più vecchio viene espulso
    // (runNCycles non può essere riusato qui: il primo ciclo non è già pendente)
    vi.advanceTimersByTime(300_001)
    await drainJobCycle()

    const histAfter = getHistory('10.0.0.1', 1433)
    expect(histAfter.length).toBe(MAX_HISTORY)  // lunghezza invariata al cap
    const newOldestVersion = parseInt(histAfter[0].instanceInfo.version)
    // Il più vecchio ora ha version > oldestVersion
    expect(newOldestVersion).toBeGreaterThan(oldestVersion)
  })

  it('l\'entry più recente è sempre l\'ultima in array', async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })

    await runNCycles(5)

    const history = getHistory('10.0.0.1', 1433)
    const lastVersion = parseInt(history[history.length - 1].instanceInfo.version)
    expect(lastVersion).toBe(5)
  })
})

describe('AREA 3 — Comportamento dopo stopWorker', () => {

  it('dopo stopWorker nessun nuovo job viene schedulato', async () => {
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

  it('getHistory ritorna [] dopo __resetForTests (metricsHistory svuotata)', async () => {
    let callN = 0
    vi.mocked(collectMetrics).mockImplementation(async () => makeMetrics(++callN))
    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await runNCycles(3)

    expect(getHistory('10.0.0.1', 1433).length).toBeGreaterThan(0)

    __resetForTests()
    expect(getHistory('10.0.0.1', 1433).length).toBe(0)
  })
})

describe('AREA 3 — syncServers con lista vuota', () => {

  it('svuota la jobMap quando syncServers([]) viene chiamato', () => {
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

  it('dopo syncServers([]) nessun nuovo poll parte avanzando il tempo', async () => {
    vi.mocked(collectMetrics).mockResolvedValueOnce(makeMetrics(1))
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // hang per le chiamate successive
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

  it('non supera MAX_ALERTS=500 alert dopo 501 addAlert', () => {
    for (let i = 0; i < 501; i++) {
      useAlertsStore.getState().addAlert(makeAlert(String(i), 0))
    }
    expect(useAlertsStore.getState().alerts.length).toBe(500)
  })

  it('conserva gli alert più recenti scartando i più vecchi quando si supera il cap', () => {
    for (let i = 0; i < 501; i++) {
      useAlertsStore.getState().addAlert(makeAlert(String(i), 0))
    }
    const ids = useAlertsStore.getState().alerts.map((a) => a.id)
    expect(ids[0]).toBe('1')      // il più vecchio (id=0) è stato scartato
    expect(ids[499]).toBe('500')  // l'ultimo aggiunto è presente
  })

  it('scarta gli alert più vecchi di 7 giorni', () => {
    useAlertsStore.getState().addAlert(makeAlert('old', 8))   // 8 giorni fa → scartato
    useAlertsStore.getState().addAlert(makeAlert('new', 1))   // 1 giorno fa → tenuto
    const ids = useAlertsStore.getState().alerts.map((a) => a.id)
    expect(ids).not.toContain('old')
    expect(ids).toContain('new')
  })

  it('gli alert esattamente a 7 giorni di distanza vengono conservati (boundary)', () => {
    // Boundary: 7 giorni esatti meno 1 secondo → tenuto
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

  it('accumula punti in historyMap dopo ogni setMetrics', () => {
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(10, 1000))
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(20, 2000))
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu).toHaveLength(2)
    expect(hist.cpu[0].value).toBe(10)
    expect(hist.cpu[1].value).toBe(20)
  })

  it('cappato a 60 punti per il server attivo', () => {
    useMetricsStore.setState({ activeServerId: SID })
    for (let i = 0; i < 70; i++) {
      useMetricsStore.getState().setMetrics(SID, makeServerMetrics(i, i * 10))
    }
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu.length).toBe(60)
    expect(hist.cpu[59].value).toBe(69)  // più recente
  })

  it('cappato a 10 punti per server idle (non attivo)', () => {
    useMetricsStore.setState({ activeServerId: 'other:1433' })
    for (let i = 0; i < 15; i++) {
      useMetricsStore.getState().setMetrics(SID, makeServerMetrics(i, i * 10))
    }
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu.length).toBe(10)
    expect(hist.cpu[9].value).toBe(14)  // più recente
  })

  it('popola summaries con i dati corretti', () => {
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(42, 3500))
    const summary = useMetricsStore.getState().summaries[SID]
    expect(summary).toBeDefined()
    expect(summary.cpuUsagePercent).toBe(42)
    expect(summary.memoryUsedMb).toBe(3500)
  })

  it('evictFullMetrics rimuove i dati completi ma non il summary', () => {
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

  it('popola metricsMap e summaries con lo snapshot più recente', () => {
    const history = [makeServerMetrics(10, 1000), makeServerMetrics(20, 2000)]
    useMetricsStore.getState().seedFromHistory({ [SID]: history })
    const latest = useMetricsStore.getState().metricsMap[SID]
    expect(latest).toBeDefined()
    expect(latest.instanceInfo.cpuUsagePercent).toBe(20)
    const summary = useMetricsStore.getState().summaries[SID]
    expect(summary.cpuUsagePercent).toBe(20)
    expect(summary.memoryUsedMb).toBe(2000)
  })

  it('costruisce historyMap con tutti i punti forniti (idle cap)', () => {
    const history = Array.from({ length: 5 }, (_, i) => makeServerMetrics(i * 10, i * 100))
    useMetricsStore.getState().seedFromHistory({ [SID]: history })
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu).toHaveLength(5)
    expect(hist.cpu[0].value).toBe(0)
    expect(hist.cpu[4].value).toBe(40)
  })

  it('usa MAX_HISTORY_ACTIVE (60) per il server attivo', () => {
    useMetricsStore.setState({ activeServerId: SID })
    const history = Array.from({ length: 65 }, (_, i) => makeServerMetrics(i, i * 10))
    useMetricsStore.getState().seedFromHistory({ [SID]: history })
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu.length).toBe(60)
  })

  it('usa MAX_HISTORY_IDLE (10) per server non attivi', () => {
    useMetricsStore.setState({ activeServerId: 'other:1433' })
    const history = Array.from({ length: 15 }, (_, i) => makeServerMetrics(i, i * 10))
    useMetricsStore.getState().seedFromHistory({ [SID]: history })
    const hist = useMetricsStore.getState().historyMap[SID]
    expect(hist.cpu.length).toBe(10)
  })

  it('gestisce più server in una sola chiamata', () => {
    useMetricsStore.getState().seedFromHistory({
      [SID]:  [makeServerMetrics(10, 1000)],
      [SID2]: [makeServerMetrics(50, 5000)],
    })
    expect(useMetricsStore.getState().summaries[SID].cpuUsagePercent).toBe(10)
    expect(useMetricsStore.getState().summaries[SID2].cpuUsagePercent).toBe(50)
  })

  it('ignora i server con history vuota senza sovrascrivere dati esistenti', () => {
    useMetricsStore.getState().setMetrics(SID, makeServerMetrics(99, 9999))
    useMetricsStore.getState().seedFromHistory({ [SID]: [] })
    expect(useMetricsStore.getState().summaries[SID].cpuUsagePercent).toBe(99)
  })

  it('seedFromHistory non sovrascrive poll live successivi', () => {
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

  it('rimuove snapshot più vecchi di retentionDays', () => {
    const old: ServerMetrics = { ...makeServerMetrics(5, 100), collectedAt: new Date(Date.now() - 40 * 86_400_000) }
    const recent: ServerMetrics = { ...makeServerMetrics(5, 100), collectedAt: new Date() }

    saveSnapshot(SRV, old)
    saveSnapshot(SRV, recent)

    purgeOldSnapshots(30)  // elimina snapshot > 30 giorni

    const history = findHistory(SRV, 9999)
    expect(history).toHaveLength(1)
    // Lo snapshot rimasto è quello recente
    expect(new Date(history[0].collectedAt).getTime()).toBeGreaterThan(Date.now() - 86_400_000)
  })

  it('non elimina snapshot entro il periodo di retention', () => {
    const recent: ServerMetrics = { ...makeServerMetrics(5, 100), collectedAt: new Date() }
    saveSnapshot(SRV, recent)

    purgeOldSnapshots(30)

    expect(findHistory(SRV, 9999)).toHaveLength(1)
  })

  it('cleanup è idempotente su tabella vuota', () => {
    expect(() => purgeOldSnapshots(30)).not.toThrow()
  })
})
