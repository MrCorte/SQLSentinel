import { getDb } from './database'

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

export function getCustomFields(serverId: string, dbName: string): DbCustomFields {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM db_custom_fields WHERE id = ?')
    .get(`${serverId}/${dbName}`) as DbCustomFieldsRow | undefined
  return row ? rowToFields(row) : {}
}

export function setCustomFields(serverId: string, dbName: string, fields: DbCustomFields): void {
  const db = getDb()
  db.prepare(
    'INSERT OR REPLACE INTO db_custom_fields (id, alias, referente) VALUES (?, ?, ?)'
  ).run(`${serverId}/${dbName}`, fields.alias ?? null, fields.referente ?? null)
}

export function getAllCustomFields(): Record<string, DbCustomFields> {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM db_custom_fields').all() as DbCustomFieldsRow[]
  const result: Record<string, DbCustomFields> = {}
  for (const row of rows) {
    result[row.id] = rowToFields(row)
  }
  return result
}
