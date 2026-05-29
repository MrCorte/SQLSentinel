import type { IpcMainInvokeEvent } from 'electron'
import * as mssql from 'mssql'
import { handle, safeError, log } from '../handleWrapper'
import { getSession } from '../../authService'
import { pushToRenderer } from '../push'
import { IpcChannel } from '../types'
import type {
  IpcResult,
  IncidentAiStats,
  IncidentListRequest,
  IncidentSetStatusRequest,
  IncidentDetail,
  ApproveActionRequest,
  RejectActionRequest
} from '../types'
import type { Incident, IncidentEvent, IncidentAction } from '../../incidents/types'
import * as repository from '../../incidents/repository'
import { attachDetector, onIncidentChange, setAgentRunner } from '../../incidents/detector'
import { isIncidentAgentRunning, runIncidentAgent } from '../../incidents/incidentAgent'
import {
  ACTION_WHITELIST,
  buildActionSqlForExecution,
  isDestructiveAction
} from '../../ai/actionTools'
import { getPool } from '../../collectors/connectionPool'
import * as serverStore from '../../store/sqlserver/serverRepository'
import { getRawSetting } from '../../store/sqlserver/settingsRepository'

// ---------------------------------------------------------------------------
// Layer 4 — Global hourly rate limit + kill switch
// ---------------------------------------------------------------------------

const MAX_ACTIONS_PER_INCIDENT = 3
const MAX_ACTIONS_PER_HOUR = 10
// Chat-originated actions have no incident to scope a per-incident cap against,
// so they are rate-limited per target server over a sliding hour.
const MAX_CHAT_ACTIONS_PER_SERVER_PER_HOUR = 5

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

async function isAgentActionsEnabled(): Promise<boolean> {
  const value = await getRawSetting('ai_agent_actions_enabled')
  return value !== 'false'
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
    // Parameterized so the safety never depends on the upstream integer guard
    // surviving a future refactor.
    const result = await pool
      .request()
      .input('sid', mssql.Int, sessionId)
      .query<{ login_name: string; is_user_process: number }>(
        `SELECT login_name, is_user_process
         FROM sys.dm_exec_sessions
         WHERE session_id = @sid`
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

function fireAgent(incidentId: string): boolean {
  if (isIncidentAgentRunning(incidentId)) return false
  void runIncidentAgent(incidentId, {
    onEvent: (ev) => pushToRenderer(IpcChannel.INCIDENT_AGENT_EVENT, { incidentId, event: ev })
  })
    .then(async () => {
      // Push updated incident with summary/rootCause after agent completes.
      const incident = await repository.getIncidentById(incidentId)
      if (incident) pushToRenderer(IpcChannel.INCIDENT_UPDATED, incident)
    })
    .catch((err) => log.error('[incidents] agent error:', err))
  return true
}

// ---------------------------------------------------------------------------
// Shared remediation-action execution — used by both the incident approve
// handler and the generalized chat-action approve handler. Same 4-layer guard.
// ---------------------------------------------------------------------------

function notifyActionChange(action: IncidentAction): void {
  // Incident actions are surfaced to the incident drawer via a push channel.
  // Chat actions report their final status synchronously through the approve/
  // reject IPC result, so they need no separate push.
  if (action.incidentId) {
    pushToRenderer(IpcChannel.INCIDENT_ACTION, { incidentId: action.incidentId, action })
  }
}

function resolveActionServer(action: IncidentAction): serverStore.StoredServer | undefined {
  if (action.serverId) {
    const byId = serverStore.getById(action.serverId)
    if (byId) return byId
  }
  return undefined
}

async function executeActionApproval(
  req: ApproveActionRequest
): Promise<IpcResult<IncidentAction>> {
  try {
    const action = await repository.getActionById(req.actionId)
    if (!action) return { ok: false, error: `Action ${req.actionId} not found` }
    if (action.status !== 'pending')
      return { ok: false, error: `Action is not pending (status: ${action.status})` }

    // Layer 4 — Kill switch
    if (!(await isAgentActionsEnabled())) {
      return { ok: false, error: 'Agent actions are disabled in Settings → AI Provider' }
    }

    // Layer 1 — Hard whitelist guard (defence-in-depth, even if UI is bypassed).
    if (!ACTION_WHITELIST.has(action.toolName)) {
      return { ok: false, error: `Tool '${action.toolName}' is not whitelisted for execution` }
    }

    // Resolve the target server. Chat actions carry server_id directly; legacy
    // incident rows (no server_id) fall back to the parent incident's server.
    let server = resolveActionServer(action)
    if (!server && action.incidentId) {
      const incident = await repository.getIncidentById(action.incidentId)
      if (incident) server = serverStore.getById(incident.serverId)
    }
    if (!server) return { ok: false, error: 'Target server not found' }

    // Server-side typed-confirmation gate for destructive actions. The UI also
    // enforces this, but we re-check here so the safety never depends on the UI.
    if (isDestructiveAction(action.toolName)) {
      const expected = `${server.host}:${server.port}`
      if ((req.confirmation ?? '').trim() !== expected) {
        return {
          ok: false,
          error: `This action is destructive and requires typed confirmation. Type "${expected}" to confirm.`
        }
      }
    }

    // Layer 4 — Context rate limits (per-incident, or per-server for chat).
    if (action.incidentId) {
      const approvedCount = await repository.countApprovedActionsForIncident(action.incidentId)
      if (approvedCount >= MAX_ACTIONS_PER_INCIDENT) {
        return {
          ok: false,
          error: `Incident action cap reached (max ${MAX_ACTIONS_PER_INCIDENT} per incident)`
        }
      }
    } else if (action.serverId) {
      const since = Date.now() - 3_600_000
      const serverCount = await repository.countApprovedActionsForServer(action.serverId, since)
      if (serverCount >= MAX_CHAT_ACTIONS_PER_SERVER_PER_HOUR) {
        return {
          ok: false,
          error: `Per-server action cap reached (max ${MAX_CHAT_ACTIONS_PER_SERVER_PER_HOUR} per hour)`
        }
      }
    } else {
      // An action with neither an incident nor a server has no rate-limit scope
      // and no resolvable target — refuse rather than fall through.
      return { ok: false, error: 'Action has no incident or server context' }
    }

    // Layer 4 — Global hourly cap
    checkGlobalRateLimit()

    // Execute via the *elevated remediation credential* so the read-only
    // monitoring credential is never used for writes. Refuse if none configured.
    const remediationConn = serverStore.resolveRemediationConnection(server)
    if (!remediationConn) {
      return {
        ok: false,
        error:
          'No elevated remediation credential is configured for this server. Add one in the server settings to run fixes.'
      }
    }
    const pool = await getPool(remediationConn)

    // Layer 2 — Hard-coded preconditions (TypeScript, not delegated to LLM).
    const preconditionError = await validateActionPreconditions(action, pool)
    if (preconditionError) {
      await repository.failAction(req.actionId, preconditionError)
      const failed = await repository.getActionById(req.actionId)
      if (failed) notifyActionChange(failed)
      return { ok: false, error: preconditionError }
    }

    // Atomically claim the action (pending → approved). The loser of a
    // concurrent approve race gets `false` here and aborts before executing,
    // so the SQL runs at most once even under double-submit.
    const claimed = await repository.tryClaimActionForExecution(req.actionId)
    if (!claimed) {
      return { ok: false, error: 'Action is no longer pending (already being processed)' }
    }

    const executableSql = buildActionSqlForExecution(action.toolName, action.params)
    await pool.request().query(executableSql)

    recordGlobalAction()
    // Audit non-repudiation: the approver is the authenticated session user,
    // never a renderer-supplied string (which would be spoofable).
    const approvedBy = getSession()?.username ?? 'unknown'
    await repository.approveAction(req.actionId, approvedBy, { executed: true })
    if (action.incidentId) {
      await repository.addEvent(action.incidentId, 'action_executed', {
        toolName: action.toolName,
        actionId: action.id
      })
    } else {
      log.info(
        `[actions] chat fix executed: ${action.toolName} on server ${action.serverId} by ${approvedBy}`
      )
    }

    const updated = await repository.getActionById(req.actionId)
    if (updated) notifyActionChange(updated)
    return { ok: true, data: updated ?? action }
  } catch (err) {
    // Mark the action as failed if execution throws.
    try {
      await repository.failAction(req.actionId, safeError(err))
    } catch {
      // Best-effort status update; preserve the original execution error below.
    }
    log.error('[IPC] approve action execute error:', safeError(err))
    return { ok: false, error: safeError(err) }
  }
}

async function rejectActionShared(req: RejectActionRequest): Promise<IpcResult<IncidentAction>> {
  try {
    const action = await repository.getActionById(req.actionId)
    if (!action) return { ok: false, error: `Action ${req.actionId} not found` }
    if (action.status !== 'pending')
      return { ok: false, error: `Action is not pending (status: ${action.status})` }

    await repository.rejectAction(req.actionId, req.reason ?? 'Rejected by user')
    if (action.incidentId) {
      await repository.addEvent(action.incidentId, 'status_change', {
        actionId: req.actionId,
        status: 'rejected'
      })
    }

    const updated = await repository.getActionById(req.actionId)
    if (updated) notifyActionChange(updated)
    return { ok: true, data: updated ?? action }
  } catch (err) {
    log.error('[IPC] reject action:', safeError(err))
    return { ok: false, error: safeError(err) }
  }
}

export function registerIncidentHandlers(): void {
  // Attach detector on first handler registration — idempotent in practice
  // (registerIpcHandlers is called once at startup)
  attachDetector()

  // Wire the agent runner so the detector can trigger it on new incidents.
  setAgentRunner(fireAgent)

  // Push incident changes to renderer whenever the detector fires
  onIncidentChange(async (type, incidentId) => {
    try {
      const incident = await repository.getIncidentById(incidentId)
      if (!incident) return
      const channel = type === 'created' ? IpcChannel.INCIDENT_CREATED : IpcChannel.INCIDENT_UPDATED
      pushToRenderer(channel, incident)
    } catch (err) {
      log.error('[incidents] onIncidentChange dispatch failed:', safeError(err))
    }
  })

  handle(
    IpcChannel.INCIDENTS_LIST,
    async (
      _event: IpcMainInvokeEvent,
      req?: IncidentListRequest
    ): Promise<IpcResult<Incident[]>> => {
      try {
        return { ok: true, data: await repository.listIncidents(req) }
      } catch (err) {
        log.error('[IPC] INCIDENTS_LIST:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(
    IpcChannel.INCIDENTS_GET,
    async (_event: IpcMainInvokeEvent, id: string): Promise<IpcResult<IncidentDetail>> => {
      try {
        const incident = await repository.getIncidentById(id)
        if (!incident) return { ok: false, error: `Incident ${id} not found` }
        const [events, actions, audit] = await Promise.all([
          repository.getEvents(id),
          repository.getActions(id),
          repository.getAuditEntries(id)
        ])
        return {
          ok: true,
          data: { incident, events, actions, audit }
        }
      } catch (err) {
        log.error('[IPC] INCIDENTS_GET:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(
    IpcChannel.INCIDENTS_SET_STATUS,
    async (
      _event: IpcMainInvokeEvent,
      req: IncidentSetStatusRequest
    ): Promise<IpcResult<null>> => {
      try {
        await repository.setIncidentStatus(req.id, req.status)
        const incident = await repository.getIncidentById(req.id)
        if (incident) pushToRenderer(IpcChannel.INCIDENT_UPDATED, incident)
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] INCIDENTS_SET_STATUS:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(IpcChannel.INCIDENTS_COUNT_OPEN, async (): Promise<IpcResult<number>> => {
    try {
      return { ok: true, data: await repository.countOpen() }
    } catch (err) {
      log.error('[IPC] INCIDENTS_COUNT_OPEN:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.INCIDENTS_AI_STATS, async (): Promise<IpcResult<IncidentAiStats>> => {
    try {
      return { ok: true, data: await repository.getAiStats() }
    } catch (err) {
      log.error('[IPC] INCIDENTS_AI_STATS:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.INCIDENTS_EXPORT_POSTMORTEM,
    async (_event: IpcMainInvokeEvent, id: string): Promise<IpcResult<string>> => {
      try {
        const incident = await repository.getIncidentById(id)
        if (!incident) return { ok: false, error: `Incident ${id} not found` }
        const [events, actions, audit] = await Promise.all([
          repository.getEvents(id),
          repository.getActions(id),
          repository.getAuditEntries(id)
        ])
        const md = buildPostmortem(incident, events, actions, audit)
        return { ok: true, data: md }
      } catch (err) {
        log.error('[IPC] INCIDENTS_EXPORT_POSTMORTEM:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(
    IpcChannel.INCIDENTS_RUN_AGENT,
    async (_event: IpcMainInvokeEvent, id: string): Promise<IpcResult<null>> => {
      const incident = await repository.getIncidentById(id)
      if (!incident) return { ok: false, error: `Incident ${id} not found` }
      if (!fireAgent(id)) {
        return { ok: false, error: `AI analysis already running for incident ${id}` }
      }
      return { ok: true, data: null }
    }
  )

  // Incident action approval — back-compat channel. Delegates to the shared
  // executor. `approvedBy` from the renderer is ignored (the session user is
  // authoritative); `confirmation` is forwarded for destructive actions.
  handle(
    IpcChannel.INCIDENTS_APPROVE_ACTION,
    async (
      _event: IpcMainInvokeEvent,
      req: { actionId: string; approvedBy?: string; confirmation?: string }
    ): Promise<IpcResult<null>> => {
      const res = await executeActionApproval({
        actionId: req.actionId,
        confirmation: req.confirmation
      })
      return res.ok ? { ok: true, data: null } : res
    }
  )

  handle(
    IpcChannel.INCIDENTS_REJECT_ACTION,
    async (
      _event: IpcMainInvokeEvent,
      req: { actionId: string; reason?: string }
    ): Promise<IpcResult<null>> => {
      const res = await rejectActionShared(req)
      return res.ok ? { ok: true, data: null } : res
    }
  )

  // Generalized remediation-action channels — used by both incidents and chat.
  handle(
    IpcChannel.ACTIONS_APPROVE,
    async (
      _event: IpcMainInvokeEvent,
      req: ApproveActionRequest
    ): Promise<IpcResult<IncidentAction>> => executeActionApproval(req)
  )

  handle(
    IpcChannel.ACTIONS_REJECT,
    async (
      _event: IpcMainInvokeEvent,
      req: RejectActionRequest
    ): Promise<IpcResult<IncidentAction>> => rejectActionShared(req)
  )

  handle(
    IpcChannel.ACTIONS_LIST_FOR_SERVER,
    async (
      _event: IpcMainInvokeEvent,
      serverId: string
    ): Promise<IpcResult<IncidentAction[]>> => {
      try {
        if (typeof serverId !== 'string' || !serverId) {
          return { ok: false, error: 'Invalid serverId' }
        }
        return { ok: true, data: await repository.getChatActionsForServer(serverId) }
      } catch (err) {
        log.error('[IPC] ACTIONS_LIST_FOR_SERVER:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
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
    if (ev.kind === 'alert_added')
      desc = `Alert: ${String(payload.message ?? '')} (${String(payload.severity ?? '')})`
    else if (ev.kind === 'tool_call')
      desc = `Tool: ${String(payload.name ?? '')}(${JSON.stringify(payload.params ?? {})})`
    else if (ev.kind === 'action_proposed')
      desc = `Proposed action: ${String(payload.toolName ?? '')}`
    else if (ev.kind === 'action_executed')
      desc = `Action executed: ${String(payload.toolName ?? '')} → ${String(payload.result ?? '')}`
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
      lines.push(
        `| ${ts} | ${entry.provider} | ${entry.model} | ${entry.tokensIn ?? '-'} | ${entry.tokensOut ?? '-'} |`
      )
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
