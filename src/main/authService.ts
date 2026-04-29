import bcrypt from 'bcryptjs'
import { randomUUID, createHash } from 'node:crypto'
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function login(
  username: string,
  password: string
): Promise<{ success: boolean; mustChangePassword?: boolean; error?: string }> {
  const user = await findByUsername(username.toLowerCase().trim())

  if (!user) {
    // Constant-time dummy compare to resist timing attacks
    await bcrypt.compare(password, DUMMY_HASH)
    return { success: false, error: 'Invalid credentials' }
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    return { success: false, error: 'Invalid credentials' }
  }

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

  return { success: true }
}

export function isMustChangePassword(): boolean {
  return currentSession?.mustChangePassword === true
}

/**
 * Called once at app startup. Creates admin/Admin1234! (must_change_password=true)
 * if the users table is empty.
 */
export async function initDefaultAdmin(): Promise<void> {
  const count = await countUsers()
  if (count === 0) {
    const hash = await bcrypt.hash('Admin1234!', SALT_ROUNDS)
    await createUser({
      id: randomUUID(),
      username: 'admin',
      password: hash,
      role: 'admin',
      mustChangePassword: true
    })
    log.info('[AUTH] Default admin user created — change password on first login')
  }
}
