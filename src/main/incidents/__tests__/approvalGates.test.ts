/**
 * Unit tests for the INCIDENTS_APPROVE_ACTION and INCIDENTS_REJECT_ACTION
 * handler business rules. The handler logic is inlined here (not exported),
 * following the same pattern as rateLimit.test.ts.
 *
 * Covers: whitelist guard, status guard, kill switch, rate limit,
 *         per-incident cap, rejection flow.
 */

import { describe, it, expect } from 'vitest'
import { ACTION_WHITELIST } from '../../ai/actionTools'

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
