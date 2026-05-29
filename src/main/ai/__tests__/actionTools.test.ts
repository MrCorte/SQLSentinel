import { describe, it, expect, vi } from 'vitest'
import {
  buildActionSqlForExecution,
  buildActionTools,
  buildServerActionTools,
  ACTION_WHITELIST,
  DESTRUCTIVE_ACTIONS,
  isDestructiveAction
} from '../actionTools'

vi.mock('../../incidents/repository', () => ({
  createAction: vi.fn().mockResolvedValue({ id: 'action-1', source: 'incident' }),
  addEvent: vi.fn()
}))

const INCIDENT_CTX = { incidentId: 'incident-123', serverId: 'srv-1', source: 'incident' as const }

describe('ACTION_WHITELIST', () => {
  it('contains the original and the newly added tools', () => {
    for (const name of [
      'kill_session',
      'update_statistics',
      'update_statistics_db',
      'rebuild_index',
      'reorganize_index',
      'clear_plan_cache',
      'set_maxdop'
    ]) {
      expect(ACTION_WHITELIST).toContain(name)
    }
  })
})

describe('DESTRUCTIVE_ACTIONS', () => {
  it('flags state-changing/instance-wide actions as destructive', () => {
    expect(isDestructiveAction('kill_session')).toBe(true)
    expect(isDestructiveAction('rebuild_index')).toBe(true)
    expect(isDestructiveAction('clear_plan_cache')).toBe(true)
    expect(isDestructiveAction('set_maxdop')).toBe(true)
  })
  it('does not flag online/low-impact actions', () => {
    expect(isDestructiveAction('update_statistics')).toBe(false)
    expect(isDestructiveAction('update_statistics_db')).toBe(false)
    expect(isDestructiveAction('reorganize_index')).toBe(false)
  })
  it('every destructive action is also whitelisted', () => {
    for (const name of DESTRUCTIVE_ACTIONS) expect(ACTION_WHITELIST).toContain(name)
  })
})

describe('buildActionTools', () => {
  const tools = buildActionTools(INCIDENT_CTX)
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

  it('exposes all whitelisted tools', () => {
    expect(new Set(tools.map((t) => t.name))).toEqual(ACTION_WHITELIST)
  })

  it('persists kill_session as a structured proposal with server + source', async () => {
    const repo = await import('../../incidents/repository')
    vi.mocked(repo.createAction).mockClear()
    await byName['kill_session'].invoke({ session_id: 99, reason: 'blocking chain head' })
    expect(repo.createAction).toHaveBeenCalledWith({
      incidentId: 'incident-123',
      serverId: 'srv-1',
      source: 'incident',
      toolName: 'kill_session',
      params: { session_id: 99 },
      tsqlPreview: 'KILL 99;',
      explanation: 'blocking chain head'
    })
  })

  it('brackets schema-qualified tables in update_statistics', async () => {
    const repo = await import('../../incidents/repository')
    vi.mocked(repo.createAction).mockClear()
    await byName['update_statistics'].invoke({
      db_name: 'Orders',
      table_name: 'dbo.Invoices',
      reason: 'stale stats'
    })
    const tsql = vi.mocked(repo.createAction).mock.calls[0][0].tsqlPreview
    expect(tsql).toContain('[dbo].[Invoices]')
    expect(tsql).not.toMatch(/\[dbo\.Invoices\]/)
  })

  it('fires onPropose for chat-bound tools', async () => {
    const repo = await import('../../incidents/repository')
    vi.mocked(repo.createAction).mockClear()
    const onPropose = vi.fn()
    const chatTools = buildServerActionTools('srv-9', onPropose)
    const kill = chatTools.find((t) => t.name === 'kill_session')!
    await kill.invoke({ session_id: 60, reason: 'blocker' })
    expect(repo.createAction).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: null, serverId: 'srv-9', source: 'chat' })
    )
    expect(onPropose).toHaveBeenCalledTimes(1)
  })
})

describe('buildActionSqlForExecution', () => {
  it('regenerates executable SQL from structured params', () => {
    expect(buildActionSqlForExecution('kill_session', { session_id: 99 })).toBe('KILL 99;')
  })

  it('rejects malformed kill_session params', () => {
    expect(() => buildActionSqlForExecution('kill_session', { session_id: '99' })).toThrow(
      'Invalid kill_session params'
    )
  })

  it('builds a database-wide stats update', () => {
    expect(buildActionSqlForExecution('update_statistics_db', { db_name: 'Orders' })).toContain(
      'EXEC sp_updatestats;'
    )
  })

  it('builds an online reorganize', () => {
    const sql = buildActionSqlForExecution('reorganize_index', {
      db_name: 'Orders',
      table_name: 'dbo.Invoices',
      index_name: 'IX_Date'
    })
    expect(sql).toContain('REORGANIZE')
    expect(sql).toContain('[dbo].[Invoices]')
  })

  it('scopes plan-cache flush to a single database and escapes quotes', () => {
    const sql = buildActionSqlForExecution('clear_plan_cache', { db_name: "O'Brien" })
    expect(sql).toContain('DBCC FLUSHPROCINDB')
    expect(sql).toContain("DB_ID(N'O''Brien')")
  })

  it('bounds set_maxdop to a valid integer range', () => {
    expect(buildActionSqlForExecution('set_maxdop', { value: 4 })).toContain(
      "sp_configure 'max degree of parallelism', 4"
    )
    expect(() => buildActionSqlForExecution('set_maxdop', { value: 99 })).toThrow('Invalid maxdop')
  })

  it('rejects unknown tools', () => {
    expect(() => buildActionSqlForExecution('drop_database', {})).toThrow('Unsupported action tool')
  })
})
