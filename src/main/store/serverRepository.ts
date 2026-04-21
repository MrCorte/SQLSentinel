import { randomUUID } from 'node:crypto'
import { getDb } from './database'
import type { StoredServer } from './types'
import type Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'

// --- Mapping riga SQLite ↔ StoredServer ---

interface ServerRow {
  id: string
  ip: string
  port: number
  instance_name: string | null
  use_windows_auth: number // 0 | 1
  username: string | null
  encrypted_password: string | null
  added_at: string // ISO 8601
  last_seen_at: string | null
  last_metrics_at: string | null
}

function rowToServer(row: ServerRow): StoredServer {
  return {
    id: row.id,
    ip: row.ip,
    port: row.port,
    instanceName: row.instance_name ?? undefined,
    useWindowsAuth: row.use_windows_auth === 1,
    username: row.username ?? undefined,
    encryptedPassword: row.encrypted_password ?? undefined,
    addedAt: new Date(row.added_at),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    lastMetricsAt: row.last_metrics_at ? new Date(row.last_metrics_at) : null
  }
}

// --- Cached prepared statements ---

let _db: Database.Database | null = null
let _stmts: {
  findAll: Statement<[], ServerRow>
  findById: Statement<[string], ServerRow>
  upsert: Statement
  findByIpPort: Statement<[string, number], ServerRow>
  remove: Statement<[string]>
  updateLastSeen: Statement<[string, string]>
  updateLastMetrics: Statement<[string, string]>
} | null = null

function stmts() {
  const db = getDb()
  if (_stmts && _db === db) return _stmts
  _db = db
  _stmts = {
    findAll: db.prepare<[], ServerRow>('SELECT * FROM servers ORDER BY ip, port'),
    findById: db.prepare<[string], ServerRow>('SELECT * FROM servers WHERE id = ?'),
    upsert: db.prepare(`
      INSERT INTO servers
        (id, ip, port, instance_name, use_windows_auth, username, encrypted_password,
         added_at, last_seen_at, last_metrics_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ip, port) DO UPDATE SET
        instance_name      = excluded.instance_name,
        use_windows_auth   = excluded.use_windows_auth,
        username           = excluded.username,
        encrypted_password = excluded.encrypted_password,
        last_seen_at       = excluded.last_seen_at,
        last_metrics_at    = excluded.last_metrics_at
    `),
    findByIpPort: db.prepare<[string, number], ServerRow>(
      'SELECT * FROM servers WHERE ip = ? AND port = ?'
    ),
    remove: db.prepare<[string]>('DELETE FROM servers WHERE id = ?'),
    updateLastSeen: db.prepare<[string, string]>(
      'UPDATE servers SET last_seen_at = ? WHERE id = ?'
    ),
    updateLastMetrics: db.prepare<[string, string]>(
      'UPDATE servers SET last_metrics_at = ? WHERE id = ?'
    ),
  }
  return _stmts
}

// --- Repository ---

export function findAll(): StoredServer[] {
  const rows = stmts().findAll.all()
  return rows.map(rowToServer)
}

export function findById(id: string): StoredServer | null {
  const row = stmts().findById.get(id)
  return row ? rowToServer(row) : null
}

/**
 * Insert or update based on ip:port (the pair is UNIQUE).
 * If a record with the same ip:port already exists, all fields are updated
 * except id and added_at. Returns the final record.
 */
export function upsert(server: Omit<StoredServer, 'id' | 'addedAt'> & Partial<Pick<StoredServer, 'id' | 'addedAt'>>): StoredServer {
  const id = server.id ?? randomUUID()
  const addedAt = server.addedAt?.toISOString() ?? new Date().toISOString()

  stmts().upsert.run(
    id,
    server.ip,
    server.port,
    server.instanceName ?? null,
    server.useWindowsAuth ? 1 : 0,
    server.username ?? null,
    server.encryptedPassword ?? null,
    addedAt,
    server.lastSeenAt?.toISOString() ?? null,
    server.lastMetricsAt?.toISOString() ?? null
  )

  // Detect the effective id (may be that of the pre-existing record)
  const saved = stmts().findByIpPort.get(server.ip, server.port)

  if (!saved) throw new Error('[serverRepository] upsert failed: row not found after insert')
  return rowToServer(saved)
}

export function remove(id: string): void {
  stmts().remove.run(id)
}

export function updateLastSeen(id: string, date: Date): void {
  stmts().updateLastSeen.run(date.toISOString(), id)
}

export function updateLastMetrics(id: string, date: Date): void {
  stmts().updateLastMetrics.run(date.toISOString(), id)
}
