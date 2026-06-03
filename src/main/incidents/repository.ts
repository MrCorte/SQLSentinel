import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import * as sql from 'mssql'
import { getPool } from '../store/sqlserver/connection'
import type {
  Incident,
  IncidentEvent,
  IncidentAction,
  IncidentAiStats,
  IncidentAuditEntry,
  IncidentAuditTelemetry,
  IncidentStatus,
  IncidentEventKind,
  ActionStatus,
  ActionSource
} from './types'
import type { AlertCategory, AlertSeverity } from '../ipc/types'

// ---------------------------------------------------------------------------
// Row shapes (SQL Server → TypeScript)
// ---------------------------------------------------------------------------

interface IncidentRow {
  id: string
  server_id: string
  category: string
  severity: string
  status: string
  opened_at: string | number
  resolved_at: string | number | null
  summary: string | null
  root_cause_md: string | null
  group_count?: number
}

interface IncidentEventRow {
  id: string
  incident_id: string
  kind: string
  payload_json: string
  at: string | number
}

interface IncidentActionRow {
  id: string
  incident_id: string | null
  server_id: string | null
  source: string | null
  tool_name: string
  params_json: string
  tsql_preview: string
  explanation: string
  status: string
  approved_by: string | null
  executed_at: string | number | null
  result_json: string | null
  rejection_reason: string | null
}

interface IncidentAuditRow {
  id: string
  incident_id: string
  provider: string
  model: string
  prompt_hash: string
  response_hash: string
  tokens_in: number | null
  tokens_out: number | null
  duration_ms: number | null
  tool_call_count: number | null
  error: string | null
  at: string | number
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

// mssql may return BIGINT columns as string when values exceed Number.MAX_SAFE_INTEGER.
// Epoch-millis fits in a Number for the next ~285k years, but we normalise defensively.
function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0
  return typeof v === 'number' ? v : Number(v)
}

function toNumOrNull(v: string | number | null | undefined): number | null {
  if (v == null) return null
  return typeof v === 'number' ? v : Number(v)
}

function rowToIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    serverId: row.server_id,
    category: row.category as AlertCategory,
    severity: row.severity as AlertSeverity,
    status: row.status as IncidentStatus,
    openedAt: toNum(row.opened_at),
    resolvedAt: toNumOrNull(row.resolved_at) ?? undefined,
    summary: row.summary ?? undefined,
    rootCauseMd: row.root_cause_md ?? undefined,
    count: row.group_count
  }
}

function rowToEvent(row: IncidentEventRow): IncidentEvent {
  return {
    id: row.id,
    incidentId: row.incident_id,
    kind: row.kind as IncidentEventKind,
    payload: JSON.parse(row.payload_json) as unknown,
    at: toNum(row.at)
  }
}

function rowToAction(row: IncidentActionRow): IncidentAction {
  return {
    id: row.id,
    incidentId: row.incident_id,
    ...(row.server_id != null && { serverId: row.server_id }),
    source: row.source === 'chat' ? 'chat' : 'incident',
    toolName: row.tool_name,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    tsqlPreview: row.tsql_preview,
    explanation: row.explanation,
    status: row.status as ActionStatus,
    approvedBy: row.approved_by ?? undefined,
    executedAt: toNumOrNull(row.executed_at) ?? undefined,
    result: row.result_json != null ? (JSON.parse(row.result_json) as unknown) : undefined,
    rejectionReason: row.rejection_reason ?? undefined
  }
}

function rowToAudit(row: IncidentAuditRow): IncidentAuditEntry {
  return {
    id: row.id,
    incidentId: row.incident_id,
    provider: row.provider as 'ollama' | 'claude',
    model: row.model,
    promptHash: row.prompt_hash,
    responseHash: row.response_hash,
    tokensIn: row.tokens_in ?? undefined,
    tokensOut: row.tokens_out ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    toolCallCount: row.tool_call_count ?? undefined,
    error: row.error ?? undefined,
    at: toNum(row.at)
  }
}

// ---------------------------------------------------------------------------
// Public API — incidents
// ---------------------------------------------------------------------------

export async function createIncident(
  serverId: string,
  category: AlertCategory,
  severity: AlertSeverity,
  openedAt: number
): Promise<Incident> {
  const id = randomUUID()
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('server_id', sql.NVarChar(36), serverId)
    .input('category', sql.NVarChar(50), category)
    .input('severity', sql.NVarChar(20), severity)
    .input('opened_at', sql.BigInt, openedAt)
    .query(
      `INSERT INTO dbo.incidents (id, server_id, category, severity, status, opened_at)
       VALUES (@id, @server_id, @category, @severity, N'open', @opened_at)`
    )
  const created = await getIncidentById(id)
  if (!created) throw new Error(`createIncident: failed to read back ${id}`)
  return created
}

export async function listIncidents(filter?: { status?: IncidentStatus }): Promise<Incident[]> {
  const pool = getPool()
  const req = pool.request()
  let sqlText: string
  if (filter?.status) {
    req.input('status', sql.NVarChar(20), filter.status)
    sqlText = `
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY server_id, category ORDER BY opened_at DESC) AS rn,
          COUNT(*) OVER (PARTITION BY server_id, category) AS group_count
        FROM dbo.incidents
        WHERE status = @status
      )
      SELECT TOP 200 id, server_id, category, severity, status, opened_at, resolved_at, summary, root_cause_md, group_count
      FROM ranked WHERE rn = 1 ORDER BY opened_at DESC`
  } else {
    sqlText = `
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY server_id, category ORDER BY opened_at DESC) AS rn,
          COUNT(*) OVER (PARTITION BY server_id, category) AS group_count
        FROM dbo.incidents
      )
      SELECT TOP 200 id, server_id, category, severity, status, opened_at, resolved_at, summary, root_cause_md, group_count
      FROM ranked WHERE rn = 1 ORDER BY opened_at DESC`
  }
  const r = await req.query<IncidentRow>(sqlText)
  return r.recordset.map(rowToIncident)
}

export async function getIncidentById(id: string): Promise<Incident | null> {
  const r = await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .query<IncidentRow>(`SELECT * FROM dbo.incidents WHERE id = @id`)
  return r.recordset[0] ? rowToIncident(r.recordset[0]) : null
}

export async function findOpenByServerAndCategory(
  serverId: string,
  category: AlertCategory
): Promise<Incident | null> {
  const r = await getPool()
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('category', sql.NVarChar(50), category)
    .query<IncidentRow>(
      `SELECT TOP 1 * FROM dbo.incidents
       WHERE server_id = @server_id AND category = @category AND status = N'open'
       ORDER BY opened_at DESC`
    )
  return r.recordset[0] ? rowToIncident(r.recordset[0]) : null
}

/**
 * Finds any "active" incident (open / investigating / awaiting_approval) for
 * the same SQL Server instance (i.e. any of the given server-id aliases) and
 * category. Used by the detector to dedupe alerts across server records that
 * point to the same physical instance, and across status changes.
 *
 * @param serverIds  All server-store IDs that resolve to the same SQL Server
 *                   instance (host:port:instanceName). Must contain at least one.
 * @param category   Alert category to match.
 */
export async function findActiveForInstance(
  serverIds: string[],
  category: AlertCategory
): Promise<Incident | null> {
  if (serverIds.length === 0) return null
  const req = getPool().request()
  // Build named placeholders for the IN-list — never interpolate raw values.
  const placeholders = serverIds.map((id, i) => {
    const name = `sid${i}`
    req.input(name, sql.NVarChar(36), id)
    return `@${name}`
  })
  req.input('category', sql.NVarChar(50), category)
  const r = await req.query<IncidentRow>(
    `SELECT TOP 1 * FROM dbo.incidents
     WHERE server_id IN (${placeholders.join(',')})
       AND category = @category
       AND status IN (N'open', N'investigating', N'awaiting_approval')
     ORDER BY opened_at DESC`
  )
  return r.recordset[0] ? rowToIncident(r.recordset[0]) : null
}

export async function setIncidentStatus(
  id: string,
  status: IncidentStatus,
  resolvedAt?: number
): Promise<void> {
  const resolved =
    status === 'resolved' || status === 'archived' ? (resolvedAt ?? Date.now()) : null
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('status', sql.NVarChar(20), status)
    .input('resolved_at', sql.BigInt, resolved)
    .query(`UPDATE dbo.incidents SET status = @status, resolved_at = @resolved_at WHERE id = @id`)
}

export async function escalateSeverity(id: string, severity: AlertSeverity): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('severity', sql.NVarChar(20), severity)
    .query(`UPDATE dbo.incidents SET severity = @severity WHERE id = @id`)
}

export async function setSummary(id: string, summary: string): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('summary', sql.NVarChar(sql.MAX), summary)
    .query(`UPDATE dbo.incidents SET summary = @summary WHERE id = @id`)
}

export async function setRootCause(id: string, rootCauseMd: string): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('root_cause_md', sql.NVarChar(sql.MAX), rootCauseMd)
    .query(`UPDATE dbo.incidents SET root_cause_md = @root_cause_md WHERE id = @id`)
}

export async function countOpen(): Promise<number> {
  const r = await getPool()
    .request()
    .query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM dbo.incidents WHERE status NOT IN (N'resolved', N'archived')`
    )
  return r.recordset[0]?.count ?? 0
}

// ---------------------------------------------------------------------------
// Public API — events
// ---------------------------------------------------------------------------

export async function addEvent(
  incidentId: string,
  kind: IncidentEventKind,
  payload: unknown,
  at: number = Date.now()
): Promise<IncidentEvent> {
  const id = randomUUID()
  const payloadJson = JSON.stringify(payload)
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('incident_id', sql.NVarChar(36), incidentId)
    .input('kind', sql.NVarChar(50), kind)
    .input('payload_json', sql.NVarChar(sql.MAX), payloadJson)
    .input('at', sql.BigInt, at)
    .query(
      `INSERT INTO dbo.incident_events (id, incident_id, kind, payload_json, at)
       VALUES (@id, @incident_id, @kind, @payload_json, @at)`
    )
  return { id, incidentId, kind, payload, at }
}

export async function getEvents(incidentId: string): Promise<IncidentEvent[]> {
  const r = await getPool()
    .request()
    .input('incident_id', sql.NVarChar(36), incidentId)
    .query<IncidentEventRow>(
      `SELECT * FROM dbo.incident_events WHERE incident_id = @incident_id ORDER BY at ASC`
    )
  return r.recordset.map(rowToEvent)
}

// ---------------------------------------------------------------------------
// Public API — actions
// ---------------------------------------------------------------------------

export interface CreateActionInput {
  /** Null for chat-originated actions. */
  incidentId?: string | null
  /** Target server id — always required so the executor can resolve the server. */
  serverId: string
  source: ActionSource
  toolName: string
  params: Record<string, unknown>
  tsqlPreview: string
  explanation: string
}

export async function createAction(input: CreateActionInput): Promise<IncidentAction> {
  const id = randomUUID()
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('incident_id', sql.NVarChar(36), input.incidentId ?? null)
    .input('server_id', sql.NVarChar(36), input.serverId)
    .input('source', sql.NVarChar(20), input.source)
    .input('tool_name', sql.NVarChar(100), input.toolName)
    .input('params_json', sql.NVarChar(sql.MAX), JSON.stringify(input.params))
    .input('tsql_preview', sql.NVarChar(sql.MAX), input.tsqlPreview)
    .input('explanation', sql.NVarChar(sql.MAX), input.explanation)
    .query(
      `INSERT INTO dbo.incident_actions
         (id, incident_id, server_id, source, tool_name, params_json, tsql_preview, explanation)
       VALUES (@id, @incident_id, @server_id, @source, @tool_name, @params_json, @tsql_preview, @explanation)`
    )
  const created = await getActionById(id)
  if (!created) throw new Error(`createAction: failed to read back ${id}`)
  return created
}

export async function getActions(incidentId: string): Promise<IncidentAction[]> {
  const r = await getPool()
    .request()
    .input('incident_id', sql.NVarChar(36), incidentId)
    .query<IncidentActionRow>(
      `SELECT * FROM dbo.incident_actions WHERE incident_id = @incident_id ORDER BY seq ASC`
    )
  return r.recordset.map(rowToAction)
}

export async function getPendingActions(incidentId: string): Promise<IncidentAction[]> {
  const r = await getPool()
    .request()
    .input('incident_id', sql.NVarChar(36), incidentId)
    .query<IncidentActionRow>(
      `SELECT * FROM dbo.incident_actions
       WHERE incident_id = @incident_id AND status = N'pending'
       ORDER BY seq ASC`
    )
  return r.recordset.map(rowToAction)
}

/** Recent chat-originated actions for a server (newest first), for the chat panel. */
export async function getChatActionsForServer(
  serverId: string,
  limit = 50
): Promise<IncidentAction[]> {
  const r = await getPool()
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('limit', sql.Int, limit)
    .query<IncidentActionRow>(
      `SELECT TOP (@limit) * FROM dbo.incident_actions
       WHERE server_id = @server_id AND source = N'chat'
       ORDER BY seq DESC`
    )
  return r.recordset.map(rowToAction)
}

export async function getActionById(id: string): Promise<IncidentAction | null> {
  const r = await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .query<IncidentActionRow>(`SELECT * FROM dbo.incident_actions WHERE id = @id`)
  return r.recordset[0] ? rowToAction(r.recordset[0]) : null
}

async function updateActionStatus(
  id: string,
  status: ActionStatus,
  approvedBy: string | null,
  executedAt: number | null,
  resultJson: string | null,
  rejectionReason: string | null
): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('status', sql.NVarChar(20), status)
    .input('approved_by', sql.NVarChar(200), approvedBy)
    .input('executed_at', sql.BigInt, executedAt)
    .input('result_json', sql.NVarChar(sql.MAX), resultJson)
    .input('rejection_reason', sql.NVarChar(sql.MAX), rejectionReason)
    .query(
      `UPDATE dbo.incident_actions
       SET status = @status,
           approved_by = @approved_by,
           executed_at = @executed_at,
           result_json = @result_json,
           rejection_reason = @rejection_reason
       WHERE id = @id`
    )
}

/**
 * Atomically transition a pending action to 'approved', claiming it for
 * execution. Returns true only for the caller that won the race — concurrent
 * approvals of the same action see rowcount 0 and must abort. This closes the
 * TOCTOU window between the status check and execution in the approve handler.
 */
export async function tryClaimActionForExecution(id: string): Promise<boolean> {
  const r = await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .query<{ claimed: number }>(
      `UPDATE dbo.incident_actions SET status = N'approved'
       WHERE id = @id AND status = N'pending';
       SELECT @@ROWCOUNT AS claimed`
    )
  return (r.recordset[0]?.claimed ?? 0) === 1
}

export async function approveAction(
  id: string,
  approvedBy: string,
  result?: unknown
): Promise<void> {
  await updateActionStatus(
    id,
    'executed',
    approvedBy,
    Date.now(),
    result !== undefined ? JSON.stringify(result) : null,
    null
  )
}

export async function rejectAction(id: string, reason: string): Promise<void> {
  await updateActionStatus(id, 'rejected', null, null, null, reason)
}

export async function failAction(id: string, error: string): Promise<void> {
  await updateActionStatus(id, 'failed', null, null, null, error)
}

export async function countApprovedActionsForIncident(incidentId: string): Promise<number> {
  const r = await getPool()
    .request()
    .input('incident_id', sql.NVarChar(36), incidentId)
    .query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM dbo.incident_actions
       WHERE incident_id = @incident_id AND status IN (N'executed', N'approved')`
    )
  return r.recordset[0]?.count ?? 0
}

/**
 * Count chat-originated actions executed/approved against a server since a given
 * epoch-ms cutoff. Used to rate-limit fixes proposed from the AI chat panel,
 * which have no incident to scope a per-incident cap against.
 */
export async function countApprovedActionsForServer(
  serverId: string,
  sinceMs: number
): Promise<number> {
  const r = await getPool()
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('since', sql.BigInt, sinceMs)
    .query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM dbo.incident_actions
       WHERE server_id = @server_id AND source = N'chat'
         AND status IN (N'executed', N'approved')
         AND executed_at >= @since`
    )
  return r.recordset[0]?.count ?? 0
}

// ---------------------------------------------------------------------------
// Public API — audit
// ---------------------------------------------------------------------------

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

export async function addAuditEntry(
  incidentId: string,
  provider: 'ollama' | 'claude',
  model: string,
  prompt: string,
  response: string,
  telemetry: IncidentAuditTelemetry = {}
): Promise<IncidentAuditEntry> {
  const id = randomUUID()
  const at = Date.now()
  const promptHash = sha256(prompt)
  const responseHash = sha256(response)
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('incident_id', sql.NVarChar(36), incidentId)
    .input('provider', sql.NVarChar(20), provider)
    .input('model', sql.NVarChar(100), model)
    .input('prompt_hash', sql.Char(64), promptHash)
    .input('response_hash', sql.Char(64), responseHash)
    .input('tokens_in', sql.Int, telemetry.tokensIn ?? null)
    .input('tokens_out', sql.Int, telemetry.tokensOut ?? null)
    .input('duration_ms', sql.Int, telemetry.durationMs ?? null)
    .input('tool_call_count', sql.Int, telemetry.toolCallCount ?? null)
    .input('error', sql.NVarChar(sql.MAX), telemetry.error ?? null)
    .input('at', sql.BigInt, at)
    .query(
      `INSERT INTO dbo.incident_audit
         (id, incident_id, provider, model, prompt_hash, response_hash,
          tokens_in, tokens_out, duration_ms, tool_call_count, error, at)
       VALUES
         (@id, @incident_id, @provider, @model, @prompt_hash, @response_hash,
          @tokens_in, @tokens_out, @duration_ms, @tool_call_count, @error, @at)`
    )
  return {
    id,
    incidentId,
    provider,
    model,
    promptHash,
    responseHash,
    tokensIn: telemetry.tokensIn,
    tokensOut: telemetry.tokensOut,
    durationMs: telemetry.durationMs,
    toolCallCount: telemetry.toolCallCount,
    error: telemetry.error,
    at
  }
}

export async function getAuditEntries(incidentId: string): Promise<IncidentAuditEntry[]> {
  const r = await getPool()
    .request()
    .input('incident_id', sql.NVarChar(36), incidentId)
    .query<IncidentAuditRow>(
      `SELECT * FROM dbo.incident_audit WHERE incident_id = @incident_id ORDER BY at ASC`
    )
  return r.recordset.map(rowToAudit)
}

export async function getAiStats(): Promise<IncidentAiStats> {
  const pool = getPool()
  const [aggregateR, providerR, actionsR, p95R] = await Promise.all([
    pool.request().query<{
      total_runs: number
      failed_runs: number
      avg_duration_ms: number | null
      avg_tool_calls: number | null
      last_run_at: number | null
    }>(`
      SELECT
        COUNT(*)                                                           AS total_runs,
        COUNT(CASE WHEN error IS NOT NULL THEN 1 END)                     AS failed_runs,
        AVG(CAST(duration_ms AS FLOAT))                                   AS avg_duration_ms,
        AVG(CAST(tool_call_count AS FLOAT))                               AS avg_tool_calls,
        MAX(at)                                                            AS last_run_at
      FROM dbo.incident_audit
    `),
    pool.request().query<{ provider: string; runs: number; failed_runs: number }>(`
      SELECT
        provider,
        COUNT(*)                                                           AS runs,
        COUNT(CASE WHEN error IS NOT NULL THEN 1 END)                     AS failed_runs
      FROM dbo.incident_audit
      GROUP BY provider
      ORDER BY COUNT(*) DESC
    `),
    pool.request().query<{ proposed_actions: number; executed_actions: number }>(`
      SELECT
        COUNT(CASE WHEN status = N'pending'  THEN 1 END)                  AS proposed_actions,
        COUNT(CASE WHEN status = N'executed' THEN 1 END)                  AS executed_actions
      FROM dbo.incident_actions
    `),
    pool.request().query<{ p95: number | null }>(`
      SELECT TOP 1
        CAST(
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) OVER ()
          AS INT
        ) AS p95
      FROM dbo.incident_audit
      WHERE duration_ms IS NOT NULL
    `)
  ])

  const agg = aggregateR.recordset[0]
  const acts = actionsR.recordset[0]
  const totalRuns = agg?.total_runs ?? 0
  const failedRuns = agg?.failed_runs ?? 0
  const successfulRuns = totalRuns - failedRuns

  return {
    totalRuns,
    successfulRuns,
    failedRuns,
    successRate: totalRuns > 0 ? successfulRuns / totalRuns : 0,
    avgDurationMs: Math.round(agg?.avg_duration_ms ?? 0),
    p95DurationMs: p95R.recordset[0]?.p95 ?? 0,
    avgToolCalls: Math.round((agg?.avg_tool_calls ?? 0) * 100) / 100,
    proposedActions: acts?.proposed_actions ?? 0,
    executedActions: acts?.executed_actions ?? 0,
    lastRunAt: toNumOrNull(agg?.last_run_at) ?? undefined,
    providers: providerR.recordset.map((r) => ({
      provider: r.provider as 'ollama' | 'claude',
      runs: r.runs,
      failedRuns: r.failed_runs
    }))
  }
}
