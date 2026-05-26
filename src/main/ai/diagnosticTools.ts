import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { executeReadOnly } from './executeReadOnly'
import type { ServerConnection } from '../collectors/types'

// ---------------------------------------------------------------------------
// Live diagnostic tools — each queries the monitored SQL Server instance.
// All SQL is parameterless and read-only; executeReadOnly enforces this.
// ---------------------------------------------------------------------------

const SQL = {
  waitStats: `
    SELECT TOP 15
      wait_type,
      wait_time_ms,
      signal_wait_time_ms,
      waiting_tasks_count,
      CAST(100.0 * wait_time_ms / NULLIF(SUM(wait_time_ms) OVER (), 0) AS DECIMAL(5,2)) AS wait_pct
    FROM sys.dm_os_wait_stats
    WHERE wait_type NOT IN (
      'SLEEP_TASK','BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_AUTO_EVENT',
      'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT',
      'HADR_FILESTREAM_IOMGR_IOCOMPLETION','HADR_WORK_QUEUE',
      'LAZYWRITER_SLEEP','LOGMGR_QUEUE','ONDEMAND_TASK_QUEUE',
      'REQUEST_FOR_DEADLOCK_SEARCH','RESOURCE_QUEUE','SERVER_IDLE_CHECK',
      'SLEEP_DBSTARTUP','SLEEP_DCOMSTARTUP','SLEEP_MASTERDBREADY',
      'SLEEP_MASTERMDREADY','SLEEP_MASTERUPGRADED','SLEEP_MSDBSTARTUP',
      'SLEEP_SYSTEMTASK','SLEEP_TEMPDBSTARTUP','SNI_HTTP_ACCEPT',
      'SP_SERVER_DIAGNOSTICS_SLEEP','SQLTRACE_BUFFER_FLUSH',
      'SQLTRACE_INCREMENTAL_FLUSH_SLEEP','WAITFOR','XE_DISPATCHER_WAIT',
      'XE_TIMER_EVENT','BROKER_EVENTHANDLER','CHECKPOINT_QUEUE',
      'DBMIRROR_EVENTS_QUEUE','SQLTRACE_WAIT_ENTRIES'
    )
    ORDER BY wait_time_ms DESC
  `,

  blockingSessions: `
    SELECT
      r.session_id,
      r.blocking_session_id,
      r.wait_type,
      r.wait_time / 1000 AS wait_sec,
      r.status,
      SUBSTRING(st.text, 1, 200) AS current_sql,
      s.login_name,
      s.host_name,
      DB_NAME(r.database_id) AS db_name
    FROM sys.dm_exec_requests r
    JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
    CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
    WHERE r.blocking_session_id > 0
    ORDER BY r.wait_time DESC
  `,

  topQueries: `
    SELECT TOP 10
      qs.execution_count,
      qs.total_elapsed_time / 1000 AS total_elapsed_ms,
      qs.total_worker_time / 1000 AS total_cpu_ms,
      qs.total_logical_reads,
      CAST(qs.total_elapsed_time / NULLIF(qs.execution_count, 0) / 1000.0 AS DECIMAL(12,2)) AS avg_elapsed_ms,
      SUBSTRING(st.text, 1, 300) AS query_text,
      DB_NAME(st.dbid) AS db_name
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
    ORDER BY qs.total_elapsed_time DESC
  `,

  diskUsage: `
    SELECT
      volume_mount_point,
      logical_volume_name,
      CAST(total_bytes / 1073741824.0 AS DECIMAL(10,2)) AS total_gb,
      CAST(available_bytes / 1073741824.0 AS DECIMAL(10,2)) AS free_gb,
      CAST(100.0 * (1 - CAST(available_bytes AS FLOAT) / total_bytes) AS DECIMAL(5,2)) AS used_pct
    FROM sys.dm_os_volume_stats(1, 1)
    UNION
    SELECT
      v.volume_mount_point,
      v.logical_volume_name,
      CAST(v.total_bytes / 1073741824.0 AS DECIMAL(10,2)),
      CAST(v.available_bytes / 1073741824.0 AS DECIMAL(10,2)),
      CAST(100.0 * (1 - CAST(v.available_bytes AS FLOAT) / v.total_bytes) AS DECIMAL(5,2))
    FROM sys.master_files mf
    CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) v
    WHERE mf.file_id = 1 AND mf.database_id > 4
  `,

  backupStatus: `
    WITH last_full_backup AS (
      SELECT
        database_name,
        MAX(backup_finish_date) AS last_full_backup_finish_date
      FROM msdb.dbo.backupset
      WHERE type = 'D'
      GROUP BY database_name
    )
    SELECT
      d.name AS database_name,
      d.state_desc,
      d.recovery_model_desc,
      b.last_full_backup_finish_date,
      DATEDIFF(hour, b.last_full_backup_finish_date, GETDATE()) AS hours_since_last_full_backup
    FROM sys.databases d
    LEFT JOIN last_full_backup b ON b.database_name = d.name
    WHERE d.database_id > 4
    ORDER BY
      CASE WHEN b.last_full_backup_finish_date IS NULL THEN 0 ELSE 1 END,
      b.last_full_backup_finish_date ASC
  `,

  cpuHistory: `
    SELECT TOP 30
      record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu_pct,
      record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS idle_pct,
      DATEADD(ms, -1 * (si.cpu_ticks / CONVERT(FLOAT, si.ms_ticks) - rgh.timestamp), GETDATE()) AS sample_time
    FROM (
      SELECT timestamp, CONVERT(XML, record) AS record
      FROM sys.dm_os_ring_buffers
      WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
        AND record LIKE '%<SystemHealth>%'
    ) rgh
    CROSS JOIN sys.dm_os_sys_info si
    ORDER BY sample_time DESC
  `
}

// Build a set of diagnostic tools scoped to one server connection.
// The connection is closed over in each tool's func so the agent
// doesn't need to pass credentials through tool arguments.
export function buildDiagnosticTools(conn: ServerConnection): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'get_wait_stats',
      description:
        'Returns the top 15 SQL Server wait types by total wait time. Use to identify resource bottlenecks (CPU, I/O, locks, network).',
      schema: z.object({}),
      func: async () => {
        const rows = await executeReadOnly(conn, SQL.waitStats)
        return JSON.stringify(rows)
      }
    }),

    new DynamicStructuredTool({
      name: 'get_blocking_sessions',
      description:
        'Returns all currently blocked sessions with blocker ID, wait type, duration, and SQL text. Use when blocking_sessions alert is active.',
      schema: z.object({}),
      func: async () => {
        const rows = await executeReadOnly(conn, SQL.blockingSessions)
        return JSON.stringify(rows)
      }
    }),

    new DynamicStructuredTool({
      name: 'get_top_queries',
      description:
        'Returns the 10 most expensive queries by total elapsed time, including CPU, reads, and query text.',
      schema: z.object({}),
      func: async () => {
        const rows = await executeReadOnly(conn, SQL.topQueries)
        return JSON.stringify(rows)
      }
    }),

    new DynamicStructuredTool({
      name: 'get_disk_usage',
      description:
        'Returns disk volume usage (total GB, free GB, used %) for volumes hosting SQL Server data/log files.',
      schema: z.object({}),
      func: async () => {
        const rows = await executeReadOnly(conn, SQL.diskUsage)
        return JSON.stringify(rows)
      }
    }),

    new DynamicStructuredTool({
      name: 'get_backup_status',
      description:
        'Returns each user database with state, recovery model, last full backup finish time, and hours since last full backup. Use first for backup_overdue incidents.',
      schema: z.object({}),
      func: async () => {
        const rows = await executeReadOnly(conn, SQL.backupStatus)
        return JSON.stringify(rows)
      }
    }),

    new DynamicStructuredTool({
      name: 'get_cpu_history',
      description:
        'Returns SQL Server CPU utilization from the ring buffer for the last ~30 samples (approx. last hour). Use to see CPU trend.',
      schema: z.object({}),
      func: async () => {
        const rows = await executeReadOnly(conn, SQL.cpuHistory)
        return JSON.stringify(rows)
      }
    })
  ]
}
