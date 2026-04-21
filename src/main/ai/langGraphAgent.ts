import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as serverStore from '../store/serverStore'
import * as metricsRepository from '../store/metricsRepository'
import { getAlerts } from '../metricsWorker'
import { retrieveTopK } from '../store/ragRepository'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert SQL Server DBA. ALWAYS respond in English.
Before answering, use the tools to gather real data about the monitored servers.

Structure the response with these sections:
**OBSERVATION**: relevant data found via the tools
**PROBABLE CAUSE**: diagnosis based on the data
**IMMEDIATE ACTION**: use suggest_tsql and show the ready-to-run T-SQL query
**NEXT CHECKS**: list of recommended follow-up actions

Use SELECT-only queries, never DML (no INSERT/UPDATE/DELETE/DROP).
If you do not have enough data, write "I need more context."`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentHistory {
  role: 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// Tools (LangChain format)
// ---------------------------------------------------------------------------

const getServerMetricsTool = new DynamicStructuredTool({
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

const getRecentAlertsTool = new DynamicStructuredTool({
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

const getSlowQueriesTool = new DynamicStructuredTool({
  name: 'get_slow_queries',
  description: 'Top 10 slowest queries (by total elapsed time) across all monitored instances.',
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

const getServerNotesTool = new DynamicStructuredTool({
  name: 'get_server_notes',
  description: 'DBA notes associated with servers: environment, application, criticality, contacts.',
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

const suggestTSQLTool = new DynamicStructuredTool({
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
// Tool: search_sql_documentation (RAG)
// ---------------------------------------------------------------------------

let _embeddings: OllamaEmbeddings | null = null

function getEmbeddings(): OllamaEmbeddings {
  if (!_embeddings) {
    _embeddings = new OllamaEmbeddings({
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434'
    })
  }
  return _embeddings
}

const searchDocumentationTool = new DynamicStructuredTool({
  name: 'search_sql_documentation',
  description:
    'Search SQL Server books (DMV, troubleshooting, performance tuning) for the most relevant passages for a technical question. Use when citing best practices or explanations from the books.',
  schema: z.object({
    query: z.string().describe('The technical question to search for in the SQL Server books')
  }),
  func: async ({ query }: { query: string }) => {
    try {
      const vec = await getEmbeddings().embedQuery(query)
      const results = retrieveTopK(vec, 5)
      if (results.length === 0) return 'No documents indexed yet.'
      return results.map((r, i) => `[Excerpt ${i + 1}]\n${r.text}`).join('\n\n---\n\n')
    } catch {
      return 'Documentation not available (nomic-embed-text not installed or Ollama unreachable).'
    }
  }
})

const agentTools = [
  getServerMetricsTool,
  getRecentAlertsTool,
  getSlowQueriesTool,
  getServerNotesTool,
  suggestTSQLTool,
  searchDocumentationTool
]

// ---------------------------------------------------------------------------
// Lazy agent factory (singleton, created on first use)
// ---------------------------------------------------------------------------

let _agent: ReturnType<typeof createReactAgent> | null = null

function getAgent(): ReturnType<typeof createReactAgent> {
  if (_agent) return _agent
  const llm = new ChatOllama({
    model: 'llama3.2:3b',
    baseUrl: 'http://localhost:11434',
    temperature: 0,
    numPredict: 512,
    numCtx: 4096
  })
  _agent = createReactAgent({
    llm,
    tools: agentTools,
    stateModifier: SYSTEM_PROMPT
  })
  return _agent
}

export function resetAgent(): void {
  _agent = null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function langGraphAsk(
  question: string,
  history: AgentHistory[] = []
): Promise<string> {
  const agent = getAgent()

  const messages = [
    ...history.slice(-6).map((h) =>
      h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content)
    ),
    new HumanMessage(question)
  ]

  const result = await agent.invoke(
    { messages },
    { recursionLimit: 10, signal: AbortSignal.timeout(60_000) }
  )
  const last = result.messages[result.messages.length - 1]

  if (typeof last.content === 'string') return last.content
  if (Array.isArray(last.content)) {
    return (last.content as unknown[])
      .filter((b): b is { type: 'text'; text: string } => typeof b === 'object' && b !== null && 'text' in b)
      .map((b) => b.text)
      .join('')
  }
  return JSON.stringify(last.content)
}
