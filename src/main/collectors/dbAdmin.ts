import * as mssql from 'mssql'
import type { CollectMetricsRequest } from '../ipc/types'
import type { ShrinkEstimate, ShrinkResult } from '../ipc/types'
import { sanitizeSqlError } from './sqlCollector'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bracket-escape a SQL identifier (database/file name). */
function bracketEscape(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}


function buildConfig(conn: CollectMetricsRequest, dbName: string): mssql.config {
  const base: mssql.config = {
    server: conn.ip,
    port: conn.port,
    database: dbName,
    requestTimeout: 300_000, // 5 min — DBCC can be slow
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 15_000
    }
  }

  if (conn.useWindowsAuth) {
    return {
      ...base,
      authentication: {
        type: 'ntlm',
        options: { domain: '', userName: '', password: '' }
      }
    }
  }

  return {
    ...base,
    authentication: {
      type: 'default',
      options: {
        userName: conn.username ?? '',
        password: conn.password ?? ''
      }
    }
  }
}

// ---------------------------------------------------------------------------
// getShrinkEstimate
// ---------------------------------------------------------------------------

export async function getShrinkEstimate(
  conn: CollectMetricsRequest,
  dbName: string
): Promise<ShrinkEstimate[]> {
  const config = buildConfig(conn, dbName)
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(config)
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
  const t0 = Date.now()
  const safePercent = Math.floor(Math.max(0, Math.min(99, targetPercent)))
  const config = buildConfig(conn, dbName)
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(config)
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
  const t0 = Date.now()
  const config = buildConfig(conn, dbName)
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(config)

    if (isLog) {
      // Check recovery model — only backup log if FULL recovery
      const rmRow = await pool
        .request()
        .input('dbName', mssql.NVarChar, dbName)
        .query<{ recovery_model_desc: string }>(
          `SELECT recovery_model_desc FROM sys.databases WHERE name = @dbName`
        )
      if (rmRow.recordset[0]?.recovery_model_desc === 'FULL') {
        await pool
          .request()
          .query(`BACKUP LOG ${bracketEscape(dbName)} TO DISK = N'NUL'`)
      }
    }

    // Measure before
    const beforeRow = await pool
      .request()
      .input('fn', mssql.NVarChar, fileName)
      .query<{ size_mb: number }>(
        `SELECT CAST(size * 8.0 / 1024 AS INT) AS size_mb FROM sys.database_files WHERE name = @fn`
      )
    const beforeMb = beforeRow.recordset[0]?.size_mb ?? 0

    const safeSizeMb = Math.max(0, Math.floor(targetSizeMb))
    const safeFileId = `[${fileName.replace(/]/g, ']]')}]`
    await pool.request().query(`DBCC SHRINKFILE (${safeFileId}, ${safeSizeMb})`)

    // Measure after
    const afterRow = await pool
      .request()
      .input('fn', mssql.NVarChar, fileName)
      .query<{ size_mb: number }>(
        `SELECT CAST(size * 8.0 / 1024 AS INT) AS size_mb FROM sys.database_files WHERE name = @fn`
      )
    const afterMb = afterRow.recordset[0]?.size_mb ?? 0

    return {
      success: true,
      duration_ms: Date.now() - t0,
      newSizeMb: afterMb,
      reclaimedMb: Math.max(0, beforeMb - afterMb)
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
