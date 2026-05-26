import { createLogger } from '../utils/logger'
import { getPool, invalidatePool } from '../collectors/connectionPool'
import { getById } from '../store/serverStore'
import type { ServerConnection } from '../collectors/types'

const log = createLogger('schemaContext')

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_OBJECTS = 100

interface SchemaEntry {
  text: string // formatted block ready for injection
  fetchedAt: number
}

const _cache = new Map<string, SchemaEntry>()

function asServerConnection(s: ReturnType<typeof getById>): ServerConnection | null {
  if (!s) return null
  const ip = s.host ?? s.ip
  if (!ip) return null
  return {
    ip,
    port: s.port,
    instanceName: s.instanceName,
    useWindowsAuth: s.useWindowsAuth,
    username: s.username,
    password: s.password
  }
}

/**
 * Fetches a compact list of tables and views from the target SQL Server.
 * Cached per-server for 10 minutes — schema rarely changes within a session.
 * Result is ~100 most-used (by total_pages) objects, formatted for prompt
 * injection.
 */
export async function getTargetSchemaBlock(serverId: string): Promise<string | null> {
  const cached = _cache.get(serverId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.text
  }

  const stored = getById(serverId)
  const sc = asServerConnection(stored)
  if (!sc) {
    log.warn(`serverId=${serverId} not found in store`)
    return null
  }

  try {
    const pool = await getPool(sc)
    // sys.objects is per-current-database; the pool defaults to master where
    // is_ms_shipped=0 returns nothing useful. We enumerate user DBs first and
    // run a USE-prefixed query per database via sys.master_files joins.
    // Single round-trip via dynamic SQL: build a UNION ALL across user DBs.
    const dbList = await pool.request().query<{ name: string }>(`
      SELECT name FROM sys.databases
      WHERE database_id > 4
        AND state_desc = 'ONLINE'
        AND HAS_DBACCESS(name) = 1
      ORDER BY name
    `)
    const dbNames = dbList.recordset.map((r) => r.name)
    if (dbNames.length === 0) {
      _cache.set(serverId, { text: '', fetchedAt: Date.now() })
      return ''
    }

    // Build a UNION ALL across each user DB. Database names from sys.databases
    // are safe to bracket-quote (they cannot contain `]` without `]]` escape
    // which we guard against to be safe).
    const safeNames = dbNames.filter((n) => !n.includes(']'))
    const unionSql = safeNames
      .map(
        (db) => `
        SELECT '${db.replace(/'/g, "''")}' AS database_name,
               s.name AS schema_name,
               o.name AS object_name,
               o.type_desc AS object_type,
               SUM(ISNULL(ps.used_page_count, 0)) AS pages
        FROM [${db}].sys.objects o
        INNER JOIN [${db}].sys.schemas s ON s.schema_id = o.schema_id
        LEFT JOIN [${db}].sys.dm_db_partition_stats ps
          ON ps.object_id = o.object_id AND ps.index_id IN (0, 1)
        WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0
        GROUP BY s.name, o.name, o.type_desc`
      )
      .join('\nUNION ALL')

    const result = await pool.request().query<{
      database_name: string
      schema_name: string
      object_name: string
      object_type: string
      pages: number
    }>(`SELECT TOP (${MAX_OBJECTS}) database_name, schema_name, object_name, object_type, pages
        FROM (${unionSql}) AS x
        ORDER BY pages DESC, database_name, object_name`)
    const rows = result.recordset
    if (rows.length === 0) {
      _cache.set(serverId, { text: '', fetchedAt: Date.now() })
      return ''
    }

    // Group by database for readability
    type Row = (typeof rows)[number]
    const byDb = new Map<string, Row[]>()
    for (const r of rows) {
      const arr = byDb.get(r.database_name) ?? []
      arr.push(r)
      byDb.set(r.database_name, arr)
    }
    const lines: string[] = []
    for (const [db, objs] of byDb) {
      const tables = objs.filter((o) => o.object_type === 'USER_TABLE')
      const views = objs.filter((o) => o.object_type === 'VIEW')
      const parts: string[] = [`[${db}]`]
      if (tables.length > 0) {
        parts.push(
          `  tables: ` + tables.map((t) => `${t.schema_name}.${t.object_name}`).join(', ')
        )
      }
      if (views.length > 0) {
        parts.push(`  views: ` + views.map((v) => `${v.schema_name}.${v.object_name}`).join(', '))
      }
      lines.push(parts.join('\n'))
    }
    const text = lines.join('\n')
    _cache.set(serverId, { text, fetchedAt: Date.now() })
    log.info(
      `fetched schema for ${serverId}: ${rows.length} objects across ${byDb.size} DBs`
    )
    return text
  } catch (err) {
    invalidatePool(sc)
    log.warn(
      `failed to fetch schema for ${serverId}: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

export function invalidateSchemaCache(serverId?: string): void {
  if (serverId) _cache.delete(serverId)
  else _cache.clear()
}
