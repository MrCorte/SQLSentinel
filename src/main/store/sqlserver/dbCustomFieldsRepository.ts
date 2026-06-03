import * as sql from 'mssql'
import { getPool } from './connection'

export interface DbCustomFields {
  alias?: string
  referente?: string
}

let cachedFields: Record<string, DbCustomFields> | null = null

export async function getCustomFields(serverId: string, dbName: string): Promise<DbCustomFields> {
  const pool = getPool()
  const result = await pool
    .request()
    .input('id', sql.NVarChar(400), `${serverId}/${dbName}`)
    .query<{ id: string; alias: string | null; referente: string | null }>(
      `SELECT id, alias, referente FROM dbo.db_custom_fields WHERE id = @id`
    )
  const row = result.recordset[0]
  if (!row) return {}
  return { alias: row.alias ?? undefined, referente: row.referente ?? undefined }
}

export async function setCustomFields(
  serverId: string,
  dbName: string,
  fields: DbCustomFields
): Promise<void> {
  const key = `${serverId}/${dbName}`
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(400), key)
    .input('alias', sql.NVarChar(200), fields.alias ?? null)
    .input('referente', sql.NVarChar(200), fields.referente ?? null)
    .query(`MERGE dbo.db_custom_fields AS t
            USING (SELECT @id AS id, @alias AS alias, @referente AS referente) AS s ON t.id = s.id
            WHEN MATCHED THEN UPDATE SET t.alias = s.alias, t.referente = s.referente
            WHEN NOT MATCHED THEN INSERT (id, alias, referente) VALUES (s.id, s.alias, s.referente);`)
  // Update cache in-place instead of invalidating the whole cache
  if (cachedFields !== null) {
    cachedFields[key] = fields
  }
}

/**
 * Drop all cached entries whose key starts with `${serverId}/`.
 * Called when a server is removed so stale aliases don't accumulate forever.
 */
export function invalidateCustomFieldsForServer(serverId: string): void {
  if (cachedFields === null) return
  const prefix = `${serverId}/`
  for (const key of Object.keys(cachedFields)) {
    if (key.startsWith(prefix)) delete cachedFields[key]
  }
}

export async function getAllCustomFields(): Promise<Record<string, DbCustomFields>> {
  if (cachedFields !== null) return cachedFields
  const pool = getPool()
  const result = await pool
    .request()
    .query<{ id: string; alias: string | null; referente: string | null }>(
      `SELECT id, alias, referente FROM dbo.db_custom_fields`
    )
  const out: Record<string, DbCustomFields> = {}
  for (const row of result.recordset) {
    out[row.id] = { alias: row.alias ?? undefined, referente: row.referente ?? undefined }
  }
  cachedFields = out
  return out
}
