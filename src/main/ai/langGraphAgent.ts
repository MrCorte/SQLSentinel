import { createReactAgent } from '@langchain/langgraph/prebuilt'
import type { AiStreamEvent } from '../ipc/types'
import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as serverStore from '../store/serverStore'
import * as metricsRepository from '../store/metricsRepository'
import { getAlerts } from '../metricsWorker'
import { searchFts } from '../store/ftsRepository'

// Per-request event emitter — set in langGraphStream, null otherwise
let _onEvent: ((ev: AiStreamEvent) => void) | null = null

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return (content as { type?: string; text?: string }[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
  return ''
}

async function withToolEvents<T>(name: string, fn: () => Promise<T>): Promise<T> {
  _onEvent?.({ type: 'tool_start', name })
  try {
    const result = await fn()
    _onEvent?.({ type: 'tool_end', name, output: String(result).slice(0, 2000) })
    return result
  } catch (err) {
    _onEvent?.({ type: 'tool_end', name, output: String(err) })
    throw err
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert SQL Server DBA assistant. ALWAYS respond in English.

Your ONLY source of T-SQL queries and technical explanations is the Documentation provided in the context.
- If the Documentation contains a T-SQL query relevant to the question, copy it VERBATIM.
- Do NOT invent or modify T-SQL queries. If the documentation has no relevant query, say so explicitly.
- Use SELECT-only queries, never DML (INSERT/UPDATE/DELETE/DROP/EXEC).

Structure every response with:
**OBSERVATION**: what the documentation says about the topic
**PROBABLE CAUSE**: diagnosis based on documentation and server data (if available)
**IMMEDIATE ACTION**: T-SQL query copied verbatim from the documentation
**NEXT CHECKS**: follow-up actions suggested by the documentation`

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
  description:
    'Current metrics for all monitored servers: CPU %, RAM, blocking sessions, offline databases.',
  schema: z.object({}),
  func: () => withToolEvents('get_server_metrics', async () => {
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
  })
})

const getRecentAlertsTool = new DynamicStructuredTool({
  name: 'get_recent_alerts',
  description: 'Active alerts (CRITICAL and WARNING) from the last 24 hours.',
  schema: z.object({}),
  func: () => withToolEvents('get_recent_alerts', async () => {
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
  })
})

const getSlowQueriesTool = new DynamicStructuredTool({
  name: 'get_slow_queries',
  description: 'Top 10 slowest queries (by total elapsed time) across all monitored instances.',
  schema: z.object({}),
  func: () => withToolEvents('get_slow_queries', async () => {
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
  })
})

const getServerNotesTool = new DynamicStructuredTool({
  name: 'get_server_notes',
  description:
    'DBA notes associated with servers: environment, application, criticality, contacts.',
  schema: z.object({}),
  func: () => withToolEvents('get_server_notes', async () =>
    JSON.stringify(
      serverStore
        .getAll()
        .filter((s) => s.notes)
        .map((s) => ({ host: s.host ?? s.ip, notes: s.notes }))
    )
  )
})

const TSQL_MAP: Record<string, string> = {
  cpu_high: `SELECT TOP 10
  total_worker_time / execution_count AS avg_cpu_ms,
  execution_count,
  SUBSTRING(text, 1, 200) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle)
ORDER BY total_worker_time DESC`,

  slow_queries: `SELECT TOP 10
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

  connections: `SELECT
  DB_NAME(database_id) AS db,
  COUNT(*) AS conn,
  login_name
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
GROUP BY database_id, login_name
ORDER BY COUNT(*) DESC`,

  compatibility_level: `SELECT
  name,
  compatibility_level,
  CASE compatibility_level
    WHEN 160 THEN 'SQL Server 2022'
    WHEN 150 THEN 'SQL Server 2019'
    WHEN 140 THEN 'SQL Server 2017'
    WHEN 130 THEN 'SQL Server 2016'
    WHEN 120 THEN 'SQL Server 2014'
    WHEN 110 THEN 'SQL Server 2012'
    ELSE 'Other/Unknown'
  END AS version_label,
  state_desc,
  user_access_desc
FROM sys.databases
ORDER BY name`,

  always_on: `SELECT
  ag.name                                         AS ag_name,
  ar.replica_server_name                          AS replica,
  ar.availability_mode_desc,
  ar.failover_mode_desc,
  ars.role_desc                                   AS role,
  ars.operational_state_desc,
  ars.connected_state_desc,
  ars.synchronization_health_desc                 AS sync_health,
  drs.database_name,
  drs.synchronization_state_desc                  AS db_sync_state,
  drs.synchronization_health_desc                 AS db_sync_health,
  drs.log_send_queue_size                         AS log_send_queue_kb,
  drs.redo_queue_size                             AS redo_queue_kb,
  drs.last_commit_time
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar
  ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states ars
  ON ar.replica_id = ars.replica_id
LEFT JOIN sys.dm_hadr_database_replica_states drs
  ON ars.replica_id = drs.replica_id
ORDER BY ag.name, ars.role_desc, ar.replica_server_name`
}

const suggestTSQLTool = new DynamicStructuredTool({
  name: 'suggest_tsql',
  description:
    'Returns a ready-to-run diagnostic T-SQL query. Call with one of: cpu_high, slow_queries, blocking, backup, disk, connections, always_on, compatibility_level.',
  schema: z.object({
    problema: z.string()
  }),
  func: ({ problema }: { problema: string }) => withToolEvents('suggest_tsql', async () => {
    const lower = problema.toLowerCase()
    const ALIASES: Record<string, string> = {
      'always on': 'always_on',
      'availability group': 'always_on',
      hadr: 'always_on',
      ag_health: 'always_on',
      replica: 'always_on',
      'compatibility level': 'compatibility_level',
      compat: 'compatibility_level',
      dbcompat: 'compatibility_level'
    }
    const aliasKey = Object.keys(ALIASES).find((a) => lower.includes(a))
    if (aliasKey) return TSQL_MAP[ALIASES[aliasKey]]
    const key = Object.keys(TSQL_MAP).find(
      (k) => lower.includes(k) || lower.includes(k.replace(/_/g, ' '))
    )
    return key
      ? TSQL_MAP[key]
      : 'No predefined query for this topic. Use search_sql_documentation to find a relevant query from the indexed books.'
  })
})

// ---------------------------------------------------------------------------
// Tool: search_sql_documentation (FTS5)
// ---------------------------------------------------------------------------

const searchDocumentationTool = new DynamicStructuredTool({
  name: 'search_sql_documentation',
  description:
    'Search SQL Server books for relevant passages. ALWAYS call with English keywords regardless of the user language, e.g. "compatibility level", "index fragmentation", "blocking sessions", "always on replica".',
  schema: z.object({
    query: z.string()
  }),
  func: ({ query }: { query: string }) => withToolEvents('search_sql_documentation', async () => {
    if (!query || query.includes('"type"') || query.includes('"description"')) {
      return 'Knowledge base not available or no results found.'
    }
    const results = searchFts(query, 5)
    if (results.length === 0) return 'Knowledge base not available or no results found.'
    return results
      .map((r, i) => `[Excerpt ${i + 1} — ${r.title}]\n${r.content}`)
      .join('\n\n---\n\n')
  })
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

let _llm: ChatOllama | null = null
let _agent: ReturnType<typeof createReactAgent> | null = null

function getLlm(): ChatOllama {
  if (!_llm) {
    _llm = new ChatOllama({
      model: 'llama3.2:3b',
      baseUrl: 'http://localhost:11434',
      temperature: 0,
      numPredict: 768,
      numCtx: 8192
    })
  }
  return _llm
}

function getAgent(): ReturnType<typeof createReactAgent> {
  if (_agent) return _agent
  _agent = createReactAgent({
    llm: getLlm(),
    tools: agentTools,
    stateModifier: SYSTEM_PROMPT
  })
  return _agent
}

export function resetAgent(): void {
  _agent = null
}

// ---------------------------------------------------------------------------
// Model warm-up — loads llama3.2:3b into Ollama memory before first query
// ---------------------------------------------------------------------------

let _warmedUp = false

export async function warmupModel(): Promise<void> {
  if (_warmedUp) return
  try {
    console.log('[AI] warming up llama3.2:3b via /api/chat...')
    // Use /api/chat (same endpoint as LangChain ChatOllama) to ensure the model
    // is fully loaded into memory before the first real request.
    await getLlm().invoke([new HumanMessage('hi')], { signal: AbortSignal.timeout(180_000) })
    _warmedUp = true
    console.log('[AI] model warm-up complete')
  } catch {
    // best-effort — ignore if Ollama isn't running yet
  }
}

let _activeAbortController: AbortController | null = null

export function abortActiveStream(): void {
  _activeAbortController?.abort()
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
    ...history
      .slice(-6)
      .map((h) => (h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content))),
    new HumanMessage(question)
  ]

  const result = await agent.invoke(
    { messages },
    { recursionLimit: 10, signal: AbortSignal.timeout(60_000) }
  )
  if (!result.messages?.length) throw new Error('Agent returned no messages')
  const last = result.messages[result.messages.length - 1]

  if (typeof last.content === 'string') return last.content
  if (Array.isArray(last.content)) {
    return (last.content as unknown[])
      .filter(
        (b): b is { type: 'text'; text: string } =>
          typeof b === 'object' && b !== null && 'text' in b
      )
      .map((b) => b.text)
      .join('')
  }
  return JSON.stringify(last.content)
}

export async function langGraphStream(
  question: string,
  history: AgentHistory[],
  onEvent: (event: AiStreamEvent) => void
): Promise<void> {
  const controller = new AbortController()
  _activeAbortController = controller
  _onEvent = onEvent

  const timeoutId = setTimeout(() => controller.abort(), 300_000)

  try {
    // Step 1 — call tools in parallel; each emits tool_start/tool_end via withToolEvents
    const [metrics, alerts, docs] = await Promise.all([
      getServerMetricsTool.invoke({}),
      getRecentAlertsTool.invoke({}),
      searchDocumentationTool.invoke({ query: question })
    ])

    if (controller.signal.aborted) {
      onEvent({ type: 'error', message: 'Cancelled' })
      return
    }

    // Step 2 — build context: documentation first (highest priority), then live server data
    const NO_DOCS = 'Knowledge base not available or no results found.'
    const contextParts: string[] = []

    if (docs !== NO_DOCS) contextParts.push(`Documentation (source of truth):\n${docs.slice(0, 2500)}`)

    // Server state — only include if non-trivial (not empty arrays)
    const metricsObj = JSON.parse(metrics) as unknown[]
    if (metricsObj.length > 0) contextParts.push(`Server Metrics:\n${metrics}`)
    const alertsObj = JSON.parse(alerts) as unknown[]
    if (alertsObj.length > 0) contextParts.push(`Recent Alerts:\n${alerts}`)

    const context = contextParts.join('\n\n---\n\n')

    // Step 3 — stream LLM response directly (no ReAct loop)
    const msgs = [
      new SystemMessage(`${SYSTEM_PROMPT}\n\nContext:\n${context.slice(0, 4000)}`),
      ...history
        .slice(-4)
        .map((h) => (h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content))),
      new HumanMessage(question)
    ]

    const stream = await getLlm().stream(msgs, { signal: controller.signal })
    for await (const chunk of stream) {
      if (controller.signal.aborted) break
      const tok = extractText(chunk.content)
      if (tok) onEvent({ type: 'token', text: tok })
    }

    onEvent({ type: 'done' })
  } catch (err) {
    const msg = controller.signal.aborted ? 'Cancelled' : err instanceof Error ? err.message : String(err)
    onEvent({ type: 'error', message: msg })
  } finally {
    clearTimeout(timeoutId)
    _onEvent = null
    if (_activeAbortController === controller) _activeAbortController = null
  }
}
