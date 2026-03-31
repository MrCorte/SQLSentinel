import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as mssql from 'mssql'
import { collectMetrics } from './sqlCollector'
import type { ServerConnection } from './types'

// Mock dell'intero modulo mssql — nessuna connessione reale
vi.mock('mssql', () => ({
  connect: vi.fn()
}))

// Fixture connessione di test
const CONN: ServerConnection = {
  ip: '192.168.1.10',
  port: 1433,
  useWindowsAuth: false,
  username: 'sa',
  password: 'TestPass1!'
}

// Righe di risposta minime per ogni query
const INSTANCE_ROW = {
  version: 'Microsoft SQL Server 2019 (RTM)',
  edition: 'Enterprise Edition',
  memory_used_mb: 4096,
  cpu_usage_percent: 22,
  uptime_days: 15
}

const DB_ROW = {
  name: 'AdventureWorks',
  state_desc: 'ONLINE',
  recovery_model: 'FULL',
  size_mb: 512,
  log_size_mb: 64,
  compatibility_level: 150,
  is_encrypted: false,
  is_read_only: false,
  owner: 'sa',
  create_date: new Date('2020-01-01T00:00:00Z')
}

const BACKUP_ROW = {
  database_name: 'AdventureWorks',
  last_full_backup: new Date('2026-03-15T02:00:00Z'),
  last_diff_backup: null,
  last_log_backup: new Date('2026-03-16T10:00:00Z')
}

/** Determina quale recordset restituire in base al contenuto SQL */
function recordsetForSql(sql: string): unknown[] {
  if (sql.includes('dm_os_process_memory')) return [INSTANCE_ROW]
  if (sql.includes('dm_exec_requests')) return []
  if (sql.includes('dm_exec_query_stats')) return []
  if (sql.includes('backupset')) return [BACKUP_ROW]   // prima di sys.databases (la query fa JOIN)
  if (sql.includes('sys.databases')) return [DB_ROW]
  return []
}

function makeMockPool(queryImpl?: (sql: string) => Promise<unknown>) {
  const mockRequest = {
    query: vi.fn((sql: string) =>
      queryImpl
        ? queryImpl(sql)
        : Promise.resolve({ recordset: recordsetForSql(sql) })
    )
  }
  const mockPool = {
    request: vi.fn(() => mockRequest),
    close: vi.fn().mockResolvedValue(undefined)
  }
  return { mockPool, mockRequest }
}

describe('collectMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restituisce ServerMetrics completo quando tutte le query hanno successo', async () => {
    const { mockPool } = makeMockPool()
    vi.mocked(mssql.connect as (config: mssql.config | string) => Promise<mssql.ConnectionPool>).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    const metrics = await collectMetrics(CONN)

    expect(metrics.collectedAt).toBeInstanceOf(Date)

    // Instance info mappata correttamente
    expect(metrics.instanceInfo.version).toBe(INSTANCE_ROW.version)
    expect(metrics.instanceInfo.edition).toBe(INSTANCE_ROW.edition)
    expect(metrics.instanceInfo.memoryUsedMb).toBe(4096)
    expect(metrics.instanceInfo.cpuUsagePercent).toBe(22)
    expect(metrics.instanceInfo.uptimeDays).toBe(15)

    // Database
    expect(metrics.databases).toHaveLength(1)
    expect(metrics.databases[0].name).toBe('AdventureWorks')
    expect(metrics.databases[0].stateDesc).toBe('ONLINE')
    expect(metrics.databases[0].sizeMb).toBe(512)
    expect(metrics.databases[0].compatibilityLevel).toBe(150)
    expect(metrics.databases[0].isEncrypted).toBe(false)
    expect(metrics.databases[0].isReadOnly).toBe(false)
    expect(metrics.databases[0].owner).toBe('sa')
    expect(metrics.databases[0].createDate).toBe(new Date('2020-01-01T00:00:00Z').toISOString())

    // Sessioni e top queries vuote (recordset vuoti)
    expect(metrics.activeSessions).toEqual([])
    expect(metrics.topQueries).toEqual([])

    // Backup
    expect(metrics.backupStatus).toHaveLength(1)
    expect(metrics.backupStatus[0].databaseName).toBe('AdventureWorks')
    expect(metrics.backupStatus[0].lastFullBackup).toEqual(BACKUP_ROW.last_full_backup)
    expect(metrics.backupStatus[0].lastDiffBackup).toBeNull()

    // Pool sempre chiuso
    expect(mockPool.close).toHaveBeenCalledOnce()
  })

  it('propaga l\'errore al chiamante quando la connessione fallisce', async () => {
    vi.mocked(mssql.connect).mockRejectedValue(new Error('Login failed for user'))

    await expect(collectMetrics(CONN)).rejects.toThrow('Login failed for user')
  })

  it('propaga l\'errore al chiamante in caso di timeout di connessione', async () => {
    vi.mocked(mssql.connect).mockRejectedValue(
      new Error('ConnectionError: Connection timeout: failed to create a connection')
    )

    await expect(collectMetrics(CONN)).rejects.toThrow('Connection timeout')
  })

  it('restituisce metriche parziali quando una singola query fallisce (backup negato)', async () => {
    const { mockPool } = makeMockPool(async (sql: string) => {
      // Simula permesso negato su msdb per la query backup
      if (sql.includes('backupset')) {
        throw new Error("The server principal 'sa' is not able to access the database 'msdb'")
      }
      return { recordset: recordsetForSql(sql) }
    })
    vi.mocked(mssql.connect as (config: mssql.config | string) => Promise<mssql.ConnectionPool>).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const metrics = await collectMetrics(CONN)

    // Le altre query devono aver avuto successo
    expect(metrics.instanceInfo.version).toBe(INSTANCE_ROW.version)
    expect(metrics.databases).toHaveLength(1)

    // backupStatus è array vuoto (fallback del catch)
    expect(metrics.backupStatus).toEqual([])

    // L'errore deve essere loggato senza esporre credenziali
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[collector] backup status:'),
      expect.stringContaining('msdb')
    )

    // Pool sempre chiuso anche con query parziale fallita
    expect(mockPool.close).toHaveBeenCalledOnce()

    consoleSpy.mockRestore()
  })
})
