import bcrypt from 'bcryptjs'
import { randomUUID, createHash } from 'node:crypto'
import { getDb } from './store/database'

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
  const db = getDb()
  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username.toLowerCase().trim()) as UserRow | undefined

  if (!user) {
    // Constant-time dummy compare to resist timing attacks
    await bcrypt.compare(password, '$2a$12$dummyhashfortimingresistancexx')
    return { success: false, error: 'Credenziali non valide' }
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    return { success: false, error: 'Credenziali non valide' }
  }

  const token = randomUUID()
  const expiresAt = Date.now() + SESSION_TIMEOUT_MS

  currentSession = {
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    expiresAt,
    mustChangePassword: user.must_change_password === 1,
  }

  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id)

  // Persist hash of token so a DB dump never reveals a live session identifier.
  // The plaintext token lives only in memory for the duration of the process.
  db.prepare(
    'INSERT OR REPLACE INTO sessions (token, user_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(hashToken(token), user.id, user.username, user.role, expiresAt)

  return { success: true, mustChangePassword: user.must_change_password === 1 }
}

export function logout(): void {
  if (currentSession) {
    try {
      getDb().prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(currentSession.token))
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
      getDb()
        .prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
        .run(currentSession.expiresAt, hashToken(currentSession.token))
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
  const db = getDb()
  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(userId) as UserRow | undefined

  if (!user) return { success: false, error: 'Utente non trovato' }

  const valid = await bcrypt.compare(oldPassword, user.password)
  if (!valid) return { success: false, error: 'Password attuale non corretta' }

  if (newPassword.length < 8) return { success: false, error: 'Minimo 8 caratteri' }
  if (!/[A-Z]/.test(newPassword)) return { success: false, error: 'Almeno una lettera maiuscola' }
  if (!/[0-9]/.test(newPassword)) return { success: false, error: 'Almeno un numero' }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  db.prepare('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?').run(
    hash,
    userId
  )

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
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }
  if (row.n === 0) {
    const hash = await bcrypt.hash('Admin1234!', SALT_ROUNDS)
    db.prepare(
      `INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, 'admin', 1)`
    ).run('admin', hash)
    console.log('[AUTH] Default admin user created — change password on first login')
  }
}
