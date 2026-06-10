import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn() }))
vi.mock('../collectors/agCollector', () => ({
  detectAndSyncReplicaRoles: vi.fn(() => Promise.resolve([]))
}))
vi.mock('../store/sqlserver/dbCustomFieldsRepository', () => ({
  getAllCustomFields: vi.fn(async () => ({}))
}))
vi.mock('../store/sqlserver/metricsRepository', () => ({
  cleanup: vi.fn(async () => {}),
  findLastNBulk: vi.fn(async () => ({})),
  batchSave: vi.fn(async () => {})
}))
vi.mock('../store/sqlserver/settingsRepository', () => ({
  getSettings: vi.fn(async () => ({ retentionMinutes: 60 }))
}))
vi.mock('../store/sqlserver/serverDatabasesRepository', () => ({
  upsertDatabases: vi.fn(async () => {}),
  deleteStale: vi.fn(async () => {}),
  deleteByNames: vi.fn(async () => {}),
  getAllGroupedByServer: vi.fn(async () => ({}))
}))
vi.mock('../store/sqlserver/serverRepository')

import { __canAutoResolveForTest as canAutoResolve } from '../metricsWorker'
import type { ServerMetrics } from '../collectors/types'

// Metriche "complete": ogni collector ha restituito dati → ogni condizione può
// essere dichiarata risolta. I singoli test svuotano il pezzo che interessa per
// simulare un fallimento di quella query.
function fullMetrics(overrides: Partial<ServerMetrics> = {}): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: 'Microsoft SQL Server 2022',
      edition: 'Developer',
      memoryUsedMb: 1024,
      memoryTargetMb: 2048,
      cpuUsagePercent: 5,
      uptimeDays: 1,
      logicalCpus: 4,
      physicalCpus: 2
    },
    databases: [{ name: 'AppDB' }] as ServerMetrics['databases'],
    activeSessions: [],
    topQueries: [],
    backupStatus: [{ databaseName: 'AppDB' }] as ServerMetrics['backupStatus'],
    waitStats: [],
    diskVolumes: [{ volume_mount_point: 'C:\\' }] as unknown as ServerMetrics['diskVolumes'],
    databaseFiles: [{ database_name: 'AppDB' }] as unknown as ServerMetrics['databaseFiles'],
    ...overrides
  }
}

describe('canAutoResolve', () => {
  describe('cpu_high — risolvibile solo se instanceInfo è valido', () => {
    it('risolve con version nota', () => {
      expect(canAutoResolve('cpu_high', '', fullMetrics())).toBe(true)
    })
    it('NON risolve quando la query instanceInfo è fallita (version unknown)', () => {
      const m = fullMetrics({ instanceInfo: { ...fullMetrics().instanceInfo, version: 'unknown' } })
      expect(canAutoResolve('cpu_high', '', m)).toBe(false)
    })
  })

  describe('database_offline — serve la lista database', () => {
    it('risolve con databases popolato', () => {
      expect(canAutoResolve('database_offline', '', fullMetrics())).toBe(true)
    })
    it('NON risolve con databases vuoto (query fallita)', () => {
      expect(canAutoResolve('database_offline', '', fullMetrics({ databases: [] }))).toBe(false)
    })
  })

  describe('backup_overdue — serve lo stato backup', () => {
    it('risolve con backupStatus popolato', () => {
      expect(canAutoResolve('backup_overdue', '', fullMetrics())).toBe(true)
    })
    it('NON risolve con backupStatus vuoto (query fallita → falso "tutto ok")', () => {
      expect(canAutoResolve('backup_overdue', '', fullMetrics({ backupStatus: [] }))).toBe(false)
    })
  })

  describe('disk_space_low — fonte diversa per dedupTag', () => {
    it('autogrowth: risolve solo se databaseFiles è presente', () => {
      expect(canAutoResolve('disk_space_low', 'autogrowth', fullMetrics())).toBe(true)
      expect(canAutoResolve('disk_space_low', 'autogrowth', fullMetrics({ databaseFiles: [] }))).toBe(
        false
      )
    })
    it('volume: risolve solo se diskVolumes è presente', () => {
      expect(canAutoResolve('disk_space_low', 'warn-volume', fullMetrics())).toBe(true)
      expect(canAutoResolve('disk_space_low', 'warn-volume', fullMetrics({ diskVolumes: [] }))).toBe(
        false
      )
    })
  })

  describe('default (blocking_sessions e simili) — empty È lo stato risolto', () => {
    it('risolve sempre, anche con metriche vuote', () => {
      const empty = fullMetrics({
        databases: [],
        backupStatus: [],
        diskVolumes: [],
        databaseFiles: []
      })
      expect(canAutoResolve('blocking_sessions', '', empty)).toBe(true)
      expect(canAutoResolve('qualcosa_di_sconosciuto', '', empty)).toBe(true)
    })
  })
})
