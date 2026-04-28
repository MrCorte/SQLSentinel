import * as sql from 'mssql'
import { getPool } from './connection'

export interface UserRow {
  id: string
  username: string
  password: string
  role: string
  created_at: number
  last_login: number | null
  must_change_password: boolean
}

export async function findByUsername(username: string): Promise<UserRow | null> {
  const pool = getPool()
  const r = await pool
    .request()
    .input('username', sql.NVarChar(200), username)
    .query<UserRow>(
      `SELECT id, username, password, role, created_at, last_login, must_change_password FROM dbo.users WHERE username = @username`
    )
  return r.recordset[0] ?? null
}

export async function findById(id: string): Promise<UserRow | null> {
  const pool = getPool()
  const r = await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .query<UserRow>(
      `SELECT id, username, password, role, created_at, last_login, must_change_password FROM dbo.users WHERE id = @id`
    )
  return r.recordset[0] ?? null
}

export async function countUsers(): Promise<number> {
  const pool = getPool()
  const r = await pool
    .request()
    .query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM dbo.users`)
  return r.recordset[0].cnt
}

export async function createUser(params: {
  id: string
  username: string
  password: string
  role: string
  mustChangePassword?: boolean
}): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(36), params.id)
    .input('username', sql.NVarChar(200), params.username)
    .input('password', sql.NVarChar(500), params.password)
    .input('role', sql.NVarChar(50), params.role)
    .input('mcp', sql.Bit, params.mustChangePassword ? 1 : 0)
    .query(
      `INSERT INTO dbo.users (id, username, password, role, must_change_password) VALUES (@id, @username, @password, @role, @mcp)`
    )
}

export async function updateLastLogin(id: string): Promise<void> {
  const pool = getPool()
  const epoch = Math.floor(Date.now() / 1000)
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('ts', sql.BigInt, epoch)
    .query(`UPDATE dbo.users SET last_login = @ts WHERE id = @id`)
}

export async function updatePassword(
  id: string,
  hashedPassword: string,
  mustChangePassword = false
): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('password', sql.NVarChar(500), hashedPassword)
    .input('mcp', sql.Bit, mustChangePassword ? 1 : 0)
    .query(
      `UPDATE dbo.users SET password = @password, must_change_password = @mcp WHERE id = @id`
    )
}
