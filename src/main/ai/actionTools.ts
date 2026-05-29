import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as repo from '../incidents/repository'

// ---------------------------------------------------------------------------
// Whitelist — only tools listed here can ever be proposed.
// The executor checks this list before running any T-SQL.
// ---------------------------------------------------------------------------

export const ACTION_WHITELIST = new Set(['kill_session', 'update_statistics', 'rebuild_index'])

// ---------------------------------------------------------------------------
// T-SQL preview builders — parameterized with safe literals, no user input.
// The previews are stored in incident_actions.tsql_preview and shown to the
// user BEFORE approval so they know exactly what will run.
// ---------------------------------------------------------------------------

function killSessionSql(sessionId: number): string {
  return `KILL ${sessionId};`
}

// Control chars 0x00-0x1F plus DEL (0x7F). Built via codePoints to avoid
// embedding raw control bytes in the source file. Mirrors dbAdmin.ts.
const CONTROL_CHAR_RE = new RegExp(
  '[' +
    Array.from({ length: 32 }, (_v, i) => '\\x' + i.toString(16).padStart(2, '0')).join('') +
    '\\x7f]'
)

/**
 * Reject identifiers that should never reach the SQL driver. The bracket-escaping
 * below neutralises `]`, but these identifiers originate from the LLM tool call,
 * so we independently validate length / control chars / whitespace before they
 * are concatenated into executable T-SQL (defence-in-depth against a poisoned or
 * confused model emitting a 4000-char or newline-laden name).
 */
function assertSafeIdentifier(value: string, kind: string): void {
  if (value.length === 0 || value.length > 128) {
    throw new Error(`Invalid ${kind}: must be 1-128 chars`)
  }
  if (value !== value.trim()) {
    throw new Error(`Invalid ${kind}: leading/trailing whitespace not allowed`)
  }
  if (CONTROL_CHAR_RE.test(value)) {
    throw new Error(`Invalid ${kind}: control characters not allowed`)
  }
}

function bracketName(name: string): string {
  const dot = name.indexOf('.')
  if (dot === -1) {
    assertSafeIdentifier(name, 'object name')
    return `[${name.replace(/]/g, ']]')}]`
  }
  const schema = name.slice(0, dot)
  const object = name.slice(dot + 1)
  assertSafeIdentifier(schema, 'schema name')
  assertSafeIdentifier(object, 'object name')
  return `[${schema.replace(/]/g, ']]')}].[${object.replace(/]/g, ']]')}]`
}

function updateStatsSql(dbName: string, tableName: string): string {
  assertSafeIdentifier(dbName, 'database name')
  return `USE [${dbName.replace(/]/g, ']]')}];\nUPDATE STATISTICS ${bracketName(tableName)} WITH FULLSCAN;`
}

function rebuildIndexSql(dbName: string, tableName: string, indexName: string): string {
  assertSafeIdentifier(dbName, 'database name')
  assertSafeIdentifier(indexName, 'index name')
  // ONLINE = ON requires Enterprise / Developer Edition — omit to support all editions.
  return [
    `USE [${dbName.replace(/]/g, ']]')}];`,
    `ALTER INDEX [${indexName.replace(/]/g, ']]')}]`,
    `  ON ${bracketName(tableName)}`,
    `  REBUILD;`
  ].join('\n')
}

export function buildActionSqlForExecution(
  toolName: string,
  params: Record<string, unknown>
): string {
  if (toolName === 'kill_session') {
    const sessionId = params['session_id']
    if (!Number.isInteger(sessionId) || (sessionId as number) <= 0) {
      throw new Error('Invalid kill_session params')
    }
    return killSessionSql(sessionId as number)
  }

  if (toolName === 'update_statistics') {
    const dbName = params['db_name']
    const tableName = params['table_name']
    if (typeof dbName !== 'string' || typeof tableName !== 'string') {
      throw new Error('Invalid update_statistics params')
    }
    return updateStatsSql(dbName, tableName)
  }

  if (toolName === 'rebuild_index') {
    const dbName = params['db_name']
    const tableName = params['table_name']
    const indexName = params['index_name']
    if (
      typeof dbName !== 'string' ||
      typeof tableName !== 'string' ||
      typeof indexName !== 'string'
    ) {
      throw new Error('Invalid rebuild_index params')
    }
    return rebuildIndexSql(dbName, tableName, indexName)
  }

  throw new Error(`Unsupported action tool: ${toolName}`)
}

// ---------------------------------------------------------------------------
// Tool factory — scoped to one incident so proposals land in the right row.
// ---------------------------------------------------------------------------

export function buildActionTools(incidentId: string): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'kill_session',
      description:
        'Propose killing a blocking SQL Server session. Use ONLY when get_blocking_sessions confirmed a long-running blocker. The user must approve before the KILL is executed.',
      schema: z.object({
        session_id: z.number().int().positive().describe('SQL Server session_id to kill'),
        reason: z.string().describe('One sentence explaining why this session should be killed')
      }),
      func: async ({ session_id, reason }) => {
        const tsql = buildActionSqlForExecution('kill_session', { session_id })
        const action = await repo.createAction(
          incidentId,
          'kill_session',
          { session_id },
          tsql,
          reason
        )
        await repo.addEvent(incidentId, 'action_proposed', {
          toolName: 'kill_session',
          actionId: action.id,
          session_id
        })
        return JSON.stringify({ proposed: true, actionId: action.id, tsql })
      }
    }),

    new DynamicStructuredTool({
      name: 'update_statistics',
      description:
        'Propose running UPDATE STATISTICS on a table to fix stale statistics causing bad query plans. The user must approve before execution.',
      schema: z.object({
        db_name: z.string().describe('Database name'),
        table_name: z.string().describe('Table name (schema.table or just table)'),
        reason: z.string().describe('One sentence explaining why statistics need updating')
      }),
      func: async ({ db_name, table_name, reason }) => {
        const tsql = buildActionSqlForExecution('update_statistics', { db_name, table_name })
        const action = await repo.createAction(
          incidentId,
          'update_statistics',
          { db_name, table_name },
          tsql,
          reason
        )
        await repo.addEvent(incidentId, 'action_proposed', {
          toolName: 'update_statistics',
          actionId: action.id,
          db_name,
          table_name
        })
        return JSON.stringify({ proposed: true, actionId: action.id, tsql })
      }
    }),

    new DynamicStructuredTool({
      name: 'rebuild_index',
      description:
        'Propose an online index rebuild to fix high fragmentation. Use only when fragmentation was confirmed above 30%. The user must approve before execution.',
      schema: z.object({
        db_name: z.string().describe('Database name'),
        table_name: z.string().describe('Table name owning the index'),
        index_name: z.string().describe('Index name to rebuild'),
        reason: z.string().describe('One sentence justifying the rebuild')
      }),
      func: async ({ db_name, table_name, index_name, reason }) => {
        const tsql = buildActionSqlForExecution('rebuild_index', {
          db_name,
          table_name,
          index_name
        })
        const action = await repo.createAction(
          incidentId,
          'rebuild_index',
          { db_name, table_name, index_name },
          tsql,
          reason
        )
        await repo.addEvent(incidentId, 'action_proposed', {
          toolName: 'rebuild_index',
          actionId: action.id,
          db_name,
          table_name,
          index_name
        })
        return JSON.stringify({ proposed: true, actionId: action.id, tsql })
      }
    })
  ]
}
