import bcrypt from 'bcryptjs'
import { randomUUID, createHash, randomBytes } from 'node:crypto'
import { writeFileSync, chmodSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { app } from 'electron'
import {
  findByUsername,
  findById,
  countUsers,
  createUser,
  updateLastLogin,
  updatePassword
} from './store/sqlserver/usersRepository'
import {
  createSession,
  removeSession
} from './store/sqlserver/sessionsRepository'
import { getRawSetting, setRawSetting } from './store/settings'
import { createLogger } from './utils/logger'

const log = createLogger('auth')

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SALT_ROUNDS = 12
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 hours

// Rate limiting: per-username failed-login tracking with progressive cooldown.
// Resets on a successful login. Survives only in-memory (cleared on restart);
// brute force across restarts is bounded by bcrypt cost (~250ms / try).
const LOCKOUT_THRESHOLD = 5
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000 // 15 min sliding window
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 min lockout after threshold

// Real bcrypt hash used for constant-time compare when the lookup misses.
// Computed once at startup so bcrypt.compare doesn't throw on a malformed hash
// (which would leak user-existence via timing). The plaintext is never used.
const DUMMY_HASH = bcrypt.hashSync('not-a-valid-password-placeholder', SALT_ROUNDS)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthSession {
  token: string
  userId: string
  username: string
  role: string
  expiresAt: number
  mustChangePassword: boolean
}

// ---------------------------------------------------------------------------
// In-memory session (not persisted to disk — cleared on app restart)
// ---------------------------------------------------------------------------

let currentSession: AuthSession | null = null

interface LoginAttempt {
  failed: number
  firstFailedAt: number
  lockedUntil: number
}
const loginAttempts = new Map<string, LoginAttempt>()

function recordFailedLogin(usernameKey: string): void {
  const now = Date.now()
  // Opportunistic sweep: drop entries whose window has expired AND aren't
  // currently locked. Without this, a username-spray attacker accumulates one
  // entry per unique username forever (~120 bytes each, unbounded growth).
  // We sweep at most every LOCKOUT_WINDOW_MS to keep the cost amortised.
  if (now - lastLoginSweep > LOCKOUT_WINDOW_MS) {
    for (const [key, e] of loginAttempts) {
      if (now - e.firstFailedAt > LOCKOUT_WINDOW_MS && e.lockedUntil < now) {
        loginAttempts.delete(key)
      }
    }
    lastLoginSweep = now
  }

  const entry = loginAttempts.get(usernameKey)
  if (!entry || now - entry.firstFailedAt > LOCKOUT_WINDOW_MS) {
    loginAttempts.set(usernameKey, { failed: 1, firstFailedAt: now, lockedUntil: 0 })
    return
  }
  entry.failed += 1
  if (entry.failed >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS
  }
}

let lastLoginSweep = 0

function getLockoutStatus(usernameKey: string): { locked: boolean; retryAfterMs: number } {
  const entry = loginAttempts.get(usernameKey)
  if (!entry) return { locked: false, retryAfterMs: 0 }
  const now = Date.now()
  if (entry.lockedUntil > now) {
    return { locked: true, retryAfterMs: entry.lockedUntil - now }
  }
  // Lockout expired but window not yet expired — keep counter for tracking only.
  return { locked: false, retryAfterMs: 0 }
}

function clearLoginAttempts(usernameKey: string): void {
  loginAttempts.delete(usernameKey)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function login(
  username: string,
  password: string
): Promise<{ success: boolean; mustChangePassword?: boolean; error?: string }> {
  const usernameKey = username.toLowerCase().trim()

  // Per-username lockout: progressive 15-min cooldown after 5 failed attempts.
  const lockout = getLockoutStatus(usernameKey)
  if (lockout.locked) {
    log.warn(`[AUTH] Account locked for "${usernameKey}", retry in ${Math.ceil(lockout.retryAfterMs / 1000)}s`)
    // Constant-time bcrypt compare anyway to mask the lockout state from timing.
    await bcrypt.compare(password, DUMMY_HASH)
    return {
      success: false,
      error: `Too many failed attempts — try again in ${Math.ceil(lockout.retryAfterMs / 60000)} min`
    }
  }

  const user = await findByUsername(usernameKey)

  if (!user) {
    // Constant-time dummy compare to resist timing attacks
    await bcrypt.compare(password, DUMMY_HASH)
    recordFailedLogin(usernameKey)
    return { success: false, error: 'Invalid credentials' }
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    recordFailedLogin(usernameKey)
    return { success: false, error: 'Invalid credentials' }
  }

  // Successful auth — clear failed-attempt counter for this account.
  clearLoginAttempts(usernameKey)

  const token = randomUUID()
  const expiresAt = Date.now() + SESSION_TIMEOUT_MS

  currentSession = {
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    expiresAt,
    mustChangePassword: user.must_change_password === true
  }

  updateLastLogin(user.id).catch((err) => log.warn('[AUTH] updateLastLogin failed:', err))

  // Persist hash of token so a DB dump never reveals a live session identifier.
  // The plaintext token lives only in memory for the duration of the process.
  createSession({
    token: hashToken(token),
    user_id: user.id,
    username: user.username,
    role: user.role,
    expires_at: Math.floor(expiresAt / 1000)
  }).catch((err) => log.warn('[AUTH] createSession failed:', err))

  return { success: true, mustChangePassword: user.must_change_password === true }
}

export function logout(): void {
  if (currentSession) {
    removeSession(hashToken(currentSession.token)).catch(() => {})
  }
  currentSession = null
}

export function getSession(): AuthSession | null {
  const now = Date.now()

  if (currentSession) {
    if (now > currentSession.expiresAt) {
      logout()
      return null
    }
    // Sliding expiry — renew in memory (fire-and-forget DB update)
    currentSession.expiresAt = now + SESSION_TIMEOUT_MS
    return { ...currentSession }
  }

  // In-memory session lost — require re-login. We no longer hydrate from DB
  // because the DB only stores the token hash, and the plaintext is unrecoverable.
  // Dev hot-reload therefore forces a fresh login, which is acceptable.
  return null
}

export function isAuthenticated(): boolean {
  return getSession() !== null
}

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const user = await findById(userId)

  if (!user) return { success: false, error: 'User not found' }

  const valid = await bcrypt.compare(oldPassword, user.password)
  if (!valid) return { success: false, error: 'Current password incorrect' }

  if (newPassword.length < 8) return { success: false, error: 'Minimum 8 characters' }
  if (!/[A-Z]/.test(newPassword)) return { success: false, error: 'At least one uppercase letter' }
  if (!/[0-9]/.test(newPassword)) return { success: false, error: 'At least one number' }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await updatePassword(userId, hash, false)

  // Update session with cleared must_change_password flag
  if (currentSession?.userId === userId) {
    currentSession.expiresAt = Date.now() + SESSION_TIMEOUT_MS
    currentSession.mustChangePassword = false
  }

  if (user.username === 'admin') {
    // Keep local backup hash in sync so restore after SQL Server reset uses the new password.
    setRawSetting('admin_bootstrap_hash', hash)

    // H3: delete admin-bootstrap.txt — original plaintext is no longer valid.
    try {
      const bootstrapPath = join(app.getPath('userData'), 'admin-bootstrap.txt')
      if (existsSync(bootstrapPath)) {
        unlinkSync(bootstrapPath)
        log.info(`[AUTH] Removed admin-bootstrap.txt after password change`)
      }
    } catch (err) {
      log.warn('[AUTH] Could not remove bootstrap file:', err)
    }
  }

  return { success: true }
}

export function isMustChangePassword(): boolean {
  return currentSession?.mustChangePassword === true
}

// Generate a 16-char password meeting the policy enforced by changePassword()
// (>=8 chars, at least 1 uppercase, 1 number). Uses base64url + a guaranteed
// uppercase/digit prefix.
function generateBootstrapPassword(): string {
  const random = randomBytes(12).toString('base64').replace(/[+/=]/g, '')
  return `A1${random}`
}

function lockDownPathWindows(path: string): void {
  if (process.platform !== 'win32') return
  try {
    execFileSync('icacls', [path, '/inheritance:r'], { stdio: 'ignore' })
    execFileSync('icacls', [path, '/grant:r', 'SYSTEM:(F)', 'Administrators:(F)'], {
      stdio: 'ignore'
    })
  } catch {
    // best-effort
  }
}

function writeBootstrapCredentialsFile(username: string, password: string): string | null {
  try {
    const userData = app.getPath('userData')
    const target = join(userData, 'admin-bootstrap.txt')
    const content =
      `SQLSentinel — initial admin credentials (delete this file after first login)\n` +
      `Generated: ${new Date().toISOString()}\n\n` +
      `username: ${username}\n` +
      `password: ${password}\n`
    writeFileSync(target, content, { encoding: 'utf8' })
    if (process.platform !== 'win32') {
      try {
        chmodSync(target, 0o600)
      } catch {
        // best-effort
      }
    } else {
      lockDownPathWindows(target)
    }
    return target
  } catch (err) {
    log.error('[AUTH] Could not write bootstrap credentials file:', err)
    return null
  }
}

/**
 * Called once at app startup. Creates admin/<random> with must_change_password=true
 * if the users table is empty. The plaintext is written to admin-bootstrap.txt
 * (ACL-locked to the current user) so the operator can read it once and then
 * delete the file.
 */
export async function initDefaultAdmin(): Promise<void> {
  const count = await countUsers()
  if (count !== 0) return

  // Check if admin was previously created — SQLite persists the hash so we can
  // restore it if the SQL Server database is wiped (e.g. container recreated).
  const storedHash = getRawSetting('admin_bootstrap_hash')
  if (storedHash) {
    await createUser({
      id: randomUUID(),
      username: 'admin',
      password: storedHash,
      role: 'admin',
      mustChangePassword: false
    })
    log.warn('[AUTH] Admin user restored from local backup — SQL Server users table was empty.')
    return
  }

  const plaintext = generateBootstrapPassword()
  const hash = await bcrypt.hash(plaintext, SALT_ROUNDS)
  await createUser({
    id: randomUUID(),
    username: 'admin',
    password: hash,
    role: 'admin',
    mustChangePassword: true
  })
  // Persist hash locally so it survives SQL Server resets
  setRawSetting('admin_bootstrap_hash', hash)

  const filePath = writeBootstrapCredentialsFile('admin', plaintext)
  if (filePath) {
    log.warn(
      `[AUTH] Default admin created. Initial password written to ${filePath} ` +
        `— log in and change it, then delete the file.`
    )
  } else {
    log.warn(`[AUTH] Default admin created. Initial password: ${plaintext} (CHANGE IMMEDIATELY)`)
  }
}
