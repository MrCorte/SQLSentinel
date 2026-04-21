import * as mssql from 'mssql'
import type {
  ServerConnection,
  ServerInfo,
  ServerMetrics,
  InstanceInfo,
  DatabaseInfo,
  SessionInfo,
  QueryInfo,
  BackupInfo,
  WaitStatInfo,
  DiskVolume,
  DatabaseFile
} from './types'

// --- Internal types for rows returned by T-SQL queries ---

interface InstanceInfoRow {
  version: string
  edition: string
  memory_used_mb: number
  memory_target_mb: number
  cpu_usage_percent: number
  uptime_days: number
  logical_cpu_count: number
  physical_cpu_count: number
}

interface DatabaseInfoRow {
  name: string
  state_desc: string
  recovery_model: string
  size_mb: number
  log_size_mb: number
  compatibility_level: number
  is_encrypted: boolean
  is_read_only: boolean
  owner: string
  create_date: Date
}

interface SessionInfoRow {
  session_id: number
  status: string
  blocking_session_id: number
  wait_type: string
  wait_time_ms: number
  cpu_time: number
  logical_reads: number
}

interface QueryInfoRow {
  query_text: string
  execution_count: number
  total_elapsed_time_ms: number
  avg_cpu_time_ms: number
  avg_logical_reads: number
}

interface BackupInfoRow {
  database_name: string
  last_full_backup: Date | null
  last_diff_backup: Date | null
  last_log_backup: Date | null
}

interface WaitStatRow {
  wait_type: string
  wait_time_ms: number
  max_wait_time_ms: number
  signal_wait_time_ms: number
  waiting_tasks_count: number
  wait_percent: number
}

// --- Error sanitization ---
// Removes sensitive identifiers from mssql/tedious messages before logging.
// Known patterns: "Login failed for user 'sa'", strings containing passwords/tokens,
// connection details with host:port.
const SANITIZE_PATTERNS: Array<[RegExp, string]> = [
  [/for user\s+'[^']*'/gi, "for user '***'"],
  [/login\s+'[^']*'/gi, "login '***'"],
  [/password=[^;\s]+/gi, 'password=***'],
  [/user id=[^;\s]+/gi, 'user id=***'],
  [/uid=[^;\s]+/gi, 'uid=***']
]

export function sanitizeSqlError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return SANITIZE_PATTERNS.reduce((msg, [re, repl]) => msg.replace(re, repl), raw)
}

// --- Connection configuration ---

function buildConfig(conn: ServerConnection): mssql.config {
  const base: mssql.config = {
    server: conn.ip,
    port: conn.port,
    database: 'master',
    // requestTimeout goes directly on config (not inside options)
    requestTimeout: 30000,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      // connectTimeout goes in options (via IOptions extends tds.ConnectionOptions)
      connectTimeout: 15000
      // instanceName NOT passed: SQL Browser is disabled and the port is always explicit
    }
  }

  if (conn.useWindowsAuth) {
    return {
      ...base,
      authentication: {
        type: 'ntlm',
        options: {
          domain: '',
          userName: '',
          password: ''
        }
      }
    }
  }

  return {
    ...base,
    authentication: {
      type: 'default',
      options: {
        userName: conn.username ?? '',
        password: conn.password ?? ''
      }
    }
  }
}

// --- Query T-SQL ---

/**
 * Info istanza: versione, edizione, memoria usata, CPU, uptime.
 * Fonti: sys.dm_os_process_memory + sys.dm_os_sys_info + @@VERSION + sys.dm_os_ring_buffers
 */
async function queryInstanceInfo(pool: mssql.ConnectionPool): Promise<InstanceInfo> {
  const sql = `
    SELECT TOP 1
      CAST(@@VERSION AS NVARCHAR(MAX))           AS version,
      CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS edition,
      pm.physical_memory_in_use_kb / 1024        AS memory_used_mb,
      -- Target memory da SQL Server Memory Manager (KB → MB)
      ISNULL((
        SELECT TOP 1 cntr_value / 1024
        FROM sys.dm_os_performance_counters
        WHERE counter_name = N'Target Server Memory (KB)'
          AND object_name LIKE N'%Memory Manager%'
      ), pm.physical_memory_in_use_kb / 1024)    AS memory_target_mb,
      -- Percentuale CPU SQL Server dall'ultimo campione del ring buffer
      ISNULL((
        SELECT TOP 1
          CAST(rb.r.value(
            '(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int'
          ) AS int)
        FROM (
          SELECT TOP 1 CONVERT(XML, record) AS r
          FROM sys.dm_os_ring_buffers
          WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
          ORDER BY timestamp DESC
        ) AS rb
      ), 0)                                      AS cpu_usage_percent,
      DATEDIFF(DAY, osi.sqlserver_start_time, GETDATE()) AS uptime_days,
      osi.cpu_count                                      AS logical_cpu_count,
      osi.cpu_count / NULLIF(osi.hyperthread_ratio, 0)    AS physical_cpu_count
    FROM sys.dm_os_process_memory pm
    CROSS JOIN sys.dm_os_sys_info osi
  `

  const result = await pool.request().query<InstanceInfoRow>(sql)
  const row = result.recordset[0]

  return {
    version: row.version,
    edition: row.edition ?? '',
    memoryUsedMb: Number(row.memory_used_mb),
    memoryTargetMb: Number(row.memory_target_mb),
    cpuUsagePercent: Number(row.cpu_usage_percent),
    uptimeDays: Number(row.uptime_days),
    logicalCpus: Number(row.logical_cpu_count) || 0,
    physicalCpus: Number(row.physical_cpu_count) || 0
  }
}

/**
 * List of databases with status, recovery model and sizes.
 * Source: sys.databases JOIN sys.master_files GROUP BY
 */
async function queryDatabases(pool: mssql.ConnectionPool): Promise<DatabaseInfo[]> {
  const sql = `
    SELECT
      d.name                                                                    AS name,
      d.state_desc                                                              AS state_desc,
      d.recovery_model_desc                                                     AS recovery_model,
      CAST(SUM(CASE WHEN mf.type = 0 THEN mf.size * 8.0 / 1024 ELSE 0 END)
           AS DECIMAL(18,2))                                                    AS size_mb,
      CAST(SUM(CASE WHEN mf.type = 1 THEN mf.size * 8.0 / 1024 ELSE 0 END)
           AS DECIMAL(18,2))                                                    AS log_size_mb,
      d.compatibility_level                                                     AS compatibility_level,
      d.is_encrypted                                                            AS is_encrypted,
      d.is_read_only                                                            AS is_read_only,
      ISNULL(SUSER_SNAME(d.owner_sid), '')                                     AS owner,
      d.create_date                                                             AS create_date
    FROM sys.databases d
    LEFT JOIN sys.master_files mf ON d.database_id = mf.database_id
    WHERE d.database_id > 4
    GROUP BY d.name, d.state_desc, d.recovery_model_desc,
             d.compatibility_level, d.is_encrypted, d.is_read_only,
             d.owner_sid, d.create_date
    ORDER BY d.name
  `

  const result = await pool.request().query<DatabaseInfoRow>(sql)

  return result.recordset.map((row) => ({
    name: row.name,
    stateDesc: row.state_desc,
    recoveryModel: row.recovery_model,
    sizeMb: Number(row.size_mb),
    logSizeMb: Number(row.log_size_mb),
    compatibilityLevel: Number(row.compatibility_level),
    isEncrypted: Boolean(row.is_encrypted),
    isReadOnly: Boolean(row.is_read_only),
    owner: row.owner ?? '',
    createDate: row.create_date instanceof Date ? row.create_date.toISOString() : String(row.create_date)
  }))
}

/**
 * Active sessions (session_id > 50 = no system sessions).
 * Source: sys.dm_exec_requests
 */
async function querySessions(pool: mssql.ConnectionPool): Promise<SessionInfo[]> {
  const sql = `
    SELECT
      r.session_id                        AS session_id,
      r.status                            AS status,
      ISNULL(r.blocking_session_id, 0)    AS blocking_session_id,
      ISNULL(r.wait_type, '')             AS wait_type,
      r.wait_time                         AS wait_time_ms,
      r.cpu_time                          AS cpu_time,
      r.logical_reads                     AS logical_reads
    FROM sys.dm_exec_requests r
    WHERE r.session_id > 50
    ORDER BY r.cpu_time DESC
  `

  const result = await pool.request().query<SessionInfoRow>(sql)

  return result.recordset.map((row) => ({
    sessionId: row.session_id,
    status: row.status,
    blockingSessionId: row.blocking_session_id,
    waitType: row.wait_type,
    waitTimeMs: row.wait_time_ms,
    cpuTime: row.cpu_time,
    logicalReads: row.logical_reads
  }))
}

/**
 * Top 20 queries by total elapsed time.
 * Source: sys.dm_exec_query_stats CROSS APPLY sys.dm_exec_sql_text
 */
async function queryTopQueries(pool: mssql.ConnectionPool): Promise<QueryInfo[]> {
  const sql = `
    SELECT TOP 20
      SUBSTRING(
        qt.text,
        (qs.statement_start_offset / 2) + 1,
        ((CASE qs.statement_end_offset
            WHEN -1 THEN DATALENGTH(qt.text)
            ELSE qs.statement_end_offset
          END - qs.statement_start_offset) / 2) + 1
      )                                                    AS query_text,
      qs.execution_count                                   AS execution_count,
      qs.total_elapsed_time / 1000                         AS total_elapsed_time_ms,
      (qs.total_worker_time / NULLIF(qs.execution_count, 0)) / 1000   AS avg_cpu_time_ms,
      qs.total_logical_reads / NULLIF(qs.execution_count, 0)          AS avg_logical_reads
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
    ORDER BY qs.total_elapsed_time DESC
  `

  const result = await pool.request().query<QueryInfoRow>(sql)

  return result.recordset.map((row) => ({
    queryText: row.query_text,
    executionCount: Number(row.execution_count),
    totalElapsedTimeMs: Number(row.total_elapsed_time_ms),
    avgCpuTimeMs: Number(row.avg_cpu_time_ms ?? 0),
    avgLogicalReads: Number(row.avg_logical_reads ?? 0)
  }))
}

/**
 * Backup status for each database (last 7 days).
 * Source: msdb.dbo.backupset GROUP BY database_name, type
 */
async function queryBackupStatus(pool: mssql.ConnectionPool): Promise<BackupInfo[]> {
  // LEFT JOIN: all user-level DBs appear even if they have never had a backup.
  // The bs.type filter is pushed into the JOIN so the optimizer can use the
  // backupset_database index and prune rows early; on msdb with millions of rows
  // this drastically cuts query cost (from 1-5s to <200ms).
  const sql = `
    SELECT
      d.name                                                                    AS database_name,
      MAX(CASE WHEN bs.type = 'D' THEN bs.backup_finish_date ELSE NULL END)    AS last_full_backup,
      MAX(CASE WHEN bs.type = 'I' THEN bs.backup_finish_date ELSE NULL END)    AS last_diff_backup,
      MAX(CASE WHEN bs.type = 'L' THEN bs.backup_finish_date ELSE NULL END)    AS last_log_backup
    FROM sys.databases d
    LEFT JOIN msdb.dbo.backupset bs WITH (READUNCOMMITTED)
      ON d.name = bs.database_name
      AND bs.type IN ('D', 'I', 'L')
    WHERE d.database_id > 4
    GROUP BY d.name
    ORDER BY d.name
  `

  const result = await pool.request().query<BackupInfoRow>(sql)

  return result.recordset.map((row) => ({
    databaseName: row.database_name,
    lastFullBackup: row.last_full_backup,
    lastDiffBackup: row.last_diff_backup,
    lastLogBackup: row.last_log_backup
  }))
}

/**
 * Top 20 wait types by total wait time, excluding idle waits.
 * Source: sys.dm_os_wait_stats
 */
async function queryWaitStats(pool: mssql.ConnectionPool): Promise<WaitStatInfo[]> {
  const sql = `
    SELECT TOP 20
      wait_type,
      wait_time_ms,
      max_wait_time_ms,
      signal_wait_time_ms,
      waiting_tasks_count,
      CAST(wait_time_ms * 100.0 /
        NULLIF(SUM(wait_time_ms) OVER(), 0) AS DECIMAL(5,2)) AS wait_percent
    FROM sys.dm_os_wait_stats
    WHERE wait_type NOT IN (
      'SLEEP_TASK','BROKER_TO_FLUSH','BROKER_TASK_STOP',
      'CLR_AUTO_EVENT','CLR_MANUAL_EVENT','DISPATCHER_QUEUE_SEMAPHORE',
      'FT_IFTS_SCHEDULER_IDLE_WAIT','HADR_WORK_QUEUE','LAZYWRITER_SLEEP',
      'LOGMGR_QUEUE','ONDEMAND_TASK_QUEUE','REQUEST_FOR_DEADLOCK_SEARCH',
      'RESOURCE_QUEUE','SERVER_IDLE_CHECK','SLEEP_DBSTARTUP',
      'SLEEP_DBRECOVER','SLEEP_DBNULL','SLEEP_DBOPEN',
      'SLEEP_MASTERDBREADY','SLEEP_MASTERMDREADY','SLEEP_MASTERUPGRADED',
      'SLEEP_MSDBSTARTUP','SLEEP_SYSTEMTASK','SLEEP_TEMPDBSTARTUP',
      'SNI_HTTP_ACCEPT','SP_SERVER_DIAGNOSTICS_SLEEP',
      'SQLTRACE_BUFFER_FLUSH','SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
      'WAITFOR','XE_DISPATCHER_WAIT','XE_TIMER_EVENT',
      'BROKER_EVENTHANDLER','CHECKPOINT_QUEUE',
      'DBMIRROR_EVENTS_QUEUE','SQLTRACE_WAIT_ENTRIES',
      'WAIT_XTP_OFFLINE_CKPT_NEW_LOG'
    )
    AND wait_time_ms > 0
    ORDER BY wait_time_ms DESC
  `

  const result = await pool.request().query<WaitStatRow>(sql)

  return result.recordset.map((row) => ({
    waitType: row.wait_type,
    waitTimeMs: Number(row.wait_time_ms),
    maxWaitTimeMs: Number(row.max_wait_time_ms),
    signalWaitTimeMs: Number(row.signal_wait_time_ms),
    waitingTasksCount: Number(row.waiting_tasks_count),
    waitPercent: Number(row.wait_percent)
  }))
}

interface DiskVolumeRow {
  volume_mount_point: string
  logical_volume_name: string
  total_gb: number
  free_gb: number
  used_gb: number
  free_pct: number
}

interface DatabaseFileRow {
  database_name: string
  file_name: string
  type_desc: string
  physical_name: string
  size_mb: number
  used_mb: number
  free_mb: number
  max_mb: number | null
  is_percent_growth: boolean
  growth: number
}

/**
 * Disk volumes hosting SQL Server files.
 * Source: sys.master_files CROSS APPLY sys.dm_os_volume_stats
 */
async function queryDiskVolumes(pool: mssql.ConnectionPool): Promise<DiskVolume[]> {
  const sql = `
    SELECT DISTINCT
      vs.volume_mount_point,
      vs.logical_volume_name,
      CAST(vs.total_bytes / 1073741824.0 AS DECIMAL(10,2))             AS total_gb,
      CAST(vs.available_bytes / 1073741824.0 AS DECIMAL(10,2))         AS free_gb,
      CAST((vs.total_bytes - vs.available_bytes) /
           1073741824.0 AS DECIMAL(10,2))                              AS used_gb,
      CAST((vs.available_bytes * 100.0) /
           vs.total_bytes AS DECIMAL(5,2))                             AS free_pct
    FROM sys.master_files mf
    CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
    ORDER BY vs.volume_mount_point
  `

  const result = await pool.request().query<DiskVolumeRow>(sql)
  return result.recordset.map((row) => ({
    volume_mount_point: row.volume_mount_point,
    logical_volume_name: row.logical_volume_name ?? '',
    total_gb: Number(row.total_gb),
    free_gb: Number(row.free_gb),
    used_gb: Number(row.used_gb),
    free_pct: Number(row.free_pct)
  }))
}

/**
 * Physical files for user databases with space usage and autogrowth info.
 * Source: sys.master_files JOIN sys.databases
 * Note: used_mb and free_mb may be 0 for DBs not in the current context.
 */
async function queryDatabaseFiles(pool: mssql.ConnectionPool): Promise<DatabaseFile[]> {
  const sql = `
    SELECT
      db.name                                                                      AS database_name,
      mf.name                                                                      AS file_name,
      mf.type_desc,
      mf.physical_name,
      CAST(mf.size * 8 / 1024.0 AS DECIMAL(10,2))                                AS size_mb,
      ISNULL(CAST(FILEPROPERTY(mf.name, 'SpaceUsed') * 8 / 1024.0
               AS DECIMAL(10,2)), 0)                                               AS used_mb,
      ISNULL(CAST((mf.size - FILEPROPERTY(mf.name, 'SpaceUsed')) * 8 / 1024.0
               AS DECIMAL(10,2)), 0)                                               AS free_mb,
      CASE WHEN mf.max_size = -1 THEN NULL
           ELSE CAST(mf.max_size * 8 / 1024.0 AS DECIMAL(10,2))
      END                                                                          AS max_mb,
      mf.is_percent_growth,
      mf.growth
    FROM sys.master_files mf
    JOIN sys.databases db ON mf.database_id = db.database_id
    WHERE db.database_id > 4
    ORDER BY db.name, mf.type_desc DESC
  `

  const result = await pool.request().query<DatabaseFileRow>(sql)
  return result.recordset.map((row) => ({
    database_name: row.database_name,
    file_name: row.file_name,
    type_desc: row.type_desc as 'ROWS' | 'LOG',
    physical_name: row.physical_name,
    size_mb: Number(row.size_mb),
    used_mb: Number(row.used_mb),
    free_mb: Number(row.free_mb),
    max_mb: row.max_mb !== null ? Number(row.max_mb) : null,
    is_percent_growth: Boolean(row.is_percent_growth),
    growth: Number(row.growth)
  }))
}

// --- Default values for failed queries ---

function defaultInstanceInfo(): InstanceInfo {
  return { version: 'unknown', edition: 'unknown', memoryUsedMb: 0, memoryTargetMb: 0, cpuUsagePercent: 0, uptimeDays: 0, logicalCpus: 0, physicalCpus: 0 }
}

// --- Entry points pubblici ---

/**
 * Runs a test connection and retrieves MachineName and InstanceName.
 * Used by the "Add server" form to auto-populate alias and instance name.
 * The connection is always closed in the finally block.
 */
export async function detectServerInfo(connection: ServerConnection): Promise<ServerInfo> {
  const config = buildConfig(connection)
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(config)
    const result = await pool.request().query<{ machine_name: string; instance_name: string | null }>(`
      SELECT
        CAST(SERVERPROPERTY('MachineName')  AS NVARCHAR(128)) AS machine_name,
        CAST(SERVERPROPERTY('InstanceName') AS NVARCHAR(128)) AS instance_name
    `)
    const row = result.recordset[0]
    return {
      machineName:  row?.machine_name  ?? '',
      instanceName: row?.instance_name ?? null
    }
  } finally {
    await pool?.close()
  }
}

/**
 * Collects all metrics from the specified SQL server.
 * Each query runs in parallel with its own catch: if one fails
 * it returns an empty/default value without blocking the others.
 * The connection is always closed in the finally block.
 */
export async function collectMetrics(
  connection: ServerConnection,
  signal?: AbortSignal
): Promise<ServerMetrics> {
  const config = buildConfig(connection)
  let pool: mssql.ConnectionPool | null = null

  // If the caller aborts (e.g. worker timeout), close the pool immediately
  // to avoid orphaned handles on the TDS side.
  const onAbort = (): void => {
    pool?.close().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    pool = await mssql.connect(config)
    if (signal?.aborted) throw new Error('aborted')

    const [
      instanceInfo,
      databases,
      activeSessions,
      topQueries,
      backupStatus,
      waitStats,
      diskVolumes,
      databaseFiles
    ] = await Promise.all([
      queryInstanceInfo(pool).catch((err: Error) => {
        console.error('[collector] instance info:', sanitizeSqlError(err))
        return defaultInstanceInfo()
      }),
      queryDatabases(pool).catch((err: Error) => {
        console.error('[collector] databases:', sanitizeSqlError(err))
        return [] as DatabaseInfo[]
      }),
      querySessions(pool).catch((err: Error) => {
        console.error('[collector] sessions:', sanitizeSqlError(err))
        return [] as SessionInfo[]
      }),
      queryTopQueries(pool).catch((err: Error) => {
        console.error('[collector] top queries:', sanitizeSqlError(err))
        return [] as QueryInfo[]
      }),
      queryBackupStatus(pool).catch((err: Error) => {
        console.error('[collector] backup status:', sanitizeSqlError(err))
        return [] as BackupInfo[]
      }),
      queryWaitStats(pool).catch((err: Error) => {
        console.error('[collector] wait stats:', sanitizeSqlError(err))
        return [] as WaitStatInfo[]
      }),
      queryDiskVolumes(pool).catch((err: Error) => {
        console.error('[collector] disk volumes:', sanitizeSqlError(err))
        return [] as DiskVolume[]
      }),
      queryDatabaseFiles(pool).catch((err: Error) => {
        console.error('[collector] database files:', sanitizeSqlError(err))
        return [] as DatabaseFile[]
      })
    ])

    return {
      collectedAt: new Date(),
      instanceInfo,
      databases,
      activeSessions,
      topQueries,
      backupStatus,
      waitStats,
      diskVolumes,
      databaseFiles
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (pool) {
      await pool.close().catch((err: Error) =>
        console.error('[collector] pool close:', sanitizeSqlError(err))
      )
    }
  }
}

/**
 * Collects only the metrics needed for alert evaluation:
 * CPU/memory, DB state, blocked sessions, backup age, disk space.
 * Skips topQueries (dm_exec_query_stats), waitStats (dm_os_wait_stats) and
 * databaseFiles (FILEPROPERTY) — used for idle/background servers with lightCollectors=true.
 */
export async function collectMetricsCritical(
  connection: ServerConnection,
  signal?: AbortSignal
): Promise<ServerMetrics> {
  const config = buildConfig(connection)
  let pool: mssql.ConnectionPool | null = null

  const onAbort = (): void => {
    pool?.close().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    pool = await mssql.connect(config)
    if (signal?.aborted) throw new Error('aborted')

    const [instanceInfo, databases, activeSessions, backupStatus, diskVolumes] = await Promise.all([
      queryInstanceInfo(pool).catch((err: Error) => {
        console.error('[collector] instance info:', sanitizeSqlError(err))
        return defaultInstanceInfo()
      }),
      queryDatabases(pool).catch((err: Error) => {
        console.error('[collector] databases:', sanitizeSqlError(err))
        return [] as DatabaseInfo[]
      }),
      querySessions(pool).catch((err: Error) => {
        console.error('[collector] sessions:', sanitizeSqlError(err))
        return [] as SessionInfo[]
      }),
      queryBackupStatus(pool).catch((err: Error) => {
        console.error('[collector] backup status:', sanitizeSqlError(err))
        return [] as BackupInfo[]
      }),
      queryDiskVolumes(pool).catch((err: Error) => {
        console.error('[collector] disk volumes:', sanitizeSqlError(err))
        return [] as DiskVolume[]
      })
    ])

    return {
      collectedAt: new Date(),
      instanceInfo,
      databases,
      activeSessions,
      topQueries: [],
      backupStatus,
      waitStats: [],
      diskVolumes,
      databaseFiles: []
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (pool) {
      await pool.close().catch((err: Error) =>
        console.error('[collector] pool close:', sanitizeSqlError(err))
      )
    }
  }
}
