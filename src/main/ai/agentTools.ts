import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as serverStore from '../store/serverStore'
import * as metricsRepository from '../store/metricsRepository'
import { getAlerts } from '../metricsWorker'

// ---------------------------------------------------------------------------
// Tool: get_server_metrics
// ---------------------------------------------------------------------------

export const getServerMetricsTool = new DynamicStructuredTool({
  name: 'get_server_metrics',
  description: 'Metriche correnti di tutti i server monitorati: CPU %, RAM, sessioni bloccanti, DB offline.',
  schema: z.object({}),
  func: async () => {
    const servers = serverStore.getAll()
    const ids = servers.map((s) => `${s.host ?? s.ip}:${s.port}`)
    const bulk = metricsRepository.findLastNBulk(ids, 1)
    const result = servers.map((s) => {
      const key = `${s.host ?? s.ip}:${s.port}`
      const snaps = bulk[key]
      const snap = snaps && snaps.length > 0 ? snaps[0] : undefined
      return {
        server: key,
        unreachable: s.unreachable ?? false,
        cpu: snap?.instanceInfo.cpuUsagePercent ?? null,
        memUsedMb: snap?.instanceInfo.memoryUsedMb ?? null,
        memTargetMb: snap?.instanceInfo.memoryTargetMb ?? null,
        blockingSessions: snap?.activeSessions.filter((se) => se.blockingSessionId > 0).length ?? 0,
        offlineDbs: snap?.databases.filter((d) => d.stateDesc !== 'ONLINE').map((d) => d.name) ?? []
      }
    })
    return JSON.stringify(result)
  }
})

// ---------------------------------------------------------------------------
// Tool: get_recent_alerts
// ---------------------------------------------------------------------------

export const getRecentAlertsTool = new DynamicStructuredTool({
  name: 'get_recent_alerts',
  description: 'Alert attivi (CRITICAL e WARNING) nelle ultime 24 ore.',
  schema: z.object({}),
  func: async () => {
    const cutoff = Date.now() - 86400000
    const alerts = getAlerts()
      .filter((a) => new Date(a.detectedAt).getTime() >= cutoff)
      .slice(-20)
      .map((a) => ({
        server: a.serverId,
        category: a.category,
        severity: a.severity,
        message: a.message,
        at: new Date(a.detectedAt).toISOString()
      }))
    return JSON.stringify(alerts)
  }
})

// ---------------------------------------------------------------------------
// Tool: get_slow_queries
// ---------------------------------------------------------------------------

export const getSlowQueriesTool = new DynamicStructuredTool({
  name: 'get_slow_queries',
  description: 'Top 10 query più lente (per elapsed time totale) da tutte le istanze monitorate.',
  schema: z.object({}),
  func: async () => {
    const servers = serverStore.getAll()
    const ids = servers.map((s) => `${s.host ?? s.ip}:${s.port}`)
    const bulk = metricsRepository.findLastNBulk(ids, 1)
    const queries = Object.entries(bulk).flatMap(([serverId, snaps]) => {
      const snap = snaps && snaps.length > 0 ? snaps[0] : undefined
      return (snap?.topQueries ?? []).map((q) => ({
        server: serverId,
        queryText: q.queryText.slice(0, 150),
        executionCount: q.executionCount,
        totalElapsedTimeMs: q.totalElapsedTimeMs,
        avgCpuTimeMs: q.avgCpuTimeMs
      }))
    })
    queries.sort((a, b) => b.totalElapsedTimeMs - a.totalElapsedTimeMs)
    return JSON.stringify(queries.slice(0, 10))
  }
})

// ---------------------------------------------------------------------------
// Tool: get_server_notes
// ---------------------------------------------------------------------------

export const getServerNotesTool = new DynamicStructuredTool({
  name: 'get_server_notes',
  description: 'Note DBA associate ai server: ambiente, applicazione, criticità, contatti.',
  schema: z.object({}),
  func: async () => {
    return JSON.stringify(
      serverStore
        .getAll()
        .filter((s) => s.notes)
        .map((s) => ({ host: s.host ?? s.ip, notes: s.notes }))
    )
  }
})

// ---------------------------------------------------------------------------
// Tool: suggest_tsql
// ---------------------------------------------------------------------------

const TSQL_MAP: Record<string, string> = {
  cpu_alta: `SELECT TOP 10
  total_worker_time / execution_count AS avg_cpu_ms,
  execution_count,
  SUBSTRING(text, 1, 200) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle)
ORDER BY total_worker_time DESC`,

  query_lente: `SELECT TOP 10
  total_elapsed_time / execution_count AS avg_elapsed_ms,
  execution_count,
  SUBSTRING(text, 1, 200) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle)
ORDER BY total_elapsed_time DESC`,

  blocking: `SELECT
  r.blocking_session_id,
  r.session_id,
  r.wait_type,
  r.wait_time,
  SUBSTRING(st.text, (r.statement_start_offset/2)+1, 200) AS query
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE r.blocking_session_id > 0`,

  backup: `SELECT
  database_name,
  type_desc,
  backup_finish_date,
  DATEDIFF(HOUR, backup_finish_date, GETDATE()) AS ore_fa
FROM msdb.dbo.backupset
WHERE backup_finish_date > DATEADD(DAY, -7, GETDATE())
ORDER BY backup_finish_date DESC`,

  disk: `SELECT
  volume_mount_point,
  total_bytes / 1073741824 AS total_gb,
  available_bytes / 1073741824 AS free_gb,
  CAST(available_bytes * 100.0 / total_bytes AS INT) AS free_pct
FROM sys.dm_os_volume_stats(1, 1)`,

  connessioni: `SELECT
  DB_NAME(database_id) AS db,
  COUNT(*) AS conn,
  login_name
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
GROUP BY database_id, login_name
ORDER BY COUNT(*) DESC`
}

export const suggestTSQLTool = new DynamicStructuredTool({
  name: 'suggest_tsql',
  description: 'Restituisce una query T-SQL diagnostica pronta per un problema specifico SQL Server.',
  schema: z.object({
    problema: z.string().describe('Tipo di problema: cpu_alta | query_lente | blocking | backup | disk | connessioni')
  }),
  func: async ({ problema }: { problema: string }) => {
    const lower = problema.toLowerCase()
    const key = Object.keys(TSQL_MAP).find(
      (k) => lower.includes(k) || lower.includes(k.replace('_', ' '))
    )
    return key ? TSQL_MAP[key] : TSQL_MAP.cpu_alta
  }
})

// ---------------------------------------------------------------------------
// Exported tool list
// ---------------------------------------------------------------------------

export const agentTools = [
  getServerMetricsTool,
  getRecentAlertsTool,
  getSlowQueriesTool,
  getServerNotesTool,
  suggestTSQLTool
]
