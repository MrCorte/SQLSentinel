import { getDb } from './database'
import type Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'

// In-memory cache for getAllCustomFields().
// Invalidated on every write so runJob() never reads stale data.
let cachedFields: Record<string, DbCustomFields> | null = null

export interface DbCustomFields {
  alias?: string
  referente?: string
}

interface DbCustomFieldsRow {
  id: string
  alias: string | null
  referente: string | null
}

function rowToFields(row: DbCustomFieldsRow): DbCustomFields {
  return {
    alias: row.alias ?? undefined,
    referente: row.referente ?? undefined
  }
}

// --- Cached prepared statements ---

let _db: Database.Database | null = null
let _stmts: {
  getCustomFields: Statement<[string], DbCustomFieldsRow>
  setCustomFields: Statement<[string, string | null, string | null]>
  getAllCustomFields: Statement<[], DbCustomFieldsRow>
} | null = null

function stmts() {
  const db = getDb()
  if (_stmts && _db === db) return _stmts
  _db = db
  _stmts = {
    getCustomFields: db.prepare<[string], DbCustomFieldsRow>(
      'SELECT * FROM db_custom_fields WHERE id = ?'
    ),
    setCustomFields: db.prepare<[string, string | null, string | null]>(
      'INSERT OR REPLACE INTO db_custom_fields (id, alias, referente) VALUES (?, ?, ?)'
    ),
    getAllCustomFields: db.prepare<[], DbCustomFieldsRow>('SELECT * FROM db_custom_fields')
  }
  return _stmts
}

export function getCustomFields(serverId: string, dbName: string): DbCustomFields {
  const row = stmts().getCustomFields.get(`${serverId}/${dbName}`)
  return row ? rowToFields(row) : {}
}

export function setCustomFields(serverId: string, dbName: string, fields: DbCustomFields): void {
  cachedFields = null // invalidate cache on every write
  stmts().setCustomFields.run(
    `${serverId}/${dbName}`,
    fields.alias ?? null,
    fields.referente ?? null
  )
}

export function getAllCustomFields(): Record<string, DbCustomFields> {
  if (cachedFields !== null) return cachedFields
  const rows = stmts().getAllCustomFields.all()
  const result: Record<string, DbCustomFields> = {}
  for (const row of rows) {
    result[row.id] = rowToFields(row)
  }
  cachedFields = result
  return cachedFields
}
