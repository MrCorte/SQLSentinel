import * as mssql from 'mssql'
import type {
  ServerConnection,
  ServerMetrics,
  InstanceInfo,
  DatabaseInfo,
  SessionInfo,
  QueryInfo,
  BackupInfo
} from './types'

// --- Tipi interni per le righe restituite dalle query T-SQL ---

interface InstanceInfoRow {
  version: string
  edition: string
  memory_used_mb: number
  cpu_usage_percent: number
  uptime_days: number
}

interface DatabaseInfoRow {
  name: string
  state_desc: string
  recovery_model: string
  size_mb: number
  log_size_mb: number
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

// --- Configurazione connessione ---

function buildConfig(conn: ServerConnection): mssql.config {
  const base: mssql.config = {
    server: conn.ip,
    port: conn.port,
    database: 'master',
    // requestTimeout è direttamente su config (non in options)
    requestTimeout: 30000,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      // connectTimeout è in options (via IOptions extends tds.ConnectionOptions)
      connectTimeout: 15000
      // instanceName NON passato: SQL Browser è disabilitato e la porta è sempre esplicita
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
      DATEDIFF(DAY, osi.sqlserver_start_time, GETDATE()) AS uptime_days
    FROM sys.dm_os_process_memory pm
    CROSS JOIN sys.dm_os_sys_info osi
  `

  const result = await pool.request().query<InstanceInfoRow>(sql)
  const row = result.recordset[0]

  return {
    version: row.version,
    edition: row.edition ?? '',
    memoryUsedMb: Number(row.memory_used_mb),
    cpuUsagePercent: Number(row.cpu_usage_percent),
    uptimeDays: Number(row.uptime_days)
  }
}

/**
 * Elenco database con stato, recovery model e dimensioni.
 * Fonte: sys.databases JOIN sys.master_files GROUP BY
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
           AS DECIMAL(18,2))                                                    AS log_size_mb
    FROM sys.databases d
    INNER JOIN sys.master_files mf ON d.database_id = mf.database_id
    GROUP BY d.name, d.state_desc, d.recovery_model_desc
    ORDER BY d.name
  `

  const result = await pool.request().query<DatabaseInfoRow>(sql)

  return result.recordset.map((row) => ({
    name: row.name,
    stateDesc: row.state_desc,
    recoveryModel: row.recovery_model,
    sizeMb: Number(row.size_mb),
    logSizeMb: Number(row.log_size_mb)
  }))
}

/**
 * Sessioni attive (session_id > 50 = no sessioni di sistema).
 * Fonte: sys.dm_exec_requests
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
 * Top 20 query per elapsed time totale.
 * Fonte: sys.dm_exec_query_stats CROSS APPLY sys.dm_exec_sql_text
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
      (qs.total_worker_time / qs.execution_count) / 1000   AS avg_cpu_time_ms,
      qs.total_logical_reads / qs.execution_count          AS avg_logical_reads
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
    ORDER BY qs.total_elapsed_time DESC
  `

  const result = await pool.request().query<QueryInfoRow>(sql)

  return result.recordset.map((row) => ({
    queryText: row.query_text,
    executionCount: Number(row.execution_count),
    totalElapsedTimeMs: Number(row.total_elapsed_time_ms),
    avgCpuTimeMs: Number(row.avg_cpu_time_ms),
    avgLogicalReads: Number(row.avg_logical_reads)
  }))
}

/**
 * Stato backup per ogni database (ultimi 7 giorni).
 * Fonte: msdb.dbo.backupset GROUP BY database_name, type
 */
async function queryBackupStatus(pool: mssql.ConnectionPool): Promise<BackupInfo[]> {
  const sql = `
    SELECT
      bs.database_name                                                          AS database_name,
      MAX(CASE WHEN bs.type = 'D' THEN bs.backup_finish_date ELSE NULL END)    AS last_full_backup,
      MAX(CASE WHEN bs.type = 'I' THEN bs.backup_finish_date ELSE NULL END)    AS last_diff_backup,
      MAX(CASE WHEN bs.type = 'L' THEN bs.backup_finish_date ELSE NULL END)    AS last_log_backup
    FROM msdb.dbo.backupset bs
    WHERE bs.backup_finish_date >= DATEADD(DAY, -7, GETDATE())
    GROUP BY bs.database_name
    ORDER BY bs.database_name
  `

  const result = await pool.request().query<BackupInfoRow>(sql)

  return result.recordset.map((row) => ({
    databaseName: row.database_name,
    lastFullBackup: row.last_full_backup,
    lastDiffBackup: row.last_diff_backup,
    lastLogBackup: row.last_log_backup
  }))
}

// --- Valori di default per query fallite ---

function defaultInstanceInfo(): InstanceInfo {
  return { version: 'unknown', edition: 'unknown', memoryUsedMb: 0, cpuUsagePercent: 0, uptimeDays: 0 }
}

// --- Entry point pubblico ---

/**
 * Raccoglie tutte le metriche dal server SQL indicato.
 * Ogni query gira in parallelo con il proprio catch: se una fallisce
 * restituisce un valore vuoto/default senza bloccare le altre.
 * La connessione viene sempre chiusa nel finally.
 */
export async function collectMetrics(connection: ServerConnection): Promise<ServerMetrics> {
  const config = buildConfig(connection)
  let pool: mssql.ConnectionPool | null = null

  try {
    pool = await mssql.connect(config)

    const [instanceInfo, databases, activeSessions, topQueries, backupStatus] = await Promise.all([
      queryInstanceInfo(pool).catch((err: Error) => {
        console.error('[collector] instance info:', err.message)
        return defaultInstanceInfo()
      }),
      queryDatabases(pool).catch((err: Error) => {
        console.error('[collector] databases:', err.message)
        return [] as DatabaseInfo[]
      }),
      querySessions(pool).catch((err: Error) => {
        console.error('[collector] sessions:', err.message)
        return [] as SessionInfo[]
      }),
      queryTopQueries(pool).catch((err: Error) => {
        console.error('[collector] top queries:', err.message)
        return [] as QueryInfo[]
      }),
      queryBackupStatus(pool).catch((err: Error) => {
        console.error('[collector] backup status:', err.message)
        return [] as BackupInfo[]
      })
    ])

    return { collectedAt: new Date(), instanceInfo, databases, activeSessions, topQueries, backupStatus }
  } finally {
    if (pool) {
      await pool.close().catch((err: Error) => console.error('[collector] pool close:', err.message))
    }
  }
}
