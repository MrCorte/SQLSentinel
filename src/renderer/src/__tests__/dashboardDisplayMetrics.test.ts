import { describe, expect, it } from 'vitest'
import { selectDisplayMetrics } from '../utils/selectDisplayMetrics'
import type { ServerMetrics } from '../../../preload/index'

function makeMetrics(overrides: Partial<ServerMetrics> = {}): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: '16.0',
      edition: 'Developer',
      memoryUsedMb: 512,
      memoryTargetMb: 2048,
      cpuUsagePercent: 12,
      uptimeDays: 1,
      logicalCpus: 4,
      physicalCpus: 2
    },
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

describe('selectDisplayMetrics', () => {
  it('prefers cached merged metrics over a local delta with empty databases', () => {
    const cached = makeMetrics({
      databases: [
        {
          name: 'AppDB_Test_A',
          stateDesc: 'ONLINE',
          recoveryModel: 'SIMPLE',
          sizeMb: 128,
          logSizeMb: 16
        }
      ]
    })
    const localDelta = makeMetrics({
      databases: [],
      activeSessions: [
        {
          sessionId: 51,
          status: 'running',
          blockingSessionId: 0,
          waitType: '',
          waitTimeMs: 0,
          cpuTime: 4,
          logicalReads: 32
        }
      ],
      isDelta: true
    })

    expect(selectDisplayMetrics(localDelta, cached)).toBe(cached)
  })

  it('does not display an orphan local delta as a full snapshot', () => {
    expect(selectDisplayMetrics(makeMetrics({ isDelta: true }), null)).toBeNull()
  })
})
