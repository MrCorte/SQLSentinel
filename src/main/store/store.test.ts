import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb, getDb } from './database'
import { findAll, findById, upsert, remove, updateLastSeen } from './serverRepository'
import { save, findLatest, findHistory, cleanup, findLastN, batchSave } from './metricsRepository'
import type { ServerMetrics } from '../collectors/types'

// In-memory DB: each test starts from scratch
beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

// --- Fixture ---

const SERVER_A = {
  ip: '192.168.1.10',
  port: 1433,
  useWindowsAuth: false,
  username: 'sa',
  lastSeenAt: null,
  lastMetricsAt: null
}

const SERVER_B = {
  ip: '192.168.1.20',
  port: 1433,
  useWindowsAuth: true,
  lastSeenAt: null,
  lastMetricsAt: null
}

function makeMetrics(overrides: Partial<ServerMetrics> = {}): ServerMetrics {
  return {
    collectedAt: new Date('2026-03-16T10:00:00Z'),
    instanceInfo: {
      version: 'SQL Server 2019',
      edition: 'Enterprise',
      memoryUsedMb: 4096,
      memoryTargetMb: 8192,
      cpuUsagePercent: 15,
      uptimeDays: 30,
      logicalCpus: 16,
      physicalCpus: 8
    },
    databases: [
      {
        name: 'master',
        stateDesc: 'ONLINE',
        recoveryModel: 'SIMPLE',
        sizeMb: 10,
        logSizeMb: 2,
        compatibilityLevel: 150,
        isEncrypted: false,
        isReadOnly: false,
        owner: 'sa',
        createDate: '2020-01-01T00:00:00.000Z'
      }
    ],
    activeSessions: [],
    topQueries: [],
    backupStatus: [
      {
        databaseName: 'master',
        lastFullBackup: new Date('2026-03-15T02:00:00Z'),
        lastDiffBackup: null,
        lastLogBackup: null
      }
    ],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: [],
    ...overrides
  }
}

// =====================================================================
// serverRepository
// =====================================================================

describe('serverRepository', () => {
  describe('upsert + findAll', () => {
    it('inserts a new server and returns it in findAll', () => {
      const saved = upsert(SERVER_A)

      expect(saved.id).toBeTypeOf('string')
      expect(saved.ip).toBe('192.168.1.10')
      expect(saved.port).toBe(1433)
      expect(saved.useWindowsAuth).toBe(false)
      expect(saved.username).toBe('sa')
      expect(saved.addedAt).toBeInstanceOf(Date)
      expect(saved.lastSeenAt).toBeNull()

      const all = findAll()
      expect(all).toHaveLength(1)
      expect(all[0].id).toBe(saved.id)
    })

    it('updates the existing record if ip:port matches (no duplicate)', () => {
      const first = upsert(SERVER_A)
      const updated = upsert({ ...SERVER_A, username: 'admin' })

      // Same id, no duplicate
      expect(updated.id).toBe(first.id)
      expect(updated.username).toBe('admin')
      expect(findAll()).toHaveLength(1)
    })

    it('correctly inserts multiple servers', () => {
      upsert(SERVER_A)
      upsert(SERVER_B)

      const all = findAll()
      expect(all).toHaveLength(2)
    })
  })

  describe('findById', () => {
    it('returns the correct server by id', () => {
      const saved = upsert(SERVER_A)
      const found = findById(saved.id)

      expect(found).not.toBeNull()
      expect(found!.ip).toBe('192.168.1.10')
    })

    it('returns null for a non-existent id', () => {
      expect(findById('00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  describe('remove', () => {
    it('deletes the server and no longer returns it in findAll', () => {
      const saved = upsert(SERVER_A)
      remove(saved.id)

      expect(findAll()).toHaveLength(0)
      expect(findById(saved.id)).toBeNull()
    })

    it('does not throw errors if the id does not exist', () => {
      expect(() => remove('id-inesistente')).not.toThrow()
    })
  })

  describe('updateLastSeen', () => {
    it('correctly updates lastSeenAt', () => {
      const saved = upsert(SERVER_A)
      const now = new Date('2026-03-16T12:00:00Z')

      updateLastSeen(saved.id, now)

      const found = findById(saved.id)
      expect(found!.lastSeenAt).toEqual(now)
    })
  })

  describe('boolean types and dates', () => {
    it('converts useWindowsAuth from INTEGER to boolean', () => {
      const saved = upsert(SERVER_B)
      expect(saved.useWindowsAuth).toBe(true)
      expect(typeof saved.useWindowsAuth).toBe('boolean')
    })

    it('addedAt is a Date object, not a string', () => {
      const saved = upsert(SERVER_A)
      expect(saved.addedAt).toBeInstanceOf(Date)
    })
  })
})

// =====================================================================
// metricsRepository
// =====================================================================

describe('metricsRepository', () => {
  describe('save + findLatest', () => {
    it('saves and retrieves the most recent metrics', () => {
      const server = upsert(SERVER_A)
      const metrics = makeMetrics()

      save(server.id, metrics)

      const latest = findLatest(server.id)
      expect(latest).not.toBeNull()
      expect(latest!.collectedAt).toEqual(metrics.collectedAt)
      expect(latest!.instanceInfo.version).toBe('SQL Server 2019')
      expect(latest!.databases).toHaveLength(1)
    })

    it('correctly deserializes Dates (not strings)', () => {
      const server = upsert(SERVER_A)
      save(server.id, makeMetrics())

      const latest = findLatest(server.id)!
      expect(latest.collectedAt).toBeInstanceOf(Date)
      expect(latest.backupStatus[0].lastFullBackup).toBeInstanceOf(Date)
      expect(latest.backupStatus[0].lastDiffBackup).toBeNull()
    })

    it('returns null when there are no metrics for the server', () => {
      const server = upsert(SERVER_A)
      expect(findLatest(server.id)).toBeNull()
    })

    it('returns the most recent snapshot when multiple exist', () => {
      const server = upsert(SERVER_A)
      const older = makeMetrics({ collectedAt: new Date('2026-03-14T10:00:00Z') })
      const newer = makeMetrics({ collectedAt: new Date('2026-03-16T10:00:00Z') })

      save(server.id, older)
      save(server.id, newer)

      const latest = findLatest(server.id)!
      expect(latest.collectedAt).toEqual(newer.collectedAt)
    })
  })

  describe('findHistory', () => {
    it('returns snapshots within the requested day range', () => {
      const server = upsert(SERVER_A)

      // Recent snapshot (today)
      save(server.id, makeMetrics({ collectedAt: new Date() }))

      const history = findHistory(server.id, 7)
      expect(history).toHaveLength(1)
      expect(history[0].serverId).toBe(server.id)
      expect(history[0].collectedAt).toBeInstanceOf(Date)
      expect(history[0].metricsJson).toBeTypeOf('string')
    })
  })

  describe('findLastN', () => {
    it('returns the last N snapshots ordered from oldest to most recent (ASC)', () => {
      const server = upsert(SERVER_A)
      const dates = [
        new Date('2026-03-01T10:00:00Z'),
        new Date('2026-03-02T10:00:00Z'),
        new Date('2026-03-03T10:00:00Z'),
        new Date('2026-03-04T10:00:00Z'),
        new Date('2026-03-05T10:00:00Z')
      ]
      for (const collectedAt of dates) save(server.id, makeMetrics({ collectedAt }))

      const result = findLastN(server.id, 3)
      expect(result).toHaveLength(3)
      // must return the 3 most recent in ASC order (oldest first)
      expect(result[0].collectedAt).toEqual(new Date('2026-03-03T10:00:00Z'))
      expect(result[1].collectedAt).toEqual(new Date('2026-03-04T10:00:00Z'))
      expect(result[2].collectedAt).toEqual(new Date('2026-03-05T10:00:00Z'))
    })

    it('returns all snapshots when n > count', () => {
      const server = upsert(SERVER_A)
      save(server.id, makeMetrics())
      expect(findLastN(server.id, 10)).toHaveLength(1)
    })

    it('returns [] for a server with no snapshots', () => {
      const server = upsert(SERVER_A)
      expect(findLastN(server.id, 5)).toHaveLength(0)
    })

    it('deserializes collectedAt as Date', () => {
      const server = upsert(SERVER_A)
      save(server.id, makeMetrics())
      const [snap] = findLastN(server.id, 1)
      expect(snap.collectedAt).toBeInstanceOf(Date)
    })
  })

  describe('batchSave', () => {
    it('inserts multiple snapshots in a transaction and retrieves them with findLastN', () => {
      const server = upsert(SERVER_A)
      batchSave([
        {
          serverId: server.id,
          metrics: makeMetrics({ collectedAt: new Date('2026-03-01T10:00:00Z') })
        },
        {
          serverId: server.id,
          metrics: makeMetrics({ collectedAt: new Date('2026-03-02T10:00:00Z') })
        },
        {
          serverId: server.id,
          metrics: makeMetrics({ collectedAt: new Date('2026-03-03T10:00:00Z') })
        }
      ])
      expect(findLastN(server.id, 10)).toHaveLength(3)
    })

    it('batchSave([]) does not throw errors', () => {
      expect(() => batchSave([])).not.toThrow()
    })

    it('data inserted with batchSave is correctly deserialized by findLastN', () => {
      const server = upsert(SERVER_A)
      const metrics = makeMetrics({ collectedAt: new Date('2026-03-10T10:00:00Z') })
      batchSave([{ serverId: server.id, metrics }])
      const [snap] = findLastN(server.id, 1)
      expect(snap.collectedAt).toBeInstanceOf(Date)
      expect(snap.instanceInfo.version).toBe('SQL Server 2019')
    })
  })

  describe('cleanup', () => {
    it('deletes snapshots older than the retention period', () => {
      const server = upsert(SERVER_A)

      // Recent snapshot
      save(server.id, makeMetrics({ collectedAt: new Date() }))

      // Very old snapshot — insert manually with a past date
      getDb()
        .prepare(
          `
        INSERT INTO metrics_snapshots (id, server_id, collected_at, metrics_json)
        VALUES (?, ?, ?, ?)
      `
        )
        .run(
          'old-snapshot-id',
          server.id,
          new Date('2020-01-01T00:00:00Z').toISOString(),
          JSON.stringify(makeMetrics())
        )

      // Before cleanup there are 2 snapshots
      expect(findHistory(server.id, 9999)).toHaveLength(2)

      cleanup(30) // delete everything older than 30 days

      // Only the recent one remains
      expect(findHistory(server.id, 9999)).toHaveLength(1)
    })

    it('does not delete snapshots within the retention period', () => {
      const server = upsert(SERVER_A)
      save(server.id, makeMetrics({ collectedAt: new Date() }))

      cleanup(30)

      expect(findHistory(server.id, 7)).toHaveLength(1)
    })
  })
})
