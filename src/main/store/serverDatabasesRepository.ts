import { getDb } from './database'
import type { DatabaseInfo } from '../collectors/types'
import type Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'

interface DbRow {
  server_id: string
  name: string
  state_desc: string
  recovery_model: string
  size_mb: number
  log_size_mb: number
  compat_level: number
  is_encrypted: number
  is_read_only: number
  owner: string
  create_date: string
  last_seen: number
}

type UpsertParams = [
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  string,
  string,
  number
]

let _db: Database.Database | null = null
let _stmts: {
  upsert: Statement<UpsertParams>
  deleteByName: Statement<[string, string]>
  getAll: Statement<[], DbRow>
} | null = null

function stmts() {
  const db = getDb()
  if (_stmts && _db === db) return _stmts
  _db = db
  _stmts = {
    upsert: db.prepare<UpsertParams>(`
      INSERT OR REPLACE INTO server_databases
        (server_id, name, state_desc, recovery_model, size_mb, log_size_mb,
         compat_level, is_encrypted, is_read_only, owner, create_date, last_seen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `),
    deleteByName: db.prepare<[string, string]>(
      'DELETE FROM server_databases WHERE server_id = ? AND name = ?'
    ),
    getAll: db.prepare<[], DbRow>(
      'SELECT * FROM server_databases ORDER BY server_id, name'
    )
  }
  return _stmts
}

function toRow(serverId: string, db: DatabaseInfo): UpsertParams {
  return [
    serverId,
    db.name,
    db.stateDesc ?? 'ONLINE',
    db.recoveryModel ?? 'SIMPLE',
    db.sizeMb ?? 0,
    db.logSizeMb ?? 0,
    db.compatibilityLevel ?? 150,
    db.isEncrypted ? 1 : 0,
    db.isReadOnly ? 1 : 0,
    db.owner ?? '',
    db.createDate ?? '',
    Math.floor(Date.now() / 1000)
  ]
}

function fromRow(row: DbRow): DatabaseInfo {
  return {
    name: row.name,
    stateDesc: row.state_desc,
    recoveryModel: row.recovery_model,
    sizeMb: row.size_mb,
    logSizeMb: row.log_size_mb,
    compatibilityLevel: row.compat_level,
    isEncrypted: row.is_encrypted === 1,
    isReadOnly: row.is_read_only === 1,
    owner: row.owner,
    createDate: row.create_date || undefined
  }
}

/**
 * Upsert a list of databases for a server. Existing rows are updated;
 * new rows are inserted. Call deleteByNames() separately for removed databases.
 */
export function upsertDatabases(serverId: string, databases: DatabaseInfo[]): void {
  if (databases.length === 0) return
  const { upsert } = stmts()
  const insertMany = getDb().transaction((rows: DatabaseInfo[]) => {
    for (const db of rows) {
      upsert.run(...toRow(serverId, db))
    }
  })
  insertMany(databases)
}

/**
 * Delete specific databases by name for a server (used when databases are dropped).
 */
export function deleteByNames(serverId: string, names: string[]): void {
  if (names.length === 0) return
  const { deleteByName } = stmts()
  const deleteMany = getDb().transaction((ns: string[]) => {
    for (const name of ns) deleteByName.run(serverId, name)
  })
  deleteMany(names)
}

/**
 * Delete any databases for a server whose name is not in the current live set.
 * Called after a full snapshot to remove stale entries.
 */
export function deleteStale(serverId: string, currentNames: string[]): void {
  const db = getDb()
  if (currentNames.length === 0) {
    db.prepare('DELETE FROM server_databases WHERE server_id = ?').run(serverId)
    return
  }
  const placeholders = currentNames.map(() => '?').join(',')
  db.prepare(`DELETE FROM server_databases WHERE server_id = ? AND name NOT IN (${placeholders})`)
    .run(serverId, ...currentNames)
}

/**
 * Returns all persisted databases grouped by server_id.
 * Used at app startup to pre-seed metricsMap before the worker's first poll.
 */
export function getAllGroupedByServer(): Record<string, DatabaseInfo[]> {
  const rows = stmts().getAll.all()
  const result: Record<string, DatabaseInfo[]> = {}
  for (const row of rows) {
    if (!result[row.server_id]) result[row.server_id] = []
    result[row.server_id]!.push(fromRow(row))
  }
  return result
}
