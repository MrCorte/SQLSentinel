import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Inline the rate-limit logic (not exported) so we can unit-test it in
// isolation without spinning up the full IPC layer.
// ---------------------------------------------------------------------------

const MAX_ACTIONS_PER_INCIDENT = 3
const MAX_ACTIONS_PER_HOUR = 10

function makeRateLimiter() {
  const hourlyLog: number[] = []

  function checkGlobal(): void {
    const cutoff = Date.now() - 3_600_000
    while (hourlyLog.length > 0 && hourlyLog[0] < cutoff) hourlyLog.shift()
    if (hourlyLog.length >= MAX_ACTIONS_PER_HOUR) {
      throw new Error(`Global rate limit reached: max ${MAX_ACTIONS_PER_HOUR} agent actions per hour`)
    }
  }

  function record(): void {
    hourlyLog.push(Date.now())
  }

  return { checkGlobal, record, _log: hourlyLog }
}

describe('Global hourly rate limiter', () => {
  it('allows up to MAX_ACTIONS_PER_HOUR actions', () => {
    const { checkGlobal, record } = makeRateLimiter()
    for (let i = 0; i < MAX_ACTIONS_PER_HOUR; i++) {
      expect(() => checkGlobal()).not.toThrow()
      record()
    }
  })

  it('throws on the (MAX+1)th action within same hour', () => {
    const { checkGlobal, record } = makeRateLimiter()
    for (let i = 0; i < MAX_ACTIONS_PER_HOUR; i++) record()
    expect(() => checkGlobal()).toThrow(/Global rate limit/)
  })

  it('evicts old entries and allows actions after 1 hour', () => {
    const { checkGlobal, record, _log } = makeRateLimiter()
    const old = Date.now() - 3_600_001
    for (let i = 0; i < MAX_ACTIONS_PER_HOUR; i++) _log.push(old)
    // All entries are stale → should not throw
    expect(() => checkGlobal()).not.toThrow()
  })
})

describe('Per-incident action cap', () => {
  function checkIncidentCap(approvedCount: number): string | null {
    if (approvedCount >= MAX_ACTIONS_PER_INCIDENT) {
      return `Incident action cap reached (max ${MAX_ACTIONS_PER_INCIDENT} per incident)`
    }
    return null
  }

  it('allows up to MAX_ACTIONS_PER_INCIDENT', () => {
    expect(checkIncidentCap(0)).toBeNull()
    expect(checkIncidentCap(1)).toBeNull()
    expect(checkIncidentCap(2)).toBeNull()
  })

  it('blocks when cap is reached', () => {
    expect(checkIncidentCap(3)).toMatch(/cap reached/)
    expect(checkIncidentCap(10)).toMatch(/cap reached/)
  })
})

describe('kill_session precondition logic', () => {
  const PROTECTED_LOGINS = new Set([
    'sa',
    'NT AUTHORITY\\SYSTEM',
    'NT AUTHORITY\\NETWORK SERVICE',
    'NT AUTHORITY\\LOCAL SERVICE',
    'NT SERVICE\\MSSQLSERVER',
    'NT SERVICE\\SQLSERVERAGENT'
  ])

  function validateKillLocal(
    sessionId: number,
    session: { login_name: string; is_user_process: number } | null
  ): string | null {
    if (!Number.isInteger(sessionId) || sessionId <= 0) return `Invalid session_id: ${sessionId}`
    if (sessionId <= 50) return `Cannot kill system session (session_id ${sessionId} ≤ 50)`
    if (!session) return `Session ${sessionId} not found — it may have already ended`
    if (!session.is_user_process) return `Session ${sessionId} is a system process — cannot kill`
    if (PROTECTED_LOGINS.has(session.login_name)) {
      return `Login '${session.login_name}' is protected — cannot kill`
    }
    return null
  }

  it('rejects session_id <= 50', () => {
    expect(validateKillLocal(1, { login_name: 'sa', is_user_process: 1 })).toMatch(/system session/)
    expect(validateKillLocal(50, { login_name: 'app', is_user_process: 1 })).toMatch(/system session/)
  })

  it('rejects non-integer session_id', () => {
    expect(validateKillLocal(NaN, null)).toMatch(/Invalid/)
  })

  it('rejects when session not found', () => {
    expect(validateKillLocal(200, null)).toMatch(/not found/)
  })

  it('rejects system process', () => {
    expect(validateKillLocal(200, { login_name: 'app', is_user_process: 0 })).toMatch(/system process/)
  })

  it('rejects protected logins', () => {
    for (const login of PROTECTED_LOGINS) {
      expect(validateKillLocal(200, { login_name: login, is_user_process: 1 })).toMatch(/protected/)
    }
  })

  it('allows valid user sessions above 50', () => {
    expect(validateKillLocal(99, { login_name: 'app_user', is_user_process: 1 })).toBeNull()
    expect(validateKillLocal(51, { login_name: 'erp_login', is_user_process: 1 })).toBeNull()
  })
})
