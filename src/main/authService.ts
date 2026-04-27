import bcrypt from 'bcryptjs'
import { randomUUID, createHash } from 'node:crypto'
import { getDb } from './store/database'
import type Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'
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

interface UserRow {
  id: string
  username: string
  password: string
  role: string
  created_at: number
  last_login: number | null
  must_change_password: number
}

// ---------------------------------------------------------------------------
// Cached prepared statements
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null
let _stmts: {
  getUserByUsername: Statement<[string], UserRow>
  updateLastLogin: Statement<[number, string]>
  insertSession: Statement<[string, string, string, string, number]>
  deleteSession: Statement<[string]>
  updateSessionExpiry: Statement<[number, string]>
  getUserById: Statement<[string], UserRow>
  updatePassword: Statement<[string, string]>
  countUsers: Statement<[], { n: number }>
  insertUser: Statement<[string, string]>
} | null = null

function stmts() {
  const db = getDb()
  if (_stmts && _db === db) return _stmts
  _db = db
  _stmts = {
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    updateLastLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),
    insertSession: db.prepare(
      'INSERT OR REPLACE INTO sessions (token, user_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)'
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    updateSessionExpiry: db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?'),
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    updatePassword: db.prepare(
      'UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?'
    ),
    countUsers: db.prepare('SELECT COUNT(*) as n FROM users'),
    insertUser: db.prepare(
      `INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, 'admin', 1)`
    )
  }
  return _stmts
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
  const user = stmts().getUserByUsername.get(username.toLowerCase().trim()) as UserRow | undefined

  if (!user) {
    // Constant-time dummy compare to resist timing attacks
    await bcrypt.compare(password, '$2a$12$dummyhashfortimingresistancexx')
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
    mustChangePassword: user.must_change_password === 1
  }

  stmts().updateLastLogin.run(Date.now(), user.id)

  // Persist hash of token so a DB dump never reveals a live session identifier.
  // The plaintext token lives only in memory for the duration of the process.
  stmts().insertSession.run(hashToken(token), user.id, user.username, user.role, expiresAt)

  return { success: true, mustChangePassword: user.must_change_password === 1 }
}

export function logout(): void {
  if (currentSession) {
    try {
      stmts().deleteSession.run(hashToken(currentSession.token))
    } catch {
      // DB might not be open yet during tests
    }
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
    // Sliding expiry — renew in memory and DB
    currentSession.expiresAt = now + SESSION_TIMEOUT_MS
    try {
      stmts().updateSessionExpiry.run(currentSession.expiresAt, hashToken(currentSession.token))
    } catch {
      // ignore — in-memory session is still valid
    }
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
  const user = stmts().getUserById.get(userId) as UserRow | undefined

  if (!user) return { success: false, error: 'User not found' }

  const valid = await bcrypt.compare(oldPassword, user.password)
  if (!valid) return { success: false, error: 'Current password incorrect' }

  if (newPassword.length < 8) return { success: false, error: 'Minimum 8 characters' }
  if (!/[A-Z]/.test(newPassword)) return { success: false, error: 'At least one uppercase letter' }
  if (!/[0-9]/.test(newPassword)) return { success: false, error: 'At least one number' }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  stmts().updatePassword.run(hash, userId)

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
 * Called once at app startup. Creates admin/Admin1234! (must_change_password=1)
 * if the users table is empty.
 */
export async function initDefaultAdmin(): Promise<void> {
  const row = stmts().countUsers.get() as { n: number }
  if (row.n === 0) {
    const hash = await bcrypt.hash('Admin1234!', SALT_ROUNDS)
    stmts().insertUser.run('admin', hash)
    log.info('[AUTH] Default admin user created — change password on first login')
  }
}
