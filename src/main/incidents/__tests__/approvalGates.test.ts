/**
 * Unit tests for the INCIDENTS_APPROVE_ACTION and INCIDENTS_REJECT_ACTION
 * handler business rules. The handler logic is inlined here (not exported),
 * following the same pattern as rateLimit.test.ts.
 *
 * Covers: whitelist guard, status guard, kill switch, rate limit,
 *         per-incident cap, rejection flow.
 */

import { describe, it, expect } from 'vitest'
import { ACTION_WHITELIST, isDestructiveAction } from '../../ai/actionTools'

// ---------------------------------------------------------------------------
// Business logic inlined from incidents.ipc.ts (not exported by that module)
// ---------------------------------------------------------------------------

const MAX_ACTIONS_PER_INCIDENT = 3
const MAX_ACTIONS_PER_HOUR = 10

function checkGlobalRateLimit(log: number[]): void {
  const cutoff = Date.now() - 3_600_000
  while (log.length > 0 && log[0] < cutoff) log.shift()
  if (log.length >= MAX_ACTIONS_PER_HOUR) {
    throw new Error(`Global rate limit reached: max ${MAX_ACTIONS_PER_HOUR} agent actions per hour`)
  }
}

function checkIncidentCap(approvedCount: number): string | null {
  if (approvedCount >= MAX_ACTIONS_PER_INCIDENT) {
    return `Incident action cap reached (max ${MAX_ACTIONS_PER_INCIDENT} per incident)`
  }
  return null
}

type MockAction = {
  id: string
  incidentId: string
  toolName: string
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'
}

function simulateApprove(
  action: MockAction | null,
  opts: {
    agentActionsEnabled?: boolean
    approvedCount?: number
    hourlyLog?: number[]
  } = {}
): { ok: boolean; error?: string } {
  if (!action) return { ok: false, error: 'Action not found' }
  if (action.status !== 'pending') return { ok: false, error: `Action is not pending (status: ${action.status})` }

  const enabled = opts.agentActionsEnabled ?? true
  if (!enabled) return { ok: false, error: 'Agent actions are disabled in Settings → AI Provider' }

  if (!ACTION_WHITELIST.has(action.toolName)) {
    return { ok: false, error: `Tool '${action.toolName}' is not whitelisted for execution` }
  }

  const cap = checkIncidentCap(opts.approvedCount ?? 0)
  if (cap) return { ok: false, error: cap }

  const log = opts.hourlyLog ?? []
  try {
    checkGlobalRateLimit(log)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Simulate successful execution
  action.status = 'executed'
  log.push(Date.now())
  return { ok: true }
}

function simulateReject(
  action: MockAction | null,
  reason = 'Rejected by user'
): { ok: boolean; error?: string } {
  if (!action) return { ok: false, error: 'Action not found' }
  if (action.status !== 'pending') return { ok: false, error: `Action is not pending (status: ${action.status})` }
  action.status = 'rejected'
  return { ok: true }
}

function pendingAction(toolName = 'kill_session'): MockAction {
  return { id: 'act-1', incidentId: 'inc-1', toolName, status: 'pending' }
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('INCIDENTS_APPROVE_ACTION — action not found', () => {
  it('returns error when action is null', () => {
    const result = simulateApprove(null)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/)
  })
})

describe('INCIDENTS_APPROVE_ACTION — status guard', () => {
  it('rejects already-executed action', () => {
    const action: MockAction = { ...pendingAction(), status: 'executed' }
    const result = simulateApprove(action)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not pending/)
    expect(result.error).toContain('executed')
  })

  it('rejects already-rejected action', () => {
    const action: MockAction = { ...pendingAction(), status: 'rejected' }
    const result = simulateApprove(action)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not pending/)
    expect(result.error).toContain('rejected')
  })

  it('rejects failed action', () => {
    const action: MockAction = { ...pendingAction(), status: 'failed' }
    const result = simulateApprove(action)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not pending/)
  })
})

describe('INCIDENTS_APPROVE_ACTION — kill switch', () => {
  it('blocks when agent actions are disabled', () => {
    const result = simulateApprove(pendingAction(), { agentActionsEnabled: false })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/disabled/)
  })

  it('allows when agent actions are enabled (default)', () => {
    const result = simulateApprove(pendingAction())
    expect(result.ok).toBe(true)
  })
})

describe('INCIDENTS_APPROVE_ACTION — whitelist guard', () => {
  it('blocks tool not on whitelist', () => {
    const result = simulateApprove(pendingAction('drop_table'))
    expect(result.ok).toBe(false)
    expect(result.error).toContain("'drop_table' is not whitelisted")
  })

  it('blocks arbitrary tool names not on whitelist', () => {
    for (const tool of ['exec_sp', 'bulk_insert', 'shutdown_server', 'get_passwords']) {
      const result = simulateApprove(pendingAction(tool))
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not whitelisted')
    }
  })

  it('allows all whitelisted tools', () => {
    for (const tool of ACTION_WHITELIST) {
      const result = simulateApprove(pendingAction(tool))
      expect(result.ok).toBe(true)
    }
  })
})

describe('INCIDENTS_APPROVE_ACTION — per-incident cap', () => {
  it('allows up to MAX_ACTIONS_PER_INCIDENT', () => {
    expect(simulateApprove(pendingAction(), { approvedCount: 0 }).ok).toBe(true)
    expect(simulateApprove(pendingAction(), { approvedCount: 1 }).ok).toBe(true)
    expect(simulateApprove(pendingAction(), { approvedCount: 2 }).ok).toBe(true)
  })

  it('blocks when cap is already reached', () => {
    const result = simulateApprove(pendingAction(), { approvedCount: 3 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cap reached/)
    expect(result.error).toContain('3')
  })

  it('blocks well above cap', () => {
    const result = simulateApprove(pendingAction(), { approvedCount: 10 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cap reached/)
  })
})

describe('INCIDENTS_APPROVE_ACTION — global hourly rate limit', () => {
  it('allows up to MAX_ACTIONS_PER_HOUR approvals in one hour', () => {
    const log: number[] = []
    for (let i = 0; i < MAX_ACTIONS_PER_HOUR; i++) {
      const result = simulateApprove(pendingAction(), { hourlyLog: log })
      expect(result.ok).toBe(true)
    }
    expect(log).toHaveLength(MAX_ACTIONS_PER_HOUR)
  })

  it('blocks the (MAX+1)th approval within the same hour', () => {
    const log: number[] = Array.from({ length: MAX_ACTIONS_PER_HOUR }, () => Date.now())
    const result = simulateApprove(pendingAction(), { hourlyLog: log })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Global rate limit/)
  })

  it('allows approvals again after stale entries expire', () => {
    const staleTs = Date.now() - 3_600_001
    const log: number[] = Array.from({ length: MAX_ACTIONS_PER_HOUR }, () => staleTs)
    const result = simulateApprove(pendingAction(), { hourlyLog: log })
    expect(result.ok).toBe(true)
  })
})

describe('INCIDENTS_REJECT_ACTION', () => {
  it('marks a pending action as rejected', () => {
    const action = pendingAction()
    const result = simulateReject(action)
    expect(result.ok).toBe(true)
    expect(action.status).toBe('rejected')
  })

  it('returns error when action not found', () => {
    const result = simulateReject(null)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/)
  })

  it('blocks rejecting an already-executed action', () => {
    const action: MockAction = { ...pendingAction(), status: 'executed' }
    const result = simulateReject(action)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not pending/)
  })

  it('blocks double-rejection', () => {
    const action = pendingAction()
    simulateReject(action)
    expect(action.status).toBe('rejected')
    const result = simulateReject(action)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not pending/)
  })
})

// ---------------------------------------------------------------------------
// New gates added for chat-originated remediation actions. Logic mirrors
// incidents.ipc.ts (not exported); kept in sync with the handler.
// ---------------------------------------------------------------------------

const MAX_CHAT_ACTIONS_PER_SERVER_PER_HOUR = 5

function checkTypedConfirmation(
  toolName: string,
  expectedToken: string,
  confirmation: string | undefined
): string | null {
  if (!isDestructiveAction(toolName)) return null
  if ((confirmation ?? '').trim() !== expectedToken) {
    return `This action is destructive and requires typed confirmation. Type "${expectedToken}" to confirm.`
  }
  return null
}

function checkRemediationCred(conn: unknown | null): string | null {
  if (!conn) {
    return 'No elevated remediation credential is configured for this server. Add one in the server settings to run fixes.'
  }
  return null
}

function checkServerCap(count: number): string | null {
  if (count >= MAX_CHAT_ACTIONS_PER_SERVER_PER_HOUR) {
    return `Per-server action cap reached (max ${MAX_CHAT_ACTIONS_PER_SERVER_PER_HOUR} per hour)`
  }
  return null
}

describe('ACTIONS_APPROVE — destructive typed-confirmation gate', () => {
  const TOKEN = '10.0.0.1:1433'

  it('blocks a destructive action with no confirmation', () => {
    expect(checkTypedConfirmation('kill_session', TOKEN, undefined)).toMatch(/typed confirmation/)
  })

  it('blocks a destructive action with the wrong token', () => {
    expect(checkTypedConfirmation('rebuild_index', TOKEN, 'wrong')).toMatch(/typed confirmation/)
  })

  it('allows a destructive action with the exact token', () => {
    expect(checkTypedConfirmation('clear_plan_cache', TOKEN, TOKEN)).toBeNull()
  })

  it('ignores confirmation for non-destructive actions', () => {
    expect(checkTypedConfirmation('update_statistics', TOKEN, undefined)).toBeNull()
    expect(checkTypedConfirmation('reorganize_index', TOKEN, undefined)).toBeNull()
  })
})

describe('ACTIONS_APPROVE — remediation credential requirement', () => {
  it('refuses to execute when no remediation credential is configured', () => {
    expect(checkRemediationCred(null)).toMatch(/remediation credential/)
  })

  it('proceeds when a remediation credential is present', () => {
    expect(checkRemediationCred({ username: 'svc_fix' })).toBeNull()
  })
})

describe('ACTIONS_APPROVE — per-server chat rate limit', () => {
  it('allows up to the per-server cap', () => {
    for (let i = 0; i < MAX_CHAT_ACTIONS_PER_SERVER_PER_HOUR; i++) {
      expect(checkServerCap(i)).toBeNull()
    }
  })

  it('blocks once the per-server cap is reached', () => {
    expect(checkServerCap(MAX_CHAT_ACTIONS_PER_SERVER_PER_HOUR)).toMatch(/Per-server action cap/)
  })
})

describe('Approval → rejection idempotency', () => {
  it('cannot approve an action that was already rejected', () => {
    const action = pendingAction()
    simulateReject(action) // first: reject
    const result = simulateApprove(action) // then: approve → must fail
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not pending/)
  })

  it('cannot reject an action that was already approved', () => {
    const action = pendingAction()
    simulateApprove(action) // first: approve
    expect(action.status).toBe('executed')
    const result = simulateReject(action) // then: reject → must fail
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not pending/)
  })
})
