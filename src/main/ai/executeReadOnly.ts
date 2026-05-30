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
// INTO is included so `SELECT … INTO new_table` (which creates a table — a write)
// is rejected; for SELECT-only input INTO appears only in SELECT…INTO / OUTPUT…INTO,
// both writes. `\bINTO\b` does not match identifiers like `loaded_into_cache`.
const WRITE_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE|MERGE|BULK|GRANT|REVOKE|DENY|KILL|DBCC|CHECKPOINT|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|OPENROWSET|OPENQUERY|OPENDATASOURCE|WAITFOR|INTO|xp_cmdshell|sp_configure|sp_executesql)\b/i

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
  // SET ROWCOUNT is a best-effort wire-transfer limit; it is deprecated as a row
  // limiter (ignored with TOP, slated for removal), so the JS slice below — not
  // SET ROWCOUNT — is the authoritative cap. recordset is the FIRST result set only;
  // slicing also bounds what we surface even if the model emitted a multi-statement batch.
  const wrapped = `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\nSET ROWCOUNT ${MAX_ROWS};\n${sql}`
  const result = await pool.request().query(wrapped)
  const rows = (result.recordset ?? []) as QueryRow[]
  return rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows
}
