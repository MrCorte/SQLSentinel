import { getPool } from '../collectors/connectionPool'
import type { ServerConnection } from '../collectors/types'

// Hard limit on rows returned to prevent accidental large result sets in agent context.
const MAX_ROWS = 200

// Validates that the query is read-only before execution.
// Rejects any statement that could modify state.
const WRITE_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE|MERGE|BULK|GRANT|REVOKE|DENY|KILL|DBCC|CHECKPOINT|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN)\b/i

export class ReadOnlyViolation extends Error {
  constructor(keyword: string) {
    super(`Query contains disallowed keyword: ${keyword}`)
    this.name = 'ReadOnlyViolation'
  }
}

export interface QueryRow {
  [column: string]: unknown
}

export async function executeReadOnly(
  conn: ServerConnection,
  sql: string
): Promise<QueryRow[]> {
  const match = sql.match(WRITE_PATTERN)
  if (match) throw new ReadOnlyViolation(match[0])

  const pool = await getPool(conn)
  // SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED avoids blocking the monitored server.
  const wrapped = `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\nSET ROWCOUNT ${MAX_ROWS};\n${sql}`
  const result = await pool.request().query(wrapped)
  return (result.recordset ?? []) as QueryRow[]
}
