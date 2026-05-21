import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { pushToRenderer } from '../push'
import { IpcChannel } from '../types'
import type { IpcResult, IncidentListRequest, IncidentSetStatusRequest, IncidentDetail } from '../types'
import type { Incident, IncidentEvent, IncidentAction } from '../../incidents/types'
import * as repository from '../../incidents/repository'
import { attachDetector, onIncidentChange, setAgentRunner } from '../../incidents/detector'
import { runIncidentAgent } from '../../incidents/incidentAgent'
import { ACTION_WHITELIST } from '../../ai/actionTools'
import { getPool } from '../../collectors/connectionPool'
import * as serverStore from '../../store/serverStore'
import { getDb } from '../../store/database'

// ---------------------------------------------------------------------------
// Layer 4 — Global hourly rate limit + kill switch
// ---------------------------------------------------------------------------

const MAX_ACTIONS_PER_INCIDENT = 3
const MAX_ACTIONS_PER_HOUR = 10

// Sliding-window timestamp log of approved actions (in-memory, resets on restart).
const hourlyActionLog: number[] = []

function checkGlobalRateLimit(): void {
  const cutoff = Date.now() - 3_600_000
  while (hourlyActionLog.length > 0 && hourlyActionLog[0] < cutoff) hourlyActionLog.shift()
  if (hourlyActionLog.length >= MAX_ACTIONS_PER_HOUR) {
    throw new Error(`Global rate limit reached: max ${MAX_ACTIONS_PER_HOUR} agent actions per hour`)
  }
}

function recordGlobalAction(): void {
  hourlyActionLog.push(Date.now())
}

function isAgentActionsEnabled(): boolean {
  const row = getDb()
    .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'ai_agent_actions_enabled'`)
    .get()
  return row?.value !== 'false'
}

// ---------------------------------------------------------------------------
// Layer 2 — Hard-coded preconditions (TypeScript, not delegated to LLM)
// ---------------------------------------------------------------------------

const PROTECTED_LOGINS = new Set([
  'sa',
  'NT AUTHORITY\\SYSTEM',
  'NT AUTHORITY\\NETWORK SERVICE',
  'NT AUTHORITY\\LOCAL SERVICE',
  'NT SERVICE\\MSSQLSERVER',
  'NT SERVICE\\SQLSERVERAGENT'
])

async function validateActionPreconditions(
  action: import('../../incidents/types').IncidentAction,
  pool: import('mssql').ConnectionPool
): Promise<string | null> {
  if (action.toolName === 'kill_session') {
    const sessionId = Number(action.params.session_id)
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return `Invalid session_id: ${String(action.params.session_id)}`
    }
    if (sessionId <= 50) {
      return `Cannot kill system session (session_id ${sessionId} ≤ 50)`
    }
    // Query live server to verify session still exists and is killable.
    const result = await pool.request().query<{ login_name: string; is_user_process: number }>(
      `SELECT login_name, is_user_process
       FROM sys.dm_exec_sessions
       WHERE session_id = ${sessionId}`
    )
    if (!result.recordset.length) {
      return `Session ${sessionId} not found — it may have already ended`
    }
    const session = result.recordset[0]
    if (!session.is_user_process) {
      return `Session ${sessionId} is a system process — cannot kill`
    }
    if (PROTECTED_LOGINS.has(session.login_name)) {
      return `Login '${session.login_name}' is protected — cannot kill`
    }
  }
  return null
}

function fireAgent(incidentId: string): void {
  runIncidentAgent(incidentId, {
    onEvent: (ev) => pushToRenderer(IpcChannel.INCIDENT_AGENT_EVENT, { incidentId, event: ev })
  })
    .then(() => {
      // Push updated incident with summary/rootCause after agent completes.
      const incident = repository.getIncidentById(incidentId)
      if (incident) pushToRenderer(IpcChannel.INCIDENT_UPDATED, incident)
    })
    .catch((err) => log.error('[incidents] agent error:', err))
}

export function registerIncidentHandlers(): void {
  // Attach detector on first handler registration — idempotent in practice
  // (registerIpcHandlers is called once at startup)
  attachDetector()

  // Wire the agent runner so the detector can trigger it on new incidents.
  setAgentRunner(fireAgent)

  // Push incident changes to renderer whenever the detector fires
  onIncidentChange((type, incidentId) => {
    const incident = repository.getIncidentById(incidentId)
    if (!incident) return
    const channel = type === 'created' ? IpcChannel.INCIDENT_CREATED : IpcChannel.INCIDENT_UPDATED
    pushToRenderer(channel, incident)
  })

  handle(IpcChannel.INCIDENTS_LIST, (
    _event: IpcMainInvokeEvent,
    req?: IncidentListRequest
  ): IpcResult<Incident[]> => {
    try {
      return { ok: true, data: repository.listIncidents(req) }
    } catch (err) {
      log.error('[IPC] INCIDENTS_LIST:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.INCIDENTS_GET, (
    _event: IpcMainInvokeEvent,
    id: string
  ): IpcResult<IncidentDetail> => {
    try {
      const incident = repository.getIncidentById(id)
      if (!incident) return { ok: false, error: `Incident ${id} not found` }
      return {
        ok: true,
        data: {
          incident,
          events: repository.getEvents(id),
          actions: repository.getActions(id),
          audit: repository.getAuditEntries(id)
        }
      }
    } catch (err) {
      log.error('[IPC] INCIDENTS_GET:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.INCIDENTS_SET_STATUS, (
    _event: IpcMainInvokeEvent,
    req: IncidentSetStatusRequest
  ): IpcResult<null> => {
    try {
      repository.setIncidentStatus(req.id, req.status)
      const incident = repository.getIncidentById(req.id)
      if (incident) pushToRenderer(IpcChannel.INCIDENT_UPDATED, incident)
      return { ok: true, data: null }
    } catch (err) {
      log.error('[IPC] INCIDENTS_SET_STATUS:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.INCIDENTS_COUNT_OPEN, (): IpcResult<number> => {
    try {
      return { ok: true, data: repository.countOpen() }
    } catch (err) {
      log.error('[IPC] INCIDENTS_COUNT_OPEN:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.INCIDENTS_EXPORT_POSTMORTEM, (
    _event: IpcMainInvokeEvent,
    id: string
  ): IpcResult<string> => {
    try {
      const incident = repository.getIncidentById(id)
      if (!incident) return { ok: false, error: `Incident ${id} not found` }
      const events = repository.getEvents(id)
      const actions = repository.getActions(id)
      const audit = repository.getAuditEntries(id)
      const md = buildPostmortem(incident, events, actions, audit)
      return { ok: true, data: md }
    } catch (err) {
      log.error('[IPC] INCIDENTS_EXPORT_POSTMORTEM:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.INCIDENTS_RUN_AGENT, (
    _event: IpcMainInvokeEvent,
    id: string
  ): IpcResult<null> => {
    const incident = repository.getIncidentById(id)
    if (!incident) return { ok: false, error: `Incident ${id} not found` }
    setImmediate(() => fireAgent(id))
    return { ok: true, data: null }
  })

  handle(IpcChannel.INCIDENTS_APPROVE_ACTION, async (
    _event: IpcMainInvokeEvent,
    req: { actionId: string; approvedBy: string }
  ): Promise<IpcResult<null>> => {
    try {
      const action = repository.getActionById(req.actionId)
      if (!action) return { ok: false, error: `Action ${req.actionId} not found` }
      if (action.status !== 'pending') return { ok: false, error: `Action is not pending (status: ${action.status})` }

      // Layer 4 — Kill switch
      if (!isAgentActionsEnabled()) {
        return { ok: false, error: 'Agent actions are disabled in Settings → AI Provider' }
      }

      // Layer 1 — Hard whitelist guard (defence-in-depth, even if UI is bypassed).
      if (!ACTION_WHITELIST.has(action.toolName)) {
        return { ok: false, error: `Tool '${action.toolName}' is not whitelisted for execution` }
      }

      const incident = repository.getIncidentById(action.incidentId)
      if (!incident) return { ok: false, error: 'Parent incident not found' }

      // Layer 4 — Per-incident action cap
      const approvedCount = repository.countApprovedActionsForIncident(action.incidentId)
      if (approvedCount >= MAX_ACTIONS_PER_INCIDENT) {
        return { ok: false, error: `Incident action cap reached (max ${MAX_ACTIONS_PER_INCIDENT} per incident)` }
      }

      // Layer 4 — Global hourly cap
      checkGlobalRateLimit()

      const server = serverStore.getById(incident.serverId)
      if (!server) return { ok: false, error: 'Server not found' }

      // Execute the T-SQL preview against the server.
      const pool = await getPool({
        ip: server.host,
        port: server.port,
        instanceName: server.instanceName,
        username: server.username,
        password: server.password,
        useWindowsAuth: server.useWindowsAuth,
        encrypt: true,
        trustServerCertificate: true
      })
      // Layer 2 — Hard-coded preconditions (TypeScript, not delegated to LLM).
      const preconditionError = await validateActionPreconditions(action, pool)
      if (preconditionError) {
        repository.failAction(req.actionId, preconditionError)
        const failed = repository.getActionById(req.actionId)
        if (failed) pushToRenderer(IpcChannel.INCIDENT_ACTION, { incidentId: action.incidentId, action: failed })
        return { ok: false, error: preconditionError }
      }

      await pool.request().query(action.tsqlPreview)

      recordGlobalAction()
      repository.approveAction(req.actionId, req.approvedBy, { executed: true })
      repository.addEvent(action.incidentId, 'action_executed', { toolName: action.toolName, actionId: action.id })

      // Push updated action to renderer.
      const updated = repository.getActionById(req.actionId)
      if (updated) pushToRenderer(IpcChannel.INCIDENT_ACTION, { incidentId: action.incidentId, action: updated })

      return { ok: true, data: null }
    } catch (err) {
      // Mark the action as failed if execution throws.
      try { repository.failAction(req.actionId, safeError(err)) } catch {}
      log.error('[IPC] INCIDENTS_APPROVE_ACTION execute error:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.INCIDENTS_REJECT_ACTION, (
    _event: IpcMainInvokeEvent,
    req: { actionId: string; reason?: string }
  ): IpcResult<null> => {
    try {
      const action = repository.getActionById(req.actionId)
      if (!action) return { ok: false, error: `Action ${req.actionId} not found` }
      if (action.status !== 'pending') return { ok: false, error: `Action is not pending (status: ${action.status})` }

      repository.rejectAction(req.actionId, req.reason ?? 'Rejected by user')
      repository.addEvent(action.incidentId, 'status_change', { actionId: req.actionId, status: 'rejected' })

      const updated = repository.getActionById(req.actionId)
      if (updated) pushToRenderer(IpcChannel.INCIDENT_ACTION, { incidentId: action.incidentId, action: updated })

      return { ok: true, data: null }
    } catch (err) {
      log.error('[IPC] INCIDENTS_REJECT_ACTION:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })
}

// ---------------------------------------------------------------------------
// Postmortem markdown builder
// ---------------------------------------------------------------------------

function buildPostmortem(
  incident: Incident,
  events: IncidentEvent[],
  actions: IncidentAction[],
  audit: import('../../incidents/types').IncidentAuditEntry[]
): string {
  const opened = new Date(incident.openedAt).toISOString().replace('T', ' ').slice(0, 19)
  const resolved = incident.resolvedAt
    ? new Date(incident.resolvedAt).toISOString().replace('T', ' ').slice(0, 19)
    : 'open'

  const durationMs = incident.resolvedAt
    ? incident.resolvedAt - incident.openedAt
    : Date.now() - incident.openedAt
  const duration = formatDuration(durationMs)

  const lines: string[] = [
    `# Incident ${incident.id.slice(0, 8)}`,
    '',
    `**Server**: ${incident.serverId}`,
    `**Category**: ${incident.category}`,
    `**Severity**: ${incident.severity}`,
    `**Status**: ${incident.status}`,
    `**Opened**: ${opened} UTC`,
    `**Resolved**: ${resolved}${incident.resolvedAt ? ' UTC' : ''}`,
    `**Duration**: ${duration}`,
    ''
  ]

  if (incident.summary) {
    lines.push('## Summary', incident.summary, '')
  }

  if (incident.rootCauseMd) {
    lines.push('## Root Cause Analysis', incident.rootCauseMd, '')
  }

  lines.push('## Timeline')
  for (const ev of events) {
    const ts = new Date(ev.at).toISOString().replace('T', ' ').slice(0, 19)
    const payload = ev.payload as Record<string, unknown>
    let desc: string = ev.kind
    if (ev.kind === 'alert_added') desc = `Alert: ${String(payload.message ?? '')} (${String(payload.severity ?? '')})`
    else if (ev.kind === 'tool_call') desc = `Tool: ${String(payload.name ?? '')}(${JSON.stringify(payload.params ?? {})})`
    else if (ev.kind === 'action_proposed') desc = `Proposed action: ${String(payload.toolName ?? '')}`
    else if (ev.kind === 'action_executed') desc = `Action executed: ${String(payload.toolName ?? '')} → ${String(payload.result ?? '')}`
    else if (ev.kind === 'status_change') desc = `Status → ${String(payload.status ?? '')}`
    lines.push(`- ${ts} UTC — ${desc}`)
  }
  lines.push('')

  const executedActions = actions.filter((a) => a.status === 'executed')
  if (executedActions.length > 0) {
    lines.push('## Actions Taken')
    for (const a of executedActions) {
      lines.push(`- **${a.toolName}** — ${a.explanation}`)
      if (a.approvedBy) lines.push(`  - Approved by: ${a.approvedBy}`)
    }
    lines.push('')
  }

  if (audit.length > 0) {
    lines.push('## AI Investigation Audit')
    lines.push('| Timestamp | Provider | Model | Tokens In | Tokens Out |')
    lines.push('|---|---|---|---|---|')
    for (const entry of audit) {
      const ts = new Date(entry.at).toISOString().replace('T', ' ').slice(0, 19)
      lines.push(`| ${ts} | ${entry.provider} | ${entry.model} | ${entry.tokensIn ?? '-'} | ${entry.tokensOut ?? '-'} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
