import { describe, it, expect, beforeEach } from 'vitest'
import { useMetricsStore } from '../store/metricsStore'
import type { ServerMetrics, ServerHealthPayload } from '../../../preload/index'

// ── Factory helpers ───────────────────────────────────────────────────────────

function makeInstanceInfo(overrides: Partial<ServerMetrics['instanceInfo']> = {}) {
  return {
    version: '15.0.1',
    edition: 'Dev',
    memoryUsedMb: 200,
    memoryTargetMb: 1000,
    cpuUsagePercent: 25,
    uptimeDays: 7,
    logicalCpus: 4,
    physicalCpus: 2,
    ...overrides
  }
}

function makeMetrics(overrides: Partial<ServerMetrics> = {}): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: makeInstanceInfo(),
    databases: [],
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: [],
    ...overrides
  }
}

const RESET = {
  metricsMap: {},
  summaries: {},
  historyMap: {},
  activeServerId: null,
  lastUpdate: null,
  serverHealth: {}
}

beforeEach(() => {
  useMetricsStore.setState(RESET)
})

// ── setMetrics ────────────────────────────────────────────────────────────────

describe('setMetrics', () => {
  const SID = '10.0.0.1:1433'

  it('populates metricsMap with the provided snapshot', () => {
    const m = makeMetrics()
    useMetricsStore.getState().setMetrics(SID, m)
    expect(useMetricsStore.getState().metricsMap[SID]).toBe(m)
  })

  it('builds a summary from the snapshot', () => {
    const m = makeMetrics({
      instanceInfo: makeInstanceInfo({ cpuUsagePercent: 75, memoryUsedMb: 800, memoryTargetMb: 1000 })
    })
    useMetricsStore.getState().setMetrics(SID, m)
    const summary = useMetricsStore.getState().summaries[SID]
    expect(summary.cpuUsagePercent).toBe(75)
    expect(summary.memoryUsedMb).toBe(800)
  })

  it('appends a history point for CPU', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics())
    expect(useMetricsStore.getState().historyMap[SID].cpu).toHaveLength(1)
  })

  it('sets lastUpdate', () => {
    expect(useMetricsStore.getState().lastUpdate).toBeNull()
    useMetricsStore.getState().setMetrics(SID, makeMetrics())
    expect(useMetricsStore.getState().lastUpdate).not.toBeNull()
  })

  it('caps CPU history at 10 points (MAX_HISTORY_IDLE) for non-active server', () => {
    for (let i = 0; i < 15; i++) {
      useMetricsStore.getState().setMetrics(SID, makeMetrics({ collectedAt: new Date(i * 1000) }))
    }
    expect(useMetricsStore.getState().historyMap[SID].cpu).toHaveLength(10)
  })

  it('caps CPU history at 60 points (MAX_HISTORY_ACTIVE) for the active server', () => {
    useMetricsStore.getState().setActiveServerId(SID)
    for (let i = 0; i < 65; i++) {
      useMetricsStore.getState().setMetrics(SID, makeMetrics({ collectedAt: new Date(i * 1000) }))
    }
    expect(useMetricsStore.getState().historyMap[SID].cpu).toHaveLength(60)
  })
})

// ── setActiveServerId ─────────────────────────────────────────────────────────

describe('setActiveServerId', () => {
  it('sets and clears activeServerId', () => {
    useMetricsStore.getState().setActiveServerId('srv1')
    expect(useMetricsStore.getState().activeServerId).toBe('srv1')
    useMetricsStore.getState().setActiveServerId(null)
    expect(useMetricsStore.getState().activeServerId).toBeNull()
  })
})

// ── evictFullMetrics ──────────────────────────────────────────────────────────

describe('evictFullMetrics', () => {
  const SID = '10.0.0.2:1433'

  it('removes the full metrics entry from metricsMap', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics())
    expect(useMetricsStore.getState().metricsMap[SID]).toBeDefined()
    useMetricsStore.getState().evictFullMetrics(SID)
    expect(useMetricsStore.getState().metricsMap[SID]).toBeUndefined()
  })

  it('leaves summary and history intact', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics())
    useMetricsStore.getState().evictFullMetrics(SID)
    expect(useMetricsStore.getState().summaries[SID]).toBeDefined()
    expect(useMetricsStore.getState().historyMap[SID]).toBeDefined()
  })
})

// ── deleteServerData ──────────────────────────────────────────────────────────

describe('deleteServerData', () => {
  const SID = '10.0.0.3:1433'

  it('removes all data for a server', () => {
    useMetricsStore.getState().setMetrics(SID, makeMetrics())
    useMetricsStore.getState().setServerHealth({ serverId: SID, failCount: 1, nextRetry: 0, lastSuccess: null })
    useMetricsStore.getState().deleteServerData(SID)
    const s = useMetricsStore.getState()
    expect(s.metricsMap[SID]).toBeUndefined()
    expect(s.summaries[SID]).toBeUndefined()
    expect(s.historyMap[SID]).toBeUndefined()
    expect(s.serverHealth[SID]).toBeUndefined()
  })
})

// ── resetHistory ──────────────────────────────────────────────────────────────

describe('resetHistory', () => {
  it('clears history for a specific server', () => {
    const SID = '10.0.0.4:1433'
    useMetricsStore.getState().setMetrics(SID, makeMetrics())
    useMetricsStore.getState().resetHistory(SID)
    expect(useMetricsStore.getState().historyMap[SID]).toEqual({ cpu: [], memory: [] })
  })

  it('clears history for all servers when called without argument', () => {
    const SID_A = '10.0.0.5:1433'
    const SID_B = '10.0.0.6:1433'
    useMetricsStore.getState().setMetrics(SID_A, makeMetrics())
    useMetricsStore.getState().setMetrics(SID_B, makeMetrics())
    useMetricsStore.getState().resetHistory()
    expect(useMetricsStore.getState().historyMap[SID_A]).toEqual({ cpu: [], memory: [] })
    expect(useMetricsStore.getState().historyMap[SID_B]).toEqual({ cpu: [], memory: [] })
  })
})

// ── setServerHealth ───────────────────────────────────────────────────────────

describe('setServerHealth', () => {
  it('stores health keyed by serverId', () => {
    const health: ServerHealthPayload = {
      serverId: '10.0.0.7:1433',
      failCount: 3,
      nextRetry: Date.now() + 5000,
      lastSuccess: null
    }
    useMetricsStore.getState().setServerHealth(health)
    expect(useMetricsStore.getState().serverHealth['10.0.0.7:1433']).toEqual(health)
  })

  it('overwrites previous health for the same server', () => {
    const SID = '10.0.0.8:1433'
    useMetricsStore
      .getState()
      .setServerHealth({ serverId: SID, failCount: 1, nextRetry: 0, lastSuccess: null })
    useMetricsStore
      .getState()
      .setServerHealth({ serverId: SID, failCount: 0, nextRetry: 0, lastSuccess: Date.now() })
    expect(useMetricsStore.getState().serverHealth[SID].failCount).toBe(0)
  })
})

// ── seedFromHistory ───────────────────────────────────────────────────────────

describe('seedFromHistory', () => {
  it('populates metricsMap with the latest snapshot', () => {
    const SID = '10.0.0.9:1433'
    const m1 = makeMetrics({ collectedAt: new Date('2024-01-01') })
    const m2 = makeMetrics({ collectedAt: new Date('2024-01-02') })
    useMetricsStore.getState().seedFromHistory({ [SID]: [m1, m2] })
    expect(useMetricsStore.getState().metricsMap[SID]).toBe(m2)
  })

  it('builds historyMap ring buffers', () => {
    const SID = '10.0.0.10:1433'
    const snapshots = Array.from({ length: 5 }, (_, i) =>
      makeMetrics({ collectedAt: new Date(i * 60_000) })
    )
    useMetricsStore.getState().seedFromHistory({ [SID]: snapshots })
    expect(useMetricsStore.getState().historyMap[SID].cpu).toHaveLength(5)
  })

  it('caps to MAX_HISTORY_IDLE=10 for non-active server', () => {
    const SID = '10.0.0.11:1433'
    const snapshots = Array.from({ length: 20 }, (_, i) =>
      makeMetrics({ collectedAt: new Date(i * 60_000) })
    )
    useMetricsStore.getState().seedFromHistory({ [SID]: snapshots })
    expect(useMetricsStore.getState().historyMap[SID].cpu).toHaveLength(10)
  })

  it('ignores empty history arrays', () => {
    const SID = '10.0.0.12:1433'
    useMetricsStore.getState().seedFromHistory({ [SID]: [] })
    expect(useMetricsStore.getState().metricsMap[SID]).toBeUndefined()
  })

  it('sets lastUpdate when data is provided', () => {
    useMetricsStore.getState().seedFromHistory({ 'x:1433': [makeMetrics()] })
    expect(useMetricsStore.getState().lastUpdate).not.toBeNull()
  })
})

// ── applyDeltaBatch ───────────────────────────────────────────────────────────

describe('applyDeltaBatch', () => {
  it('processes multiple servers in a single call', () => {
    const SID_A = 'A:1433'
    const SID_B = 'B:1433'
    useMetricsStore.getState().applyDeltaBatch([
      { serverId: SID_A, metrics: makeMetrics({ instanceInfo: makeInstanceInfo({ cpuUsagePercent: 10 }) }) },
      { serverId: SID_B, metrics: makeMetrics({ instanceInfo: makeInstanceInfo({ cpuUsagePercent: 80 }) }) }
    ])
    expect(useMetricsStore.getState().summaries[SID_A].cpuUsagePercent).toBe(10)
    expect(useMetricsStore.getState().summaries[SID_B].cpuUsagePercent).toBe(80)
  })

  it('applies a delta update on an existing server', () => {
    const SID = 'C:1433'
    const db = {
      name: 'DB_A',
      stateDesc: 'ONLINE' as const,
      recoveryModel: 'FULL',
      sizeMb: 100,
      logSizeMb: 10,
      compatibilityLevel: 150,
      isEncrypted: false,
      isReadOnly: false,
      owner: 'sa',
      createDate: '2020-01-01'
    }
    useMetricsStore.getState().setMetrics(SID, makeMetrics({ databases: [db] }))
    useMetricsStore.getState().applyDeltaBatch([
      {
        serverId: SID,
        metrics: {
          ...makeMetrics({ databases: [{ ...db, sizeMb: 999 }] }),
          isDelta: true
        }
      }
    ])
    const updatedDb = useMetricsStore.getState().metricsMap[SID].databases.find((d) => d.name === 'DB_A')
    expect(updatedDb?.sizeMb).toBe(999)
  })

  it('sets lastUpdate after batch', () => {
    useMetricsStore.getState().applyDeltaBatch([{ serverId: 'D:1433', metrics: makeMetrics() }])
    expect(useMetricsStore.getState().lastUpdate).not.toBeNull()
  })
})
