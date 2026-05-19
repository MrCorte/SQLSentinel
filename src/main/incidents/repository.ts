import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getDb } from '../store/database'
import type {
  Incident,
  IncidentEvent,
  IncidentAction,
  IncidentAuditEntry,
  IncidentStatus,
  IncidentEventKind,
  ActionStatus
} from './types'
import type { AlertCategory, AlertSeverity } from '../ipc/types'

// ---------------------------------------------------------------------------
// Row shapes (SQLite → TypeScript)
// ---------------------------------------------------------------------------

interface IncidentRow {
  id: string
  server_id: string
  category: string
  severity: string
  status: string
  opened_at: number
  resolved_at: number | null
  summary: string | null
  root_cause_md: string | null
}

interface IncidentEventRow {
  id: string
  incident_id: string
  kind: string
  payload_json: string
  at: number
}

interface IncidentActionRow {
  id: string
  incident_id: string
  tool_name: string
  params_json: string
  tsql_preview: string
  explanation: string
  status: string
  approved_by: string | null
  executed_at: number | null
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
  at: number
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

function rowToIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    serverId: row.server_id,
    category: row.category as AlertCategory,
    severity: row.severity as AlertSeverity,
    status: row.status as IncidentStatus,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at ?? undefined,
    summary: row.summary ?? undefined,
    rootCauseMd: row.root_cause_md ?? undefined
  }
}

function rowToEvent(row: IncidentEventRow): IncidentEvent {
  return {
    id: row.id,
    incidentId: row.incident_id,
    kind: row.kind as IncidentEventKind,
    payload: JSON.parse(row.payload_json) as unknown,
    at: row.at
  }
}

function rowToAction(row: IncidentActionRow): IncidentAction {
  return {
    id: row.id,
    incidentId: row.incident_id,
    toolName: row.tool_name,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    tsqlPreview: row.tsql_preview,
    explanation: row.explanation,
    status: row.status as ActionStatus,
    approvedBy: row.approved_by ?? undefined,
    executedAt: row.executed_at ?? undefined,
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
    at: row.at
  }
}

// ---------------------------------------------------------------------------
// Prepared statement cache (same pattern as metricsRepository)
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null
let _stmts: ReturnType<typeof buildStmts> | null = null

function buildStmts(db: Database.Database) {
  return {
    insertIncident: db.prepare<[string, string, string, string, string, number]>(
      `INSERT INTO incidents (id, server_id, category, severity, status, opened_at)
       VALUES (?, ?, ?, ?, 'open', ?)`
    ),
    findAllIncidents: db.prepare<[string, string], IncidentRow>(
      `SELECT * FROM incidents
       WHERE (? = '' OR status = ?)
       ORDER BY opened_at DESC
       LIMIT 200`
    ),
    findIncidentById: db.prepare<[string], IncidentRow>(
      'SELECT * FROM incidents WHERE id = ?'
    ),
    findOpenByServerAndCategory: db.prepare<[string, string], IncidentRow>(
      `SELECT * FROM incidents
       WHERE server_id = ? AND category = ? AND status = 'open'
       ORDER BY opened_at DESC
       LIMIT 1`
    ),
    updateStatus: db.prepare<[string, number | null, string]>(
      `UPDATE incidents SET status = ?, resolved_at = ? WHERE id = ?`
    ),
    updateSeverity: db.prepare<[string, string]>(
      'UPDATE incidents SET severity = ? WHERE id = ?'
    ),
    updateSummary: db.prepare<[string, string]>(
      'UPDATE incidents SET summary = ? WHERE id = ?'
    ),
    updateRootCause: db.prepare<[string, string]>(
      'UPDATE incidents SET root_cause_md = ? WHERE id = ?'
    ),
    countOpen: db.prepare<[], { count: number }>(
      `SELECT COUNT(*) AS count FROM incidents WHERE status NOT IN ('resolved', 'archived')`
    ),

    insertEvent: db.prepare<[string, string, string, string, number]>(
      `INSERT INTO incident_events (id, incident_id, kind, payload_json, at)
       VALUES (?, ?, ?, ?, ?)`
    ),
    findEvents: db.prepare<[string], IncidentEventRow>(
      'SELECT * FROM incident_events WHERE incident_id = ? ORDER BY at ASC'
    ),

    insertAction: db.prepare<[string, string, string, string, string, string]>(
      `INSERT INTO incident_actions (id, incident_id, tool_name, params_json, tsql_preview, explanation)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),
    findActions: db.prepare<[string], IncidentActionRow>(
      'SELECT * FROM incident_actions WHERE incident_id = ? ORDER BY rowid ASC'
    ),
    findPendingActions: db.prepare<[string], IncidentActionRow>(
      `SELECT * FROM incident_actions WHERE incident_id = ? AND status = 'pending'`
    ),
    findActionById: db.prepare<[string], IncidentActionRow>(
      'SELECT * FROM incident_actions WHERE id = ?'
    ),
    updateActionStatus: db.prepare<[string, string | null, number | null, string | null, string | null, string]>(
      `UPDATE incident_actions
       SET status = ?, approved_by = ?, executed_at = ?, result_json = ?, rejection_reason = ?
       WHERE id = ?`
    ),

    insertAudit: db.prepare<[string, string, string, string, string, string, number | null, number | null, number]>(
      `INSERT INTO incident_audit
         (id, incident_id, provider, model, prompt_hash, response_hash, tokens_in, tokens_out, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    findAudit: db.prepare<[string], IncidentAuditRow>(
      'SELECT * FROM incident_audit WHERE incident_id = ? ORDER BY at ASC'
    )
  }
}

function stmts() {
  const db = getDb()
  if (_stmts && _db === db) return _stmts
  _db = db
  _stmts = buildStmts(db)
  return _stmts
}

// ---------------------------------------------------------------------------
// Public API — incidents
// ---------------------------------------------------------------------------

export function createIncident(
  serverId: string,
  category: AlertCategory,
  severity: AlertSeverity,
  openedAt: number
): Incident {
  const id = randomUUID()
  stmts().insertIncident.run(id, serverId, category, severity, 'open', openedAt)
  return getIncidentById(id)!
}

export function listIncidents(filter?: { status?: IncidentStatus }): Incident[] {
  const status = filter?.status ?? ''
  const rows = stmts().findAllIncidents.all(status, status)
  return rows.map(rowToIncident)
}

export function getIncidentById(id: string): Incident | null {
  const row = stmts().findIncidentById.get(id)
  return row ? rowToIncident(row) : null
}

export function findOpenByServerAndCategory(
  serverId: string,
  category: AlertCategory
): Incident | null {
  const row = stmts().findOpenByServerAndCategory.get(serverId, category)
  return row ? rowToIncident(row) : null
}

export function setIncidentStatus(
  id: string,
  status: IncidentStatus,
  resolvedAt?: number
): void {
  stmts().updateStatus.run(
    status,
    status === 'resolved' || status === 'archived' ? (resolvedAt ?? Date.now()) : null,
    id
  )
}

export function escalateSeverity(id: string, severity: AlertSeverity): void {
  stmts().updateSeverity.run(severity, id)
}

export function setSummary(id: string, summary: string): void {
  stmts().updateSummary.run(summary, id)
}

export function setRootCause(id: string, rootCauseMd: string): void {
  stmts().updateRootCause.run(rootCauseMd, id)
}

export function countOpen(): number {
  return stmts().countOpen.get()?.count ?? 0
}

// ---------------------------------------------------------------------------
// Public API — events
// ---------------------------------------------------------------------------

export function addEvent(
  incidentId: string,
  kind: IncidentEventKind,
  payload: unknown,
  at = Date.now()
): IncidentEvent {
  const id = randomUUID()
  stmts().insertEvent.run(id, incidentId, kind, JSON.stringify(payload), at)
  return { id, incidentId, kind, payload, at }
}

export function getEvents(incidentId: string): IncidentEvent[] {
  return stmts().findEvents.all(incidentId).map(rowToEvent)
}

// ---------------------------------------------------------------------------
// Public API — actions
// ---------------------------------------------------------------------------

export function createAction(
  incidentId: string,
  toolName: string,
  params: Record<string, unknown>,
  tsqlPreview: string,
  explanation: string
): IncidentAction {
  const id = randomUUID()
  stmts().insertAction.run(id, incidentId, toolName, JSON.stringify(params), tsqlPreview, explanation)
  return getActionById(id)!
}

export function getActions(incidentId: string): IncidentAction[] {
  return stmts().findActions.all(incidentId).map(rowToAction)
}

export function getPendingActions(incidentId: string): IncidentAction[] {
  return stmts().findPendingActions.all(incidentId).map(rowToAction)
}

export function getActionById(id: string): IncidentAction | null {
  const row = stmts().findActionById.get(id)
  return row ? rowToAction(row) : null
}

export function approveAction(
  id: string,
  approvedBy: string,
  result?: unknown
): void {
  stmts().updateActionStatus.run(
    'executed',
    approvedBy,
    Date.now(),
    result !== undefined ? JSON.stringify(result) : null,
    null,
    id
  )
}

export function rejectAction(id: string, reason: string): void {
  stmts().updateActionStatus.run('rejected', null, null, null, reason, id)
}

export function failAction(id: string, error: string): void {
  stmts().updateActionStatus.run('failed', null, null, null, error, id)
}

// ---------------------------------------------------------------------------
// Public API — audit
// ---------------------------------------------------------------------------

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export function addAuditEntry(
  incidentId: string,
  provider: 'ollama' | 'claude',
  model: string,
  prompt: string,
  response: string,
  tokensIn?: number,
  tokensOut?: number
): IncidentAuditEntry {
  const id = randomUUID()
  const at = Date.now()
  const promptHash = sha256(prompt)
  const responseHash = sha256(response)
  stmts().insertAudit.run(
    id, incidentId, provider, model, promptHash, responseHash,
    tokensIn ?? null, tokensOut ?? null, at
  )
  return { id, incidentId, provider, model, promptHash, responseHash, tokensIn, tokensOut, at }
}

export function getAuditEntries(incidentId: string): IncidentAuditEntry[] {
  return stmts().findAudit.all(incidentId).map(rowToAudit)
}
