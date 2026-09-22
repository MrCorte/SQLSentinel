import * as sql from 'mssql'
import { getPool } from './connection'
import type { DatabaseInfo } from '../../collectors/types'

interface DbRow {
  server_id: string
  name: string
  state_desc: string
  recovery_model: string
  size_mb: number
  log_size_mb: number
  compat_level: number
  is_encrypted: boolean | number
  is_read_only: boolean | number
  owner: string
  create_date: string
  last_seen: number | string
}

function fromRow(row: DbRow): DatabaseInfo {
  return {
    name: row.name,
    stateDesc: row.state_desc,
    recoveryModel: row.recovery_model,
    sizeMb: row.size_mb,
    logSizeMb: row.log_size_mb,
    compatibilityLevel: row.compat_level,
    isEncrypted: row.is_encrypted === true || row.is_encrypted === 1,
    isReadOnly: row.is_read_only === true || row.is_read_only === 1,
    owner: row.owner,
    createDate: row.create_date || undefined
  }
}

// Each row binds 12 params, so 150 rows = 1800 params — comfortably under
// the 2100 cap with margin for the constant params (none here, but kept
// for symmetry with future schema changes).
const UPSERT_CHUNK_SIZE = 150

/**
 * Upsert a list of databases for a server in batched MERGEs (one round-trip
 * per chunk). With 200 servers × ~50 DBs/server, an N-MERGE-in-tx implementation
 * would issue 10000 round-trips per polling cycle — this batched version
 * drops the worker-side I/O cost by ~2 orders of magnitude.
 */
export async function upsertDatabases(
  serverId: string,
  databases: DatabaseInfo[],
  // Watermark last_seen condiviso: syncFullSnapshot lo passa esplicito per poter
  // poi eliminare in un colpo solo le righe non toccate da questo upsert.
  now: number = Math.floor(Date.now() / 1000)
): Promise<void> {
  if (databases.length === 0) return
  const pool = getPool()
  for (let off = 0; off < databases.length; off += UPSERT_CHUNK_SIZE) {
    const chunk = databases.slice(off, off + UPSERT_CHUNK_SIZE)
    const req = pool.request().input('server_id', sql.NVarChar(36), serverId)
    const tuples: string[] = []
    for (let i = 0; i < chunk.length; i++) {
      const db = chunk[i]
      req.input(`name${i}`, sql.NVarChar(200), db.name)
      req.input(`state${i}`, sql.NVarChar(50), db.stateDesc ?? 'ONLINE')
      req.input(`rec${i}`, sql.NVarChar(20), db.recoveryModel ?? 'SIMPLE')
      req.input(`size${i}`, sql.Float, db.sizeMb ?? 0)
      req.input(`logsize${i}`, sql.Float, db.logSizeMb ?? 0)
      req.input(`compat${i}`, sql.Int, db.compatibilityLevel ?? 150)
      req.input(`enc${i}`, sql.Bit, db.isEncrypted ? 1 : 0)
      req.input(`ro${i}`, sql.Bit, db.isReadOnly ? 1 : 0)
      req.input(`owner${i}`, sql.NVarChar(200), db.owner ?? '')
      req.input(`created${i}`, sql.NVarChar(50), db.createDate ?? '')
      req.input(`seen${i}`, sql.BigInt, now)
      tuples.push(
        `(@server_id, @name${i}, @state${i}, @rec${i}, @size${i}, @logsize${i}, @compat${i}, @enc${i}, @ro${i}, @owner${i}, @created${i}, @seen${i})`
      )
    }
    await req.query(`
      MERGE dbo.server_databases AS t
      USING (VALUES ${tuples.join(', ')})
        AS s (server_id, name, state_desc, recovery_model, size_mb, log_size_mb,
              compat_level, is_encrypted, is_read_only, owner, create_date, last_seen)
        ON t.server_id = s.server_id AND t.name = s.name
      WHEN MATCHED THEN UPDATE SET
        state_desc = s.state_desc,
        recovery_model = s.recovery_model,
        size_mb = s.size_mb,
        log_size_mb = s.log_size_mb,
        compat_level = s.compat_level,
        is_encrypted = s.is_encrypted,
        is_read_only = s.is_read_only,
        owner = s.owner,
        create_date = s.create_date,
        last_seen = s.last_seen
      WHEN NOT MATCHED THEN INSERT
        (server_id, name, state_desc, recovery_model, size_mb, log_size_mb,
         compat_level, is_encrypted, is_read_only, owner, create_date, last_seen)
        VALUES (s.server_id, s.name, s.state_desc, s.recovery_model, s.size_mb, s.log_size_mb,
                s.compat_level, s.is_encrypted, s.is_read_only, s.owner, s.create_date, s.last_seen);
    `)
  }
}

// Each placeholder is one parameter; +1 for @server_id. Keep well under the
// 2100-parameter cap so a consolidated instance with thousands of DBs can't
// blow the statement.
const DELETE_CHUNK_SIZE = 2000

/** Delete specific databases by name for a server (used when databases are dropped). */
export async function deleteByNames(serverId: string, names: string[]): Promise<void> {
  if (names.length === 0) return
  for (let off = 0; off < names.length; off += DELETE_CHUNK_SIZE) {
    const chunk = names.slice(off, off + DELETE_CHUNK_SIZE)
    const req = getPool().request()
    req.input('server_id', sql.NVarChar(36), serverId)
    const placeholders = chunk.map((n, i) => {
      const key = `n${i}`
      req.input(key, sql.NVarChar(200), n)
      return `@${key}`
    })
    await req.query(
      `DELETE FROM dbo.server_databases WHERE server_id = @server_id AND name IN (${placeholders.join(',')})`
    )
  }
}

/**
 * Sincronizza l'intera lista DB di un server da uno snapshot completo: upsert di
 * tutti i DB correnti + rimozione di quelli spariti, condividendo un unico
 * watermark `last_seen`.
 *
 * Il vecchio deleteStale faceva SELECT di tutti i nomi esistenti + diff in JS +
 * deleteByNames (una query di LETTURA extra per server ad ogni snapshot nel hot
 * path di polling). Qui l'upsert marca ogni DB corrente con `last_seen = now`,
 * quindi una singola DELETE parametrizzata rimuove le righe con `last_seen < now`
 * — i DB non più presenti — senza round-trip di lettura né rischi di chunking
 * di un NOT IN.
 */
export async function syncFullSnapshot(serverId: string, databases: DatabaseInfo[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await upsertDatabases(serverId, databases, now)
  await getPool()
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('cutoff', sql.BigInt, now)
    .query(`DELETE FROM dbo.server_databases WHERE server_id = @server_id AND last_seen < @cutoff`)
}

/**
 * Returns all persisted databases grouped by server_id. Used at app startup to
 * pre-seed metricsMap before the worker's first poll.
 */
export async function getAllGroupedByServer(): Promise<Record<string, DatabaseInfo[]>> {
  const r = await getPool()
    .request()
    .query<DbRow>(
      `SELECT server_id, name, state_desc, recovery_model, size_mb, log_size_mb,
              compat_level, is_encrypted, is_read_only, owner, create_date, last_seen
       FROM dbo.server_databases
       ORDER BY server_id, name`
    )
  const result: Record<string, DatabaseInfo[]> = {}
  for (const row of r.recordset) {
    if (!result[row.server_id]) result[row.server_id] = []
    result[row.server_id]!.push(fromRow(row))
  }
  return result
}
