import * as sql from 'mssql'
import { getPool } from './connection'

export interface SessionRow {
  token: string
  user_id: string
  username: string
  role: string
  expires_at: number
}

// Token length must match the PK column type (NVARCHAR(64)) exactly — binding
// NVarChar(500) here triggers an implicit conversion on the server side and
// disables the clustered PK seek, turning every authenticated IPC call into a
// table scan.
const TOKEN_LEN = 64

export async function createSession(session: SessionRow): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('token', sql.NVarChar(TOKEN_LEN), session.token)
    .input('user_id', sql.NVarChar(36), session.user_id)
    .input('username', sql.NVarChar(200), session.username)
    .input('role', sql.NVarChar(50), session.role)
    .input('expires_at', sql.BigInt, session.expires_at)
    .query(
      `INSERT INTO dbo.sessions (token, user_id, username, role, expires_at) VALUES (@token, @user_id, @username, @role, @expires_at)`
    )
}

export async function findSessionByToken(token: string): Promise<SessionRow | null> {
  const pool = getPool()
  const now = Math.floor(Date.now() / 1000)
  const r = await pool
    .request()
    .input('token', sql.NVarChar(TOKEN_LEN), token)
    .input('now', sql.BigInt, now)
    .query<SessionRow>(
      `SELECT token, user_id, username, role, expires_at FROM dbo.sessions WHERE token = @token AND expires_at > @now`
    )
  return r.recordset[0] ?? null
}

export async function removeSession(token: string): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('token', sql.NVarChar(TOKEN_LEN), token)
    .query(`DELETE FROM dbo.sessions WHERE token = @token`)
}

export async function removeExpiredSessions(): Promise<void> {
  const pool = getPool()
  const now = Math.floor(Date.now() / 1000)
  await pool
    .request()
    .input('now', sql.BigInt, now)
    .query(`DELETE FROM dbo.sessions WHERE expires_at <= @now`)
}
