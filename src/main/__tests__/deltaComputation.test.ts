/**
 * AREA 2 — Logic correctness of applyDelta / computeDelta / shouldSendDelta
 *
 * Covers:
 *  - shouldSendDelta (pure function in deltaUtils.ts)
 *  - applyDelta in the metricsStore Zustand (in-place merge with Immer)
 *  - computeDelta in the metricsWorker (verified via renderer push events)
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

// ── shouldSendDelta — pure function, imported directly ──────────────────────
import { shouldSendDelta } from '../deltaUtils'

// ── Mock electron / worker dependencies ─────────────────────────────────────
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn() }))
vi.mock('../store/dbCustomFields', () => ({ getAllCustomFields: vi.fn(() => ({})) }))
vi.mock('../store/serverStore')
vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({ retentionMinutes: 60 }))
}))
vi.mock('../store/metricsRepository', () => ({
  cleanup: vi.fn(),
  findLastNBulk: vi.fn(() => ({})),
  batchSave: vi.fn()
}))
vi.mock('../collectors/agCollector', () => ({
  detectAndSyncReplicaRoles: vi.fn(() => Promise.resolve([]))
}))

import { BrowserWindow } from 'electron'
import { collectMetrics } from '../collectors/sqlCollector'
import { startWorker, __resetForTests } from '../metricsWorker'
import { useMetricsStore } from '../../renderer/src/store/metricsStore'
import type { ServerMetrics } from '../collectors/types'

// ── Factory helpers ──────────────────────────────────────────────────────────

type DbSpec = { name: string; sizeMb?: number; logSizeMb?: number; stateDesc?: string }

function makeMetrics(dbs: DbSpec[] = []): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: '2019', edition: 'Dev', memoryUsedMb: 100,
      memoryTargetMb: 200, cpuUsagePercent: 10, uptimeDays: 1, logicalCpus: 8, physicalCpus: 4
    },
    databases: dbs.map((d) => ({
      name: d.name,
      stateDesc: d.stateDesc ?? 'ONLINE',
      recoveryModel: 'FULL',
      sizeMb: d.sizeMb ?? 100,
      logSizeMb: d.logSizeMb ?? 10,
      compatibilityLevel: 150,
      isEncrypted: false,
      isReadOnly: false,
      owner: 'sa',
      createDate: '2020-01-01T00:00:00.000Z'
    })),
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: []
  }
}

// ── Reset Zustand store between tests ──────────────────────────────────────

const STORE_RESET = { metricsMap: {}, lastUpdate: null, serverHealth: {} }

// ═══════════════════════════════════════════════════════════════════════════════
// shouldSendDelta — pure function
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 2 — shouldSendDelta (hybrid threshold)', () => {

  it('true if changed ≤ 5, regardless of total', () => {
    expect(shouldSendDelta(0, 1_000)).toBe(true)
    expect(shouldSendDelta(3, 1_000)).toBe(true)
    expect(shouldSendDelta(5, 1_000)).toBe(true)   // inclusive boundary
  })

  it('false if changed = 6 and total = 10 (60% > 20%)', () => {
    expect(shouldSendDelta(6, 10)).toBe(false)
  })

  it('true if changed/total ≤ 0.20 (20%)', () => {
    expect(shouldSendDelta(20, 100)).toBe(true)    // exactly 20%
    expect(shouldSendDelta(10, 100)).toBe(true)    // 10%
    expect(shouldSendDelta(19, 100)).toBe(true)    // 19%
  })

  it('false if changed > 5 AND changed/total > 0.20', () => {
    expect(shouldSendDelta(21, 100)).toBe(false)   // 21%
    expect(shouldSendDelta(11, 30)).toBe(false)    // 36.7%
    expect(shouldSendDelta(6, 20)).toBe(false)     // 30%
  })

  it('removedDbs included in changed count: 4 changed + 3 removed > threshold when total is low', () => {
    // changed=7 (4+3), total=8 → 87.5% > 20% and 7 > 5 → false
    expect(shouldSendDelta(7, 8)).toBe(false)
  })

  it('does not throw on total=0: 0 changed → true (≤ 5)', () => {
    expect(shouldSendDelta(0, 0)).toBe(true)
  })

  it('does not throw on total=0: 6 changed → false (> 5 and total=0 skips percentage)', () => {
    expect(shouldSendDelta(6, 0)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// applyDelta — metricsStore (Zustand + Immer)
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 2 — applyDelta (metricsStore)', () => {

  const SID = '10.0.0.1:1433'

  beforeEach(() => {
    useMetricsStore.setState(STORE_RESET)
  })

  it('removes DBs in removedDbs from the existing databases array', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics([
      { name: 'DB_A' }, { name: 'DB_B' }, { name: 'DB_C' }
    ]))

    useMetricsStore.getState().applyDelta(SID, {
      ...makeMetrics([{ name: 'DB_A' }]),
      isDelta: true,
      removedDbs: ['DB_B', 'DB_C']
    } as ServerMetrics)

    const names = useMetricsStore.getState().metricsMap[SID].databases.map((d) => d.name)
    expect(names).toEqual(['DB_A'])
    expect(names).not.toContain('DB_B')
    expect(names).not.toContain('DB_C')
  })

  it('updates changed DBs in-place (matched by name, not by index)', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics([
      { name: 'DB_A', sizeMb: 100 },
      { name: 'DB_B', sizeMb: 200 }
    ]))

    useMetricsStore.getState().applyDelta(SID, {
      ...makeMetrics([{ name: 'DB_A', sizeMb: 999 }]),
      isDelta: true
    } as ServerMetrics)

    const dbs = useMetricsStore.getState().metricsMap[SID].databases
    expect(dbs.find((d) => d.name === 'DB_A')?.sizeMb).toBe(999)
    expect(dbs.find((d) => d.name === 'DB_B')?.sizeMb).toBe(200)  // unchanged
  })

  it('adds new DBs not present in prev without removing existing ones', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics([{ name: 'DB_A' }]))

    useMetricsStore.getState().applyDelta(SID, {
      ...makeMetrics([{ name: 'DB_NEW', sizeMb: 50 }]),
      isDelta: true
    } as ServerMetrics)

    const names = useMetricsStore.getState().metricsMap[SID].databases.map((d) => d.name)
    expect(names).toContain('DB_A')
    expect(names).toContain('DB_NEW')
  })

  it('clears isDelta and removedDbs from the store after the merge (no stale metadata)', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics([{ name: 'DB_A' }]))

    useMetricsStore.getState().applyDelta(SID, {
      ...makeMetrics([{ name: 'DB_A', sizeMb: 200 }]),
      isDelta: true,
      removedDbs: []
    } as ServerMetrics)

    const stored = useMetricsStore.getState().metricsMap[SID] as unknown as Record<string, unknown>
    expect(stored['isDelta']).toBeUndefined()
    expect(stored['removedDbs']).toBeUndefined()
  })

  it('isDelta:false (full refresh) replaces the entire databases array', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics([
      { name: 'OLD_DB_1' }, { name: 'OLD_DB_2' }
    ]))

    const fresh = makeMetrics([{ name: 'ONLY_NEW' }])
    useMetricsStore.getState().applyDelta(SID, { ...fresh, isDelta: false } as ServerMetrics)

    const names = useMetricsStore.getState().metricsMap[SID].databases.map((d) => d.name)
    expect(names).toEqual(['ONLY_NEW'])
    expect(names).not.toContain('OLD_DB_1')
  })

  it('applyDelta on a server not yet in metricsMap sets the entire snapshot', () => {
    // SID does not exist in store yet
    const delta = { ...makeMetrics([{ name: 'DB_X' }]), isDelta: true } as ServerMetrics
    useMetricsStore.getState().applyDelta('99.99.99.99:1433', delta)

    const m = useMetricsStore.getState().metricsMap['99.99.99.99:1433']
    expect(m).toBeDefined()
    expect(m.databases[0].name).toBe('DB_X')
  })
})

// ── drainJobCycle ─────────────────────────────────────────────────────────────

/**
 * Drains the microtask queue enough for one complete async job cycle and
 * advances the batch flush timer (BATCH_FLUSH_MS = 50 ms) so the coalesced
 * IPC push is emitted. The advance is small enough not to trigger any poll
 * interval (shortest is INTERVAL_ACTIVE_MS = 60 s).
 */
async function drainJobCycle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  vi.advanceTimersByTime(60)
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

// ═══════════════════════════════════════════════════════════════════════════════
// computeDelta — testato tramite eventi pushToRenderer
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 2 — computeDelta (via push eventi al renderer)', () => {

  beforeEach(() => {
    vi.useFakeTimers()
    __resetForTests()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
    vi.mocked(collectMetrics).mockReset()
  })

  afterEach(() => {
    __resetForTests()
    vi.useRealTimers()
  })

  it('removedDbs contiene esattamente i DB presenti in prev ma assenti in fresh', async () => {
    const pushed: { channel: string; data: unknown }[] = []
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        isVisible: () => true,
        webContents: { send: (ch: string, d: unknown) => pushed.push({ channel: ch, data: d }) }
      } as unknown as Electron.BrowserWindow
    ])

    const prevMetrics = makeMetrics([
      { name: 'DB_KEEP' }, { name: 'DB_GONE_1' }, { name: 'DB_GONE_2' }
    ])
    const freshMetrics = makeMetrics([{ name: 'DB_KEEP' }])

    // First collect: establishes the prev (sends full)
    vi.mocked(collectMetrics).mockResolvedValueOnce(prevMetrics)
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // hang after first
    startWorker({ intervalSeconds: 60, servers: [{ ip: '10.0.0.1', port: 1433, useWindowsAuth: true }] })
    await drainJobCycle()
    pushed.length = 0  // reset capture

    // Seconda collect: 2 DB rimossi → deve comparire in removedDbs
    vi.mocked(collectMetrics).mockResolvedValueOnce(freshMetrics)
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // hang after second
    vi.advanceTimersByTime(300_001)  // INTERVAL_IDLE_MS = 300_000
    await drainJobCycle()

    const evt = pushed.find((m) => m.channel === 'metrics:batchUpdated')
    const batch = evt?.data as Array<{ serverId: string; metrics: ServerMetrics }>
    const payload = batch?.[0]
    expect(payload?.metrics?.removedDbs).toEqual(
      expect.arrayContaining(['DB_GONE_1', 'DB_GONE_2'])
    )
    expect(payload?.metrics?.removedDbs).toHaveLength(2)
  })

  it('first collect always sends full (isDelta undefined or false)', async () => {
    const pushed: { channel: string; data: unknown }[] = []
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        isVisible: () => true,
        webContents: { send: (ch: string, d: unknown) => pushed.push({ channel: ch, data: d }) }
      } as unknown as Electron.BrowserWindow
    ])

    vi.mocked(collectMetrics).mockResolvedValueOnce(makeMetrics([{ name: 'DB_A' }]))
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // hang after first
    startWorker({ intervalSeconds: 60, servers: [{ ip: '10.0.0.1', port: 1433, useWindowsAuth: true }] })
    await drainJobCycle()

    const evt = pushed.find((m) => m.channel === 'metrics:batchUpdated')
    const batch = evt?.data as Array<{ serverId: string; metrics: ServerMetrics }>
    // First collect: no isDelta
    expect(batch?.[0]?.metrics?.isDelta).toBeFalsy()
  })

  it('no DB changed → isDelta:true with empty databases array', async () => {
    const pushed: { channel: string; data: unknown }[] = []
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        isVisible: () => true,
        webContents: { send: (ch: string, d: unknown) => pushed.push({ channel: ch, data: d }) }
      } as unknown as Electron.BrowserWindow
    ])

    const metrics = makeMetrics([{ name: 'DB_A', sizeMb: 100 }])

    // First collect
    vi.mocked(collectMetrics).mockResolvedValueOnce(metrics)
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
    startWorker({ intervalSeconds: 60, servers: [{ ip: '10.0.0.1', port: 1433, useWindowsAuth: true }] })
    await drainJobCycle()
    pushed.length = 0

    // Identical second collect → no changed fields
    vi.mocked(collectMetrics).mockResolvedValueOnce(metrics)
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
    vi.advanceTimersByTime(300_001)  // INTERVAL_IDLE_MS = 300_000
    await drainJobCycle()

    const evt = pushed.find((m) => m.channel === 'metrics:batchUpdated')
    const batch = evt?.data as Array<{ serverId: string; metrics: ServerMetrics }>
    const payload = batch?.[0]
    expect(payload?.metrics?.isDelta).toBe(true)
    expect(payload?.metrics?.databases).toHaveLength(0)
  })
})
