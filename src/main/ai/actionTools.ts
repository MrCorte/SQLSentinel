import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as repo from '../incidents/repository'

// ---------------------------------------------------------------------------
// Whitelist — only tools listed here can ever be proposed.
// The executor checks this list before running any T-SQL.
// ---------------------------------------------------------------------------

export const ACTION_WHITELIST = new Set([
  'kill_session',
  'update_statistics',
  'rebuild_index'
])

// ---------------------------------------------------------------------------
// T-SQL preview builders — parameterized with safe literals, no user input.
// The previews are stored in incident_actions.tsql_preview and shown to the
// user BEFORE approval so they know exactly what will run.
// ---------------------------------------------------------------------------

function killSessionSql(sessionId: number): string {
  return `KILL ${sessionId};`
}

function updateStatsSql(dbName: string, tableName: string): string {
  return `USE [${dbName.replace(/]/g, ']]')}];\nUPDATE STATISTICS [${tableName.replace(/]/g, ']]')}] WITH FULLSCAN;`
}

function rebuildIndexSql(dbName: string, tableName: string, indexName: string): string {
  return [
    `USE [${dbName.replace(/]/g, ']]')}];`,
    `ALTER INDEX [${indexName.replace(/]/g, ']]')}]`,
    `  ON [${tableName.replace(/]/g, ']]')}]`,
    `  REBUILD WITH (ONLINE = ON);`
  ].join('\n')
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
        const tsql = killSessionSql(session_id)
        const action = repo.createAction(
          incidentId,
          'kill_session',
          { session_id },
          tsql,
          reason
        )
        repo.addEvent(incidentId, 'action_proposed', { toolName: 'kill_session', actionId: action.id, session_id })
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
        const tsql = updateStatsSql(db_name, table_name)
        const action = repo.createAction(
          incidentId,
          'update_statistics',
          { db_name, table_name },
          tsql,
          reason
        )
        repo.addEvent(incidentId, 'action_proposed', { toolName: 'update_statistics', actionId: action.id, db_name, table_name })
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
        const tsql = rebuildIndexSql(db_name, table_name, index_name)
        const action = repo.createAction(
          incidentId,
          'rebuild_index',
          { db_name, table_name, index_name },
          tsql,
          reason
        )
        repo.addEvent(incidentId, 'action_proposed', { toolName: 'rebuild_index', actionId: action.id, db_name, table_name, index_name })
        return JSON.stringify({ proposed: true, actionId: action.id, tsql })
      }
    })
  ]
}
