/**
 * AREA 2 — Correttezza logica applyDelta / computeDelta / shouldSendDelta
 *
 * Copre:
 *  - shouldSendDelta (funzione pura in deltaUtils.ts)
 *  - applyDelta nel metricsStore Zustand (merge in-place con Immer)
 *  - computeDelta nel metricsWorker (verifica tramite push eventi al renderer)
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

// ── shouldSendDelta — pura, importata direttamente ──────────────────────────
import { shouldSendDelta } from '../deltaUtils'

// ── Mock electron / dipendenze del worker ───────────────────────────────────
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn() }))
vi.mock('../store/dbCustomFields', () => ({ getAllCustomFields: vi.fn(() => ({})) }))

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
      memoryTargetMb: 200, cpuUsagePercent: 10, uptimeDays: 1
    },
    databases: dbs.map((d) => ({
      name: d.name,
      stateDesc: d.stateDesc ?? 'ONLINE',
      recoveryModel: 'FULL',
      sizeMb: d.sizeMb ?? 100,
      logSizeMb: d.logSizeMb ?? 10
    })),
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: []
  }
}

// ── Reset store Zustand tra i test ───────────────────────────────────────────

const STORE_RESET = { metricsMap: {}, lastUpdate: null, serverHealth: {} }

// ═══════════════════════════════════════════════════════════════════════════════
// shouldSendDelta — funzione pura
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 2 — shouldSendDelta (soglia ibrida)', () => {

  it('true se changed ≤ 5, indipendentemente dal totale', () => {
    expect(shouldSendDelta(0, 1_000)).toBe(true)
    expect(shouldSendDelta(3, 1_000)).toBe(true)
    expect(shouldSendDelta(5, 1_000)).toBe(true)   // boundary inclusivo
  })

  it('false se changed = 6 e total = 10 (60% > 20%)', () => {
    expect(shouldSendDelta(6, 10)).toBe(false)
  })

  it('true se changed/total ≤ 0.20 (20%)', () => {
    expect(shouldSendDelta(20, 100)).toBe(true)    // esatto 20%
    expect(shouldSendDelta(10, 100)).toBe(true)    // 10%
    expect(shouldSendDelta(19, 100)).toBe(true)    // 19%
  })

  it('false se changed > 5 E changed/total > 0.20', () => {
    expect(shouldSendDelta(21, 100)).toBe(false)   // 21%
    expect(shouldSendDelta(11, 30)).toBe(false)    // 36.7%
    expect(shouldSendDelta(6, 20)).toBe(false)     // 30%
  })

  it('removedDbs inclusi nel conteggio changed: 4 changed + 3 removed > soglia se total basso', () => {
    // changed=7 (4+3), total=8 → 87.5% > 20% e 7 > 5 → false
    expect(shouldSendDelta(7, 8)).toBe(false)
  })

  it('non lancia su total=0: 0 changed → true (≤ 5)', () => {
    expect(shouldSendDelta(0, 0)).toBe(true)
  })

  it('non lancia su total=0: 6 changed → false (> 5 e total=0 salta la percentuale)', () => {
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

  it('rimuove i DB in removedDbs dall\'array databases esistente', () => {
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

  it('aggiorna in-place i DB cambiati (match per name, non per index)', () => {
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
    expect(dbs.find((d) => d.name === 'DB_B')?.sizeMb).toBe(200)  // invariato
  })

  it('aggiunge nuovi DB non presenti nel prev senza rimuovere gli esistenti', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics([{ name: 'DB_A' }]))

    useMetricsStore.getState().applyDelta(SID, {
      ...makeMetrics([{ name: 'DB_NEW', sizeMb: 50 }]),
      isDelta: true
    } as ServerMetrics)

    const names = useMetricsStore.getState().metricsMap[SID].databases.map((d) => d.name)
    expect(names).toContain('DB_A')
    expect(names).toContain('DB_NEW')
  })

  it('cancella isDelta e removedDbs dallo store dopo il merge (no stale metadata)', () => {
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

  it('isDelta:false (full refresh) sostituisce l\'intero array databases', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics([
      { name: 'OLD_DB_1' }, { name: 'OLD_DB_2' }
    ]))

    const fresh = makeMetrics([{ name: 'ONLY_NEW' }])
    useMetricsStore.getState().applyDelta(SID, { ...fresh, isDelta: false } as ServerMetrics)

    const names = useMetricsStore.getState().metricsMap[SID].databases.map((d) => d.name)
    expect(names).toEqual(['ONLY_NEW'])
    expect(names).not.toContain('OLD_DB_1')
  })

  it('applyDelta su server non presente in metricsMap imposta l\'intero snapshot', () => {
    // SID non esiste ancora in store
    const delta = { ...makeMetrics([{ name: 'DB_X' }]), isDelta: true } as ServerMetrics
    useMetricsStore.getState().applyDelta('99.99.99.99:1433', delta)

    const m = useMetricsStore.getState().metricsMap['99.99.99.99:1433']
    expect(m).toBeDefined()
    expect(m.databases[0].name).toBe('DB_X')
  })
})

// ── drainJobCycle ─────────────────────────────────────────────────────────────

/**
 * Drains the microtask queue enough for one complete async job cycle.
 * Does NOT advance fake timers, so no new scheduled jobs are triggered.
 */
async function drainJobCycle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
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
        webContents: { send: (ch: string, d: unknown) => pushed.push({ channel: ch, data: d }) }
      } as unknown as Electron.BrowserWindow
    ])

    const prevMetrics = makeMetrics([
      { name: 'DB_KEEP' }, { name: 'DB_GONE_1' }, { name: 'DB_GONE_2' }
    ])
    const freshMetrics = makeMetrics([{ name: 'DB_KEEP' }])

    // Prima collect: stabilisce il prev (invia full)
    vi.mocked(collectMetrics).mockResolvedValueOnce(prevMetrics)
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // hang after first
    startWorker({ intervalSeconds: 60, servers: [{ ip: '10.0.0.1', port: 1433, useWindowsAuth: true }] })
    await drainJobCycle()
    pushed.length = 0  // reset cattura

    // Seconda collect: 2 DB rimossi → deve comparire in removedDbs
    vi.mocked(collectMetrics).mockResolvedValueOnce(freshMetrics)
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // hang after second
    vi.advanceTimersByTime(300_001)  // INTERVAL_IDLE_MS = 300_000
    await drainJobCycle()

    const evt = pushed.find((m) => m.channel === 'metrics:updated')
    const payload = evt?.data as { serverId: string; metrics: ServerMetrics }
    expect(payload?.metrics?.removedDbs).toEqual(
      expect.arrayContaining(['DB_GONE_1', 'DB_GONE_2'])
    )
    expect(payload?.metrics?.removedDbs).toHaveLength(2)
  })

  it('prima collect invia sempre full (isDelta undefined o false)', async () => {
    const pushed: { channel: string; data: unknown }[] = []
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { send: (ch: string, d: unknown) => pushed.push({ channel: ch, data: d }) }
      } as unknown as Electron.BrowserWindow
    ])

    vi.mocked(collectMetrics).mockResolvedValueOnce(makeMetrics([{ name: 'DB_A' }]))
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // hang after first
    startWorker({ intervalSeconds: 60, servers: [{ ip: '10.0.0.1', port: 1433, useWindowsAuth: true }] })
    await drainJobCycle()

    const evt = pushed.find((m) => m.channel === 'metrics:updated')
    const payload = evt?.data as { metrics: ServerMetrics }
    // Prima collect: nessun isDelta
    expect(payload?.metrics?.isDelta).toBeFalsy()
  })

  it('nessun DB cambiato → isDelta:true con databases array vuoto', async () => {
    const pushed: { channel: string; data: unknown }[] = []
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { send: (ch: string, d: unknown) => pushed.push({ channel: ch, data: d }) }
      } as unknown as Electron.BrowserWindow
    ])

    const metrics = makeMetrics([{ name: 'DB_A', sizeMb: 100 }])

    // Prima collect
    vi.mocked(collectMetrics).mockResolvedValueOnce(metrics)
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
    startWorker({ intervalSeconds: 60, servers: [{ ip: '10.0.0.1', port: 1433, useWindowsAuth: true }] })
    await drainJobCycle()
    pushed.length = 0

    // Seconda collect identica → nessun changed
    vi.mocked(collectMetrics).mockResolvedValueOnce(metrics)
    vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
    vi.advanceTimersByTime(300_001)  // INTERVAL_IDLE_MS = 300_000
    await drainJobCycle()

    const evt = pushed.find((m) => m.channel === 'metrics:updated')
    const payload = evt?.data as { metrics: ServerMetrics }
    expect(payload?.metrics?.isDelta).toBe(true)
    expect(payload?.metrics?.databases).toHaveLength(0)
  })
})
