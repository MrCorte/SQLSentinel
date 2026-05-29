import { getPool } from '../collectors/connectionPool'
import type { ServerConnection } from '../collectors/types'

// Hard limit on rows returned to prevent accidental large result sets in agent context.
const MAX_ROWS = 200

// Validates that the query is read-only before execution.
// Rejects any statement that could modify state or reach outside the server.
// NOTE: this is a denylist backstop, not the primary control. The primary
// control is that every caller passes a hardcoded SQL constant AND the login
// used by getPool() should be least-privilege (db_datareader + VIEW SERVER
// STATE). Never pass dynamic/user-supplied SQL through this function.
const WRITE_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE|MERGE|BULK|GRANT|REVOKE|DENY|KILL|DBCC|CHECKPOINT|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|OPENROWSET|OPENQUERY|OPENDATASOURCE|WAITFOR|xp_cmdshell|sp_configure|sp_executesql)\b/i

// SECURITY: strip SQL comments before regex check — comment text must not mask or
// falsely trigger the write keyword pattern. Sound only because all callers pass
// literal SQL constants; never pass dynamic/user-supplied SQL through this function.
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ')
}

export class ReadOnlyViolation extends Error {
  constructor(keyword: string) {
    super(`Query contains disallowed keyword: ${keyword}`)
    this.name = 'ReadOnlyViolation'
  }
}

export interface QueryRow {
  [column: string]: unknown
}

export async function executeReadOnly(conn: ServerConnection, sql: string): Promise<QueryRow[]> {
  const match = stripSqlComments(sql).match(WRITE_PATTERN)
  if (match) throw new ReadOnlyViolation(match[0])

  const pool = await getPool(conn)
  // SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED avoids blocking the monitored server.
  const wrapped = `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\nSET ROWCOUNT ${MAX_ROWS};\n${sql}`
  const result = await pool.request().query(wrapped)
  return (result.recordset ?? []) as QueryRow[]
}
