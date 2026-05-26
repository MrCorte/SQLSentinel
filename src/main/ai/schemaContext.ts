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
    const result = await pool.request().query<{
      schema_name: string
      object_name: string
      object_type: string
      database_name: string
    }>(`
      SELECT TOP (${MAX_OBJECTS})
        s.name      AS schema_name,
        o.name      AS object_name,
        o.type_desc AS object_type,
        DB_NAME()   AS database_name
      FROM sys.objects o
      INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
      LEFT JOIN sys.dm_db_partition_stats ps
        ON ps.object_id = o.object_id AND ps.index_id IN (0, 1)
      WHERE o.type IN ('U','V')
        AND o.is_ms_shipped = 0
      GROUP BY s.name, o.name, o.type_desc
      ORDER BY SUM(ISNULL(ps.used_page_count, 0)) DESC, o.name
    `)
    const rows = result.recordset
    if (rows.length === 0) {
      _cache.set(serverId, { text: '', fetchedAt: Date.now() })
      return ''
    }
    const dbName = rows[0].database_name
    const tables = rows.filter((r) => r.object_type === 'USER_TABLE')
    const views = rows.filter((r) => r.object_type === 'VIEW')
    const lines: string[] = [`Database: ${dbName}`]
    if (tables.length > 0) {
      lines.push(
        `Tables (${tables.length}): ` +
          tables.map((t) => `${t.schema_name}.${t.object_name}`).join(', ')
      )
    }
    if (views.length > 0) {
      lines.push(
        `Views (${views.length}): ` +
          views.map((v) => `${v.schema_name}.${v.object_name}`).join(', ')
      )
    }
    const text = lines.join('\n')
    _cache.set(serverId, { text, fetchedAt: Date.now() })
    log.info(`fetched schema for ${serverId}: ${tables.length} tables, ${views.length} views`)
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
