import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as repo from '../incidents/repository'
import type { ActionSource, IncidentAction } from '../incidents/types'

// ---------------------------------------------------------------------------
// Whitelist — only tools listed here can ever be proposed.
// The executor checks this list before running any T-SQL.
// ---------------------------------------------------------------------------

export const ACTION_WHITELIST = new Set([
  'kill_session',
  'update_statistics',
  'update_statistics_db',
  'rebuild_index',
  'reorganize_index',
  'clear_plan_cache',
  'set_maxdop'
])

// ---------------------------------------------------------------------------
// Destructive actions — require a typed confirmation in the UI and a matching
// server-side confirmation token before they can be approved. The set is the
// single source of truth shared by the renderer and the execution handler.
// ---------------------------------------------------------------------------

export const DESTRUCTIVE_ACTIONS = new Set([
  'kill_session',
  'rebuild_index',
  'clear_plan_cache',
  'set_maxdop'
])

export function isDestructiveAction(toolName: string): boolean {
  return DESTRUCTIVE_ACTIONS.has(toolName)
}

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

/** Escape a string for use inside a T-SQL N'...' literal. */
function quoteLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function updateStatsSql(dbName: string, tableName: string): string {
  assertSafeIdentifier(dbName, 'database name')
  return `USE [${dbName.replace(/]/g, ']]')}];\nUPDATE STATISTICS ${bracketName(tableName)} WITH FULLSCAN;`
}

function updateStatsDbSql(dbName: string): string {
  assertSafeIdentifier(dbName, 'database name')
  return `USE [${dbName.replace(/]/g, ']]')}];\nEXEC sp_updatestats;`
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

function reorganizeIndexSql(dbName: string, tableName: string, indexName: string): string {
  assertSafeIdentifier(dbName, 'database name')
  assertSafeIdentifier(indexName, 'index name')
  // REORGANIZE is always online and minimally logged — safe on all editions.
  return [
    `USE [${dbName.replace(/]/g, ']]')}];`,
    `ALTER INDEX [${indexName.replace(/]/g, ']]')}]`,
    `  ON ${bracketName(tableName)}`,
    `  REORGANIZE;`
  ].join('\n')
}

function clearPlanCacheSql(dbName: string): string {
  assertSafeIdentifier(dbName, 'database name')
  // Scope the flush to a single database via DBCC FLUSHPROCINDB, which takes a
  // dbid — resolve it from the (validated, quote-escaped) name at run time.
  return [
    `DECLARE @dbid INT = DB_ID(N'${quoteLiteral(dbName)}');`,
    `IF @dbid IS NULL`,
    `  RAISERROR('Database not found for plan cache flush', 16, 1);`,
    `ELSE`,
    `  DBCC FLUSHPROCINDB(@dbid);`
  ].join('\n')
}

function setMaxdopSql(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 64) {
    throw new Error('Invalid maxdop: must be an integer between 0 and 64')
  }
  // value is a validated integer — safe to inline.
  return [
    `EXEC sp_configure 'show advanced options', 1;`,
    `RECONFIGURE;`,
    `EXEC sp_configure 'max degree of parallelism', ${value};`,
    `RECONFIGURE;`
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

  if (toolName === 'update_statistics_db') {
    const dbName = params['db_name']
    if (typeof dbName !== 'string') {
      throw new Error('Invalid update_statistics_db params')
    }
    return updateStatsDbSql(dbName)
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

  if (toolName === 'reorganize_index') {
    const dbName = params['db_name']
    const tableName = params['table_name']
    const indexName = params['index_name']
    if (
      typeof dbName !== 'string' ||
      typeof tableName !== 'string' ||
      typeof indexName !== 'string'
    ) {
      throw new Error('Invalid reorganize_index params')
    }
    return reorganizeIndexSql(dbName, tableName, indexName)
  }

  if (toolName === 'clear_plan_cache') {
    const dbName = params['db_name']
    if (typeof dbName !== 'string') {
      throw new Error('Invalid clear_plan_cache params')
    }
    return clearPlanCacheSql(dbName)
  }

  if (toolName === 'set_maxdop') {
    const value = params['value']
    if (!Number.isInteger(value)) {
      throw new Error('Invalid set_maxdop params')
    }
    return setMaxdopSql(value as number)
  }

  throw new Error(`Unsupported action tool: ${toolName}`)
}

// ---------------------------------------------------------------------------
// Tool factory — scoped to an action context so proposals land in the right row.
// A context can be an incident investigation or a chat session bound to a server.
// ---------------------------------------------------------------------------

export interface ActionToolContext {
  /** Null for chat-originated actions. */
  incidentId: string | null
  /** Target server id — always required so the executor can resolve the server. */
  serverId: string
  source: ActionSource
  /**
   * Fired after a proposal row is persisted, so callers (e.g. the chat stream)
   * can surface the pending action to the UI. Best-effort; errors are swallowed
   * by the caller's handler.
   */
  onPropose?: (action: IncidentAction) => void | Promise<void>
}

/** Persist a proposal row and notify listeners; returns the executable T-SQL. */
async function persistProposal(
  ctx: ActionToolContext,
  toolName: string,
  params: Record<string, unknown>,
  reason: string
): Promise<{ actionId: string; tsql: string }> {
  const tsql = buildActionSqlForExecution(toolName, params)
  const action = await repo.createAction({
    incidentId: ctx.incidentId,
    serverId: ctx.serverId,
    source: ctx.source,
    toolName,
    params,
    tsqlPreview: tsql,
    explanation: reason
  })
  // Incident-scoped audit timeline only applies when there is an incident.
  if (ctx.incidentId) {
    await repo.addEvent(ctx.incidentId, 'action_proposed', {
      toolName,
      actionId: action.id,
      ...params
    })
  }
  if (ctx.onPropose) await ctx.onPropose(action)
  return { actionId: action.id, tsql }
}

export function buildActionTools(ctx: ActionToolContext): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'kill_session',
      description:
        'Propose killing a blocking SQL Server session. Use ONLY when diagnostics confirmed a long-running blocker. The user must approve before the KILL is executed.',
      schema: z.object({
        session_id: z.number().int().positive().describe('SQL Server session_id to kill'),
        reason: z.string().describe('One sentence explaining why this session should be killed')
      }),
      func: async ({ session_id, reason }) => {
        const { actionId, tsql } = await persistProposal(ctx, 'kill_session', { session_id }, reason)
        return JSON.stringify({ proposed: true, actionId, tsql })
      }
    }),

    new DynamicStructuredTool({
      name: 'update_statistics',
      description:
        'Propose running UPDATE STATISTICS WITH FULLSCAN on a single table to fix stale statistics causing bad query plans. The user must approve before execution.',
      schema: z.object({
        db_name: z.string().describe('Database name'),
        table_name: z.string().describe('Table name (schema.table or just table)'),
        reason: z.string().describe('One sentence explaining why statistics need updating')
      }),
      func: async ({ db_name, table_name, reason }) => {
        const { actionId, tsql } = await persistProposal(
          ctx,
          'update_statistics',
          { db_name, table_name },
          reason
        )
        return JSON.stringify({ proposed: true, actionId, tsql })
      }
    }),

    new DynamicStructuredTool({
      name: 'update_statistics_db',
      description:
        'Propose running sp_updatestats across an entire database when many tables have stale statistics. The user must approve before execution.',
      schema: z.object({
        db_name: z.string().describe('Database name'),
        reason: z.string().describe('One sentence explaining why a database-wide stats update is needed')
      }),
      func: async ({ db_name, reason }) => {
        const { actionId, tsql } = await persistProposal(
          ctx,
          'update_statistics_db',
          { db_name },
          reason
        )
        return JSON.stringify({ proposed: true, actionId, tsql })
      }
    }),

    new DynamicStructuredTool({
      name: 'rebuild_index',
      description:
        'Propose an index REBUILD to fix high fragmentation. Use only when fragmentation was confirmed above 30%. Rebuild is offline on Standard edition. The user must approve before execution.',
      schema: z.object({
        db_name: z.string().describe('Database name'),
        table_name: z.string().describe('Table name owning the index'),
        index_name: z.string().describe('Index name to rebuild'),
        reason: z.string().describe('One sentence justifying the rebuild')
      }),
      func: async ({ db_name, table_name, index_name, reason }) => {
        const { actionId, tsql } = await persistProposal(
          ctx,
          'rebuild_index',
          { db_name, table_name, index_name },
          reason
        )
        return JSON.stringify({ proposed: true, actionId, tsql })
      }
    }),

    new DynamicStructuredTool({
      name: 'reorganize_index',
      description:
        'Propose an online index REORGANIZE for moderate fragmentation (10-30%). Always online, low-impact. The user must approve before execution.',
      schema: z.object({
        db_name: z.string().describe('Database name'),
        table_name: z.string().describe('Table name owning the index'),
        index_name: z.string().describe('Index name to reorganize'),
        reason: z.string().describe('One sentence justifying the reorganize')
      }),
      func: async ({ db_name, table_name, index_name, reason }) => {
        const { actionId, tsql } = await persistProposal(
          ctx,
          'reorganize_index',
          { db_name, table_name, index_name },
          reason
        )
        return JSON.stringify({ proposed: true, actionId, tsql })
      }
    }),

    new DynamicStructuredTool({
      name: 'clear_plan_cache',
      description:
        'Propose flushing the procedure (plan) cache for a single database to force fresh query plans. Causes temporary recompilation overhead. The user must approve before execution.',
      schema: z.object({
        db_name: z.string().describe('Database whose plan cache should be flushed'),
        reason: z.string().describe('One sentence explaining why the plan cache should be cleared')
      }),
      func: async ({ db_name, reason }) => {
        const { actionId, tsql } = await persistProposal(
          ctx,
          'clear_plan_cache',
          { db_name },
          reason
        )
        return JSON.stringify({ proposed: true, actionId, tsql })
      }
    }),

    new DynamicStructuredTool({
      name: 'set_maxdop',
      description:
        "Propose changing the instance-wide 'max degree of parallelism' setting. This affects the whole SQL Server instance. The user must approve before execution.",
      schema: z.object({
        value: z
          .number()
          .int()
          .min(0)
          .max(64)
          .describe('New MAXDOP value (0 = use all available processors)'),
        reason: z.string().describe('One sentence justifying the MAXDOP change')
      }),
      func: async ({ value, reason }) => {
        const { actionId, tsql } = await persistProposal(ctx, 'set_maxdop', { value }, reason)
        return JSON.stringify({ proposed: true, actionId, tsql })
      }
    })
  ]
}

/**
 * Convenience factory for chat-originated actions bound to a server (no incident).
 */
export function buildServerActionTools(
  serverId: string,
  onPropose?: (action: IncidentAction) => void | Promise<void>
): DynamicStructuredTool[] {
  return buildActionTools({ incidentId: null, serverId, source: 'chat', onPropose })
}
