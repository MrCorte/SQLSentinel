import * as mssql from 'mssql'
import type { CollectMetricsRequest } from '../ipc/types'
import type { ShrinkEstimate, ShrinkResult } from '../ipc/types'
import { sanitizeSqlError } from './sqlCollector'
import { buildAuthentication } from './connectionPool'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bracket-escape a SQL identifier (database/file name). */
function bracketEscape(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}

/**
 * Reject identifiers that should never reach the SQL driver — control chars,
 * NUL bytes, leading/trailing whitespace, length over the SQL Server cap, or
 * non-string input. Bracket-escape neutralises ] but a malformed name still
 * surfaces ugly errors and gets logged via sanitizeSqlError; refusing early
 * is cleaner.
 */
// Control chars 0x00-0x1F plus DEL (0x7F). Built via codePoints to avoid
// embedding raw control bytes in the source file.
const CONTROL_CHAR_RE = new RegExp(
  '[' +
    Array.from({ length: 32 }, (_v, i) => '\\x' + i.toString(16).padStart(2, '0')).join('') +
    '\\x7f]'
)

function assertSafeDbIdentifier(
  value: unknown,
  kind: 'database' | 'file'
): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${kind} name: expected string`)
  }
  if (value.length === 0 || value.length > 128) {
    throw new Error(`Invalid ${kind} name: must be 1-128 chars`)
  }
  if (value !== value.trim()) {
    throw new Error(`Invalid ${kind} name: leading/trailing whitespace not allowed`)
  }
  if (CONTROL_CHAR_RE.test(value)) {
    throw new Error(`Invalid ${kind} name: control characters not allowed`)
  }
}

function buildConfig(conn: CollectMetricsRequest, dbName: string): mssql.config {
  return {
    server: conn.ip,
    port: conn.port,
    database: dbName,
    requestTimeout: 300_000, // 5 min — DBCC can be slow
    options: {
      // Default to encrypted TDS — see sqlCollector.buildConfig for rationale.
      encrypt: conn.encrypt ?? true,
      trustServerCertificate: conn.trustServerCertificate ?? true,
      connectTimeout: 15_000
    },
    // NTLM credential derivation shared with the pooled path (see connectionPool).
    authentication: buildAuthentication(conn)
  }
}

// ---------------------------------------------------------------------------
// getShrinkEstimate
// ---------------------------------------------------------------------------

export async function getShrinkEstimate(
  conn: CollectMetricsRequest,
  dbName: string
): Promise<ShrinkEstimate[]> {
  assertSafeDbIdentifier(dbName, 'database')
  const config = buildConfig(conn, dbName)
  let pool: mssql.ConnectionPool | null = null
  try {
    // Dedicated pool — mssql.connect() reuses the global pool (config ignored),
    // which after storage init would target the storage DB instead of dbName.
    pool = await new mssql.ConnectionPool(config).connect()
    const result = await pool.request().query<ShrinkEstimate>(`
      SELECT
        name                                                           AS file_name,
        CAST(size * 8.0 / 1024 AS INT)                                AS current_mb,
        CAST(FILEPROPERTY(name, 'SpaceUsed') * 8.0 / 1024 AS INT)    AS used_mb,
        CAST((size - FILEPROPERTY(name, 'SpaceUsed')) * 8.0 / 1024 AS INT) AS reclaimable_mb
      FROM sys.database_files
    `)
    return result.recordset
  } finally {
    await pool?.close()
  }
}

// ---------------------------------------------------------------------------
// shrinkDatabase
// ---------------------------------------------------------------------------

export async function shrinkDatabase(
  conn: CollectMetricsRequest,
  dbName: string,
  targetPercent: number
): Promise<ShrinkResult> {
  assertSafeDbIdentifier(dbName, 'database')
  const t0 = Date.now()
  const safePercent = Math.floor(Math.max(0, Math.min(99, targetPercent)))
  const config = buildConfig(conn, dbName)
  let pool: mssql.ConnectionPool | null = null
  try {
    // Dedicated pool — with mssql.connect() the global pool's current database
    // could be the storage DB, and DBCC SHRINKDATABASE (0, …) would shrink THAT.
    pool = await new mssql.ConnectionPool(config).connect()
    // Use 0 (current database) — safe since we connected with initial catalog = dbName
    await pool.request().query(`DBCC SHRINKDATABASE (0, ${safePercent})`)
    return { success: true, duration_ms: Date.now() - t0 }
  } catch (err) {
    return {
      success: false,
      duration_ms: Date.now() - t0,
      error: sanitizeSqlError(err)
    }
  } finally {
    await pool?.close()
  }
}

// ---------------------------------------------------------------------------
// shrinkFile
// ---------------------------------------------------------------------------

export async function shrinkFile(
  conn: CollectMetricsRequest,
  dbName: string,
  fileName: string,
  targetSizeMb: number,
  isLog: boolean
): Promise<ShrinkResult> {
  assertSafeDbIdentifier(dbName, 'database')
  assertSafeDbIdentifier(fileName, 'file')
  const t0 = Date.now()
  const config = buildConfig(conn, dbName)
  let pool: mssql.ConnectionPool | null = null
  try {
    // Dedicated pool — see shrinkDatabase: the global pool would point at the
    // storage DB and the BACKUP LOG / SHRINKFILE below would hit the wrong server.
    pool = await new mssql.ConnectionPool(config).connect()

    let warning: string | undefined
    if (isLog) {
      // Check recovery model — only backup log if FULL recovery
      const rmRow = await pool.request().input('dbName', mssql.NVarChar, dbName).query<{
        recovery_model_desc: string
      }>(`SELECT recovery_model_desc FROM sys.databases WHERE name = @dbName`)
      if (rmRow.recordset[0]?.recovery_model_desc === 'FULL') {
        // BACKUP LOG TO NUL discards the log backup — this BREAKS the log backup
        // chain, so point-in-time restore is impossible until the next FULL
        // backup. Surface it to the operator rather than doing it silently.
        await pool.request().query(`BACKUP LOG ${bracketEscape(dbName)} TO DISK = N'NUL'`)
        warning =
          'Log backup chain broken: the transaction log was discarded (BACKUP LOG TO NUL) to enable the shrink. ' +
          'Take a new FULL backup now — point-in-time restore is unavailable until you do.'
      }
    }

    // Measure before
    const beforeRow = await pool.request().input('fn', mssql.NVarChar, fileName).query<{
      size_mb: number
    }>(`SELECT CAST(size * 8.0 / 1024 AS INT) AS size_mb FROM sys.database_files WHERE name = @fn`)
    const beforeMb = beforeRow.recordset[0]?.size_mb ?? 0

    const safeSizeMb = Math.max(0, Math.floor(targetSizeMb))
    const safeFileId = `[${fileName.replace(/]/g, ']]')}]`
    await pool.request().query(`DBCC SHRINKFILE (${safeFileId}, ${safeSizeMb})`)

    // Measure after
    const afterRow = await pool.request().input('fn', mssql.NVarChar, fileName).query<{
      size_mb: number
    }>(`SELECT CAST(size * 8.0 / 1024 AS INT) AS size_mb FROM sys.database_files WHERE name = @fn`)
    const afterMb = afterRow.recordset[0]?.size_mb ?? 0

    return {
      success: true,
      duration_ms: Date.now() - t0,
      newSizeMb: afterMb,
      reclaimedMb: Math.max(0, beforeMb - afterMb),
      warning
    }
  } catch (err) {
    return {
      success: false,
      duration_ms: Date.now() - t0,
      error: sanitizeSqlError(err)
    }
  } finally {
    await pool?.close()
  }
}
