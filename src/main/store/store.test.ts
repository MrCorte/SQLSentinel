import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb, getDb } from './database'
import { findAll, findById, upsert, remove, updateLastSeen } from './serverRepository'
import { save, findLatest, findHistory, cleanup, findLastN, batchSave } from './metricsRepository'
import type { ServerMetrics } from '../collectors/types'

// DB in memoria: ogni test parte da zero
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
      { name: 'master', stateDesc: 'ONLINE', recoveryModel: 'SIMPLE', sizeMb: 10, logSizeMb: 2 }
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
    it('inserisce un nuovo server e lo restituisce in findAll', () => {
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

    it('aggiorna il record esistente se ip:port coincide (non duplica)', () => {
      const first = upsert(SERVER_A)
      const updated = upsert({ ...SERVER_A, username: 'admin' })

      // Stesso id, non duplicato
      expect(updated.id).toBe(first.id)
      expect(updated.username).toBe('admin')
      expect(findAll()).toHaveLength(1)
    })

    it('inserisce server multipli correttamente', () => {
      upsert(SERVER_A)
      upsert(SERVER_B)

      const all = findAll()
      expect(all).toHaveLength(2)
    })
  })

  describe('findById', () => {
    it('restituisce il server corretto per id', () => {
      const saved = upsert(SERVER_A)
      const found = findById(saved.id)

      expect(found).not.toBeNull()
      expect(found!.ip).toBe('192.168.1.10')
    })

    it('restituisce null per id inesistente', () => {
      expect(findById('00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  describe('remove', () => {
    it('elimina il server e non lo restituisce più in findAll', () => {
      const saved = upsert(SERVER_A)
      remove(saved.id)

      expect(findAll()).toHaveLength(0)
      expect(findById(saved.id)).toBeNull()
    })

    it('non lancia errori se l\'id non esiste', () => {
      expect(() => remove('id-inesistente')).not.toThrow()
    })
  })

  describe('updateLastSeen', () => {
    it('aggiorna lastSeenAt correttamente', () => {
      const saved = upsert(SERVER_A)
      const now = new Date('2026-03-16T12:00:00Z')

      updateLastSeen(saved.id, now)

      const found = findById(saved.id)
      expect(found!.lastSeenAt).toEqual(now)
    })
  })

  describe('tipi booleani e date', () => {
    it('converte useWindowsAuth da INTEGER a boolean', () => {
      const saved = upsert(SERVER_B)
      expect(saved.useWindowsAuth).toBe(true)
      expect(typeof saved.useWindowsAuth).toBe('boolean')
    })

    it('addedAt è un oggetto Date, non una stringa', () => {
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
    it('salva e recupera le metriche più recenti', () => {
      const server = upsert(SERVER_A)
      const metrics = makeMetrics()

      save(server.id, metrics)

      const latest = findLatest(server.id)
      expect(latest).not.toBeNull()
      expect(latest!.collectedAt).toEqual(metrics.collectedAt)
      expect(latest!.instanceInfo.version).toBe('SQL Server 2019')
      expect(latest!.databases).toHaveLength(1)
    })

    it('deserializza le Date correttamente (non stringhe)', () => {
      const server = upsert(SERVER_A)
      save(server.id, makeMetrics())

      const latest = findLatest(server.id)!
      expect(latest.collectedAt).toBeInstanceOf(Date)
      expect(latest.backupStatus[0].lastFullBackup).toBeInstanceOf(Date)
      expect(latest.backupStatus[0].lastDiffBackup).toBeNull()
    })

    it('restituisce null se non ci sono metriche per il server', () => {
      const server = upsert(SERVER_A)
      expect(findLatest(server.id)).toBeNull()
    })

    it('restituisce lo snapshot più recente se ne esistono più', () => {
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
    it('restituisce gli snapshot nel range di giorni richiesto', () => {
      const server = upsert(SERVER_A)

      // Snapshot recente (oggi)
      save(server.id, makeMetrics({ collectedAt: new Date() }))

      const history = findHistory(server.id, 7)
      expect(history).toHaveLength(1)
      expect(history[0].serverId).toBe(server.id)
      expect(history[0].collectedAt).toBeInstanceOf(Date)
      expect(history[0].metricsJson).toBeTypeOf('string')
    })
  })

  describe('findLastN', () => {
    it('restituisce i last N snapshot ordinati dal più vecchio al più recente (ASC)', () => {
      const server = upsert(SERVER_A)
      const dates = [
        new Date('2026-03-01T10:00:00Z'),
        new Date('2026-03-02T10:00:00Z'),
        new Date('2026-03-03T10:00:00Z'),
        new Date('2026-03-04T10:00:00Z'),
        new Date('2026-03-05T10:00:00Z'),
      ]
      for (const collectedAt of dates) save(server.id, makeMetrics({ collectedAt }))

      const result = findLastN(server.id, 3)
      expect(result).toHaveLength(3)
      // deve restituire i 3 più recenti in ordine ASC (oldest first)
      expect(result[0].collectedAt).toEqual(new Date('2026-03-03T10:00:00Z'))
      expect(result[1].collectedAt).toEqual(new Date('2026-03-04T10:00:00Z'))
      expect(result[2].collectedAt).toEqual(new Date('2026-03-05T10:00:00Z'))
    })

    it('restituisce tutti gli snapshot se n > count', () => {
      const server = upsert(SERVER_A)
      save(server.id, makeMetrics())
      expect(findLastN(server.id, 10)).toHaveLength(1)
    })

    it('restituisce [] per server senza snapshot', () => {
      const server = upsert(SERVER_A)
      expect(findLastN(server.id, 5)).toHaveLength(0)
    })

    it('deserializza collectedAt come Date', () => {
      const server = upsert(SERVER_A)
      save(server.id, makeMetrics())
      const [snap] = findLastN(server.id, 1)
      expect(snap.collectedAt).toBeInstanceOf(Date)
    })
  })

  describe('batchSave', () => {
    it('inserisce più snapshot in una transazione e li recupera con findLastN', () => {
      const server = upsert(SERVER_A)
      batchSave([
        { serverId: server.id, metrics: makeMetrics({ collectedAt: new Date('2026-03-01T10:00:00Z') }) },
        { serverId: server.id, metrics: makeMetrics({ collectedAt: new Date('2026-03-02T10:00:00Z') }) },
        { serverId: server.id, metrics: makeMetrics({ collectedAt: new Date('2026-03-03T10:00:00Z') }) },
      ])
      expect(findLastN(server.id, 10)).toHaveLength(3)
    })

    it('batchSave([]) non lancia errori', () => {
      expect(() => batchSave([])).not.toThrow()
    })

    it('i dati inseriti con batchSave sono deserializzati correttamente da findLastN', () => {
      const server = upsert(SERVER_A)
      const metrics = makeMetrics({ collectedAt: new Date('2026-03-10T10:00:00Z') })
      batchSave([{ serverId: server.id, metrics }])
      const [snap] = findLastN(server.id, 1)
      expect(snap.collectedAt).toBeInstanceOf(Date)
      expect(snap.instanceInfo.version).toBe('SQL Server 2019')
    })
  })

  describe('cleanup', () => {
    it('elimina gli snapshot più vecchi del periodo di retention', () => {
      const server = upsert(SERVER_A)

      // Snapshot recente
      save(server.id, makeMetrics({ collectedAt: new Date() }))

      // Snapshot molto vecchio — inseriamo manualmente con data passata
      getDb().prepare(`
        INSERT INTO metrics_snapshots (id, server_id, collected_at, metrics_json)
        VALUES (?, ?, ?, ?)
      `).run(
        'old-snapshot-id',
        server.id,
        new Date('2020-01-01T00:00:00Z').toISOString(),
        JSON.stringify(makeMetrics())
      )

      // Prima del cleanup ci sono 2 snapshot
      expect(findHistory(server.id, 9999)).toHaveLength(2)

      cleanup(30) // elimina tutto ciò che ha più di 30 giorni

      // Solo il recente rimane
      expect(findHistory(server.id, 9999)).toHaveLength(1)
    })

    it('non elimina snapshot nel periodo di retention', () => {
      const server = upsert(SERVER_A)
      save(server.id, makeMetrics({ collectedAt: new Date() }))

      cleanup(30)

      expect(findHistory(server.id, 7)).toHaveLength(1)
    })
  })
})
