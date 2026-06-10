import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as mssql from 'mssql'
import { collectMetrics, collectMetricsCritical } from './sqlCollector'
import { getPool, invalidatePool } from './connectionPool'
import type { ServerConnection } from './types'

// Mock the entire mssql module — no real connection
vi.mock('mssql', () => ({
  connect: vi.fn()
}))

// Pool cache layer — we drive the test through this entry point now.
vi.mock('./connectionPool', () => ({
  getPool: vi.fn(),
  invalidatePool: vi.fn(),
  closeAllPools: vi.fn()
}))

// Test connection fixture
const CONN: ServerConnection = {
  ip: '192.168.1.10',
  port: 1433,
  useWindowsAuth: false,
  username: 'sa',
  password: 'TestPass1!'
}

// Minimal response rows for each query
const INSTANCE_ROW = {
  version: 'Microsoft SQL Server 2019 (RTM)',
  edition: 'Enterprise Edition',
  memory_used_mb: 4096,
  memory_target_mb: 8192,
  cpu_usage_percent: 22,
  uptime_days: 15,
  logical_cpu_count: 16,
  physical_cpu_count: 8
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
  if (sql.includes('backupset')) return [BACKUP_ROW] // before sys.databases (the query does a JOIN)
  if (sql.includes('sys.databases')) return [DB_ROW]
  return []
}

function makeMockPool(queryImpl?: (sql: string) => Promise<unknown>) {
  const mockRequest = {
    query: vi.fn((sql: string) =>
      queryImpl ? queryImpl(sql) : Promise.resolve({ recordset: recordsetForSql(sql) })
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

  it('returns complete ServerMetrics when all queries succeed', async () => {
    const { mockPool } = makeMockPool()
    vi.mocked(getPool).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    const metrics = await collectMetrics(CONN)

    expect(metrics.collectedAt).toBeInstanceOf(Date)

    // Instance info correctly mapped
    expect(metrics.instanceInfo.version).toBe(INSTANCE_ROW.version)
    expect(metrics.instanceInfo.edition).toBe(INSTANCE_ROW.edition)
    expect(metrics.instanceInfo.memoryUsedMb).toBe(4096)
    expect(metrics.instanceInfo.memoryTargetMb).toBe(8192)
    expect(metrics.instanceInfo.cpuUsagePercent).toBe(22)
    expect(metrics.instanceInfo.uptimeDays).toBe(15)
    expect(metrics.instanceInfo.logicalCpus).toBe(16)
    expect(metrics.instanceInfo.physicalCpus).toBe(8)

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

    // Sessions and top queries are empty (empty recordsets)
    expect(metrics.activeSessions).toEqual([])
    expect(metrics.topQueries).toEqual([])

    // Backup
    expect(metrics.backupStatus).toHaveLength(1)
    expect(metrics.backupStatus[0].databaseName).toBe('AdventureWorks')
    expect(metrics.backupStatus[0].lastFullBackup).toEqual(BACKUP_ROW.last_full_backup)
    expect(metrics.backupStatus[0].lastDiffBackup).toBeNull()

    // Pool lifecycle is owned by connectionPool (mocked here), not collectMetrics.
  })

  it('casts file size pages before arithmetic to avoid int overflow', async () => {
    const { mockPool, mockRequest } = makeMockPool()
    vi.mocked(getPool).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    await collectMetrics(CONN)

    const databaseFilesSql = mockRequest.query.mock.calls
      .map(([sql]: [string]) => sql)
      .find((sql: string) => sql.includes('sys.master_files mf') && sql.includes('physical_name'))

    expect(databaseFilesSql).toContain('CAST(mf.size AS DECIMAL(19,2)) * 8 / 1024.0')
    expect(databaseFilesSql).toContain('CAST(mf.max_size AS DECIMAL(19,2)) * 8 / 1024.0')
    // SpaceUsed is collected per-DB into @fs (FILEPROPERTY is only valid in the
    // file's own database context) and cast before the page arithmetic.
    expect(databaseFilesSql).toContain(
      'CAST(fs.space_used_pages AS DECIMAL(19,2)) * 8 / 1024.0'
    )
    expect(databaseFilesSql).toContain("FILEPROPERTY(name, ''SpaceUsed'')")
  })

  it('propagates the error to the caller when the connection fails', async () => {
    vi.mocked(getPool).mockRejectedValue(new Error('Login failed for user'))

    await expect(collectMetrics(CONN)).rejects.toThrow('Login failed for user')
  })

  it('propagates the error to the caller on connection timeout', async () => {
    vi.mocked(getPool).mockRejectedValue(
      new Error('ConnectionError: Connection timeout: failed to create a connection')
    )

    await expect(collectMetrics(CONN)).rejects.toThrow('Connection timeout')
  })

  it('returns partial metrics when a single query fails (backup denied)', async () => {
    const { mockPool } = makeMockPool(async (sql: string) => {
      // Simulate denied permission on msdb for the backup query
      if (sql.includes('backupset')) {
        throw new Error("The server principal 'sa' is not able to access the database 'msdb'")
      }
      return { recordset: recordsetForSql(sql) }
    })
    vi.mocked(getPool).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const metrics = await collectMetrics(CONN)

    // The other queries must have succeeded
    expect(metrics.instanceInfo.version).toBe(INSTANCE_ROW.version)
    expect(metrics.databases).toHaveLength(1)

    // backupStatus is an empty array (catch fallback)
    expect(metrics.backupStatus).toEqual([])

    // The error must be logged without exposing credentials
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[collector] backup status:'),
      expect.stringContaining('msdb')
    )

    consoleSpy.mockRestore()
  })

  it('invalidates the pool when a sub-query fails with a TCP connection error', async () => {
    const connError = Object.assign(new Error('Connection reset by peer'), {
      code: 'ECONNRESET'
    })
    const { mockPool } = makeMockPool(async (sql: string) => {
      if (sql.includes('dm_os_process_memory')) throw connError
      return { recordset: recordsetForSql(sql) }
    })
    vi.mocked(getPool).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await collectMetrics(CONN)
    consoleSpy.mockRestore()

    expect(vi.mocked(invalidatePool)).toHaveBeenCalledWith(CONN)
  })

  it('does NOT invalidate the pool when a sub-query fails with a permission error', async () => {
    const permError = new Error("The server principal 'sa' is not able to access the database 'msdb'")
    const { mockPool } = makeMockPool(async (sql: string) => {
      if (sql.includes('backupset')) throw permError
      return { recordset: recordsetForSql(sql) }
    })
    vi.mocked(getPool).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await collectMetrics(CONN)
    consoleSpy.mockRestore()

    expect(vi.mocked(invalidatePool)).not.toHaveBeenCalled()
  })
})

describe('collectMetricsCritical', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes only 5 queries (skips dm_exec_query_stats, dm_os_wait_stats, FILEPROPERTY)', async () => {
    const { mockPool, mockRequest } = makeMockPool()
    vi.mocked(getPool).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    const result = await collectMetricsCritical(CONN)

    const executedSqls: string[] = mockRequest.query.mock.calls.map(([sql]: [string]) => sql)

    // The 3 expensive queries must NOT be executed
    expect(executedSqls.some((sql) => sql.includes('dm_exec_query_stats'))).toBe(false)
    expect(executedSqls.some((sql) => sql.includes('dm_os_wait_stats'))).toBe(false)
    expect(executedSqls.some((sql) => sql.includes('FILEPROPERTY'))).toBe(false)

    // The 5 critical queries MUST be executed
    expect(executedSqls.some((sql) => sql.includes('dm_os_process_memory'))).toBe(true)
    expect(executedSqls.some((sql) => sql.includes('sys.databases'))).toBe(true)
    expect(executedSqls.some((sql) => sql.includes('dm_exec_requests'))).toBe(true)
    expect(executedSqls.some((sql) => sql.includes('backupset'))).toBe(true)
    expect(executedSqls.some((sql) => sql.includes('dm_os_volume_stats'))).toBe(true)

    // Exactly 5 .query() calls
    expect(mockRequest.query).toHaveBeenCalledTimes(5)

    // Skipped fields are empty arrays
    expect(result.topQueries).toEqual([])
    expect(result.waitStats).toEqual([])
    expect(result.databaseFiles).toEqual([])

    // Critical fields are populated
    expect(result.instanceInfo.version).toBe(INSTANCE_ROW.version)
    expect(result.databases).toHaveLength(1)
    expect(result.backupStatus).toHaveLength(1)
  })
})
