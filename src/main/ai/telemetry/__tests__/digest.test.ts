import { describe, it, expect } from 'vitest'
import {
  buildDigest,
  computeWaitDeltas,
  computeBaseline,
  detectAnomalies,
  extractFeatures
} from '../digest'
import type { ServerMetrics, WaitStatInfo } from '../../../collectors/types'

function snap(over: {
  waits?: [string, number][]
  blocked?: number
  blockedWaitMs?: number
  uptimeDays?: number
  offline?: string[]
  diskFreePct?: number
}): ServerMetrics {
  const waits: WaitStatInfo[] = (over.waits ?? []).map(([waitType, waitTimeMs]) => ({
    waitType,
    waitTimeMs,
    maxWaitTimeMs: 0,
    signalWaitTimeMs: 0,
    waitingTasksCount: 0,
    waitPercent: 0
  }))
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: '16',
      edition: 'Dev',
      memoryUsedMb: 1000,
      memoryTargetMb: 2000,
      cpuUsagePercent: 10,
      uptimeDays: over.uptimeDays ?? 10,
      logicalCpus: 4,
      physicalCpus: 2
    },
    databases: [
      { name: 'master', stateDesc: 'ONLINE', recoveryModel: 'SIMPLE', sizeMb: 1, logSizeMb: 1 },
      ...(over.offline ?? []).map((name) => ({
        name,
        stateDesc: 'SUSPECT',
        recoveryModel: 'FULL',
        sizeMb: 1,
        logSizeMb: 1
      }))
    ],
    activeSessions: Array.from({ length: over.blocked ?? 0 }, (_, i) => ({
      sessionId: 60 + i,
      status: 'suspended',
      blockingSessionId: 55,
      waitType: 'LCK_M_X',
      waitTimeMs: over.blockedWaitMs ?? 1000,
      cpuTime: 0,
      logicalReads: 0
    })),
    topQueries: [],
    backupStatus: [],
    waitStats: waits,
    diskVolumes: [
      {
        volume_mount_point: 'E:\\',
        logical_volume_name: 'data',
        total_gb: 100,
        free_gb: over.diskFreePct ?? 50,
        used_gb: 100 - (over.diskFreePct ?? 50),
        free_pct: over.diskFreePct ?? 50
      }
    ],
    databaseFiles: []
  }
}

const agg = (cpuAvg: number, cpuMax = cpuAvg) => ({
  snapshotCount: 12,
  cpuAvg,
  cpuMax,
  memPctAvg: 70
})

describe('computeWaitDeltas', () => {
  it('uses the delta within the hour, not the cumulative totals', () => {
    const first = snap({
      waits: [
        ['CXPACKET', 1_000_000],
        ['LCK_M_X', 100]
      ]
    })
    const last = snap({
      waits: [
        ['CXPACKET', 1_000_100],
        ['LCK_M_X', 900_100]
      ]
    })
    const d = computeWaitDeltas(first, last)
    expect(d[0].waitType).toBe('LCK_M_X')
    expect(d[0].pct).toBeGreaterThan(90)
  })

  it('falls back to the last snapshot after a restart (negative delta)', () => {
    const first = snap({ waits: [['CXPACKET', 1_000_000]] })
    const last = snap({
      waits: [
        ['CXPACKET', 500],
        ['WRITELOG', 1500]
      ]
    })
    const d = computeWaitDeltas(first, last)
    expect(d.map((w) => w.waitType)).toEqual(['WRITELOG', 'CXPACKET'])
  })

  it('ignores benign waits', () => {
    const first = snap({ waits: [['SLEEP_TASK', 0]] })
    const last = snap({ waits: [['SLEEP_TASK', 9_999_999]] })
    expect(computeWaitDeltas(first, last)).toEqual([])
  })
})

describe('anomaly detection', () => {
  const quiet = extractFeatures([snap({}), snap({})], agg(20), [], [])

  it('uses absolute thresholds without baseline', () => {
    expect(detectAnomalies(quiet, null).flags).toEqual([])
    const hot = extractFeatures([snap({})], agg(85, 97), [], [])
    expect(detectAnomalies(hot, null).flags).toContain('cpu_spike')
  })

  it('is relative to the server baseline', () => {
    const f = extractFeatures([snap({})], agg(80), [], [])
    const busyServer = {
      samples: 20,
      cpuAvgMedian: 75,
      blockingMaxMedian: 0,
      usualWaits: [],
      sameHourOfDay: true
    }
    const idleServer = { ...busyServer, cpuAvgMedian: 10 }
    expect(detectAnomalies(f, busyServer).flags).not.toContain('cpu_spike')
    expect(detectAnomalies(f, idleServer).flags).toContain('cpu_spike')
  })

  it('flags blocking, offline dbs, low disk, restarts and critical alerts', () => {
    const f = extractFeatures(
      [
        snap({ uptimeDays: 10 }),
        snap({
          blocked: 5,
          blockedWaitMs: 45_000,
          uptimeDays: 0.01,
          offline: ['Sales'],
          diskFreePct: 4
        })
      ],
      agg(30),
      [{ severity: 'critical', category: 'blocking', message: 'Blocking chain' }],
      []
    )
    const { flags, score } = detectAnomalies(f, null)
    expect(flags).toEqual(
      expect.arrayContaining(['blocking', 'db_offline', 'disk_low', 'restart', 'critical_alert'])
    )
    expect(score).toBeGreaterThanOrEqual(10)
  })

  it('flags a dominant wait type that is not usual for the server', () => {
    const f = extractFeatures(
      [snap({ waits: [['PAGEIOLATCH_SH', 0]] }), snap({ waits: [['PAGEIOLATCH_SH', 50_000]] })],
      agg(20),
      [],
      []
    )
    const b = {
      samples: 20,
      cpuAvgMedian: 20,
      blockingMaxMedian: 0,
      usualWaits: ['CXPACKET', 'WRITELOG'],
      sameHourOfDay: false
    }
    expect(detectAnomalies(f, b).flags).toContain('unusual_wait')
  })
})

describe('computeBaseline', () => {
  it('prefers the same hour of day when there are enough samples (seasonality)', () => {
    const hist = []
    for (let d = 1; d <= 6; d++) {
      // ogni notte alle 02:00 c'è il backup → CPU 70%; il resto della giornata 10%
      hist.push({ bucketStart: new Date(2026, 10, d, 2), cpuAvg: 70, blockingMax: 0, topWaits: [] })
      hist.push({
        bucketStart: new Date(2026, 10, d, 15),
        cpuAvg: 10,
        blockingMax: 0,
        topWaits: []
      })
    }
    const at2am = computeBaseline(hist, new Date(2026, 10, 7, 2))!
    expect(at2am.sameHourOfDay).toBe(true)
    expect(at2am.cpuAvgMedian).toBe(70)
    const at3pm = computeBaseline(hist, new Date(2026, 10, 7, 15))!
    expect(at3pm.cpuAvgMedian).toBe(10)
  })
})

describe('buildDigest', () => {
  it('renders a compact, LLM-readable line with anomalies and incident root cause', () => {
    const d = buildDigest({
      serverId: 's1',
      serverLabel: 'prod01:1433',
      bucketStart: new Date(2026, 10, 12, 14),
      bucketEnd: new Date(2026, 10, 12, 15),
      snapshots: [
        snap({ waits: [['LCK_M_X', 0]] }),
        snap({ blocked: 6, waits: [['LCK_M_X', 600_000]] })
      ],
      aggregates: agg(35),
      alerts: [{ severity: 'critical', category: 'blocking', message: 'Head blocker spid 55' }],
      incidents: [
        {
          category: 'blocking',
          severity: 'critical',
          summary: 'Blocking chain',
          rootCause: 'Missing index on Orders'
        }
      ],
      baseline: null
    })
    expect(d.text).toContain('[2026-11-12 14:00–15:00] prod01:1433')
    expect(d.text).toContain('blocking up to 6 sessions')
    expect(d.text).toContain('LCK_M_X 100%')
    expect(d.text).toContain('root cause: Missing index on Orders')
    expect(d.text).toContain('ANOMALIES')
    expect(d.anomalyFlags).toEqual(
      expect.arrayContaining(['blocking', 'critical_alert', 'incident'])
    )
  })
})
