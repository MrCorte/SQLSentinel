import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildActionSqlForExecution, buildActionTools, ACTION_WHITELIST } from '../actionTools'

vi.mock('../../incidents/repository', () => ({
  createAction: vi.fn().mockReturnValue({ id: 'action-1' }),
  addEvent: vi.fn()
}))

describe('ACTION_WHITELIST', () => {
  it('contains exactly the expected tool names', () => {
    expect(ACTION_WHITELIST).toContain('kill_session')
    expect(ACTION_WHITELIST).toContain('update_statistics')
    expect(ACTION_WHITELIST).toContain('rebuild_index')
    expect(ACTION_WHITELIST.size).toBe(3)
  })
})

describe('buildActionTools', () => {
  const tools = buildActionTools('incident-123')
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

  it('returns exactly 3 tools', () => {
    expect(tools).toHaveLength(3)
  })

  describe('kill_session', () => {
    it('generates correct T-SQL for valid session_id', async () => {
      const repo = await import('../../incidents/repository')
      await byName['kill_session'].invoke({ session_id: 99, reason: 'blocking chain head' })
      expect(repo.createAction).toHaveBeenCalledWith(
        'incident-123',
        'kill_session',
        { session_id: 99 },
        'KILL 99;',
        'blocking chain head'
      )
    })
  })

  describe('update_statistics — bracket safety', () => {
    it('handles unqualified table name', async () => {
      const repo = await import('../../incidents/repository')
      vi.mocked(repo.createAction).mockClear()
      await byName['update_statistics'].invoke({ db_name: 'Orders', table_name: 'Invoices', reason: 'stale stats' })
      const call = vi.mocked(repo.createAction).mock.calls[0]
      const tsql: string = call[3]
      expect(tsql).toContain('UPDATE STATISTICS [Invoices]')
      expect(tsql).not.toContain('[Invoices.') // no dot inside single bracket
    })

    it('handles schema-qualified table name', async () => {
      const repo = await import('../../incidents/repository')
      vi.mocked(repo.createAction).mockClear()
      await byName['update_statistics'].invoke({ db_name: 'Orders', table_name: 'dbo.Invoices', reason: 'stale stats' })
      const call = vi.mocked(repo.createAction).mock.calls[0]
      const tsql: string = call[3]
      expect(tsql).toContain('[dbo].[Invoices]')
      expect(tsql).not.toMatch(/\[dbo\.Invoices\]/) // must not be single bracket with dot
    })

    it('handles bracket injection in db name', async () => {
      const repo = await import('../../incidents/repository')
      vi.mocked(repo.createAction).mockClear()
      await byName['update_statistics'].invoke({ db_name: 'bad]name', table_name: 'MyTable', reason: 'test' })
      const call = vi.mocked(repo.createAction).mock.calls[0]
      const tsql: string = call[3]
      expect(tsql).toContain('[bad]]name]')
    })
  })

  describe('rebuild_index', () => {
    it('does NOT include ONLINE = ON (all-edition compatibility)', async () => {
      const repo = await import('../../incidents/repository')
      vi.mocked(repo.createAction).mockClear()
      await byName['rebuild_index'].invoke({
        db_name: 'Orders',
        table_name: 'dbo.Invoices',
        index_name: 'IX_InvoiceDate',
        reason: 'fragmentation > 30%'
      })
      const call = vi.mocked(repo.createAction).mock.calls[0]
      const tsql: string = call[3]
      expect(tsql).not.toContain('ONLINE = ON')
      expect(tsql).toContain('REBUILD')
    })

    it('brackets schema-qualified table in ON clause', async () => {
      const repo = await import('../../incidents/repository')
      vi.mocked(repo.createAction).mockClear()
      await byName['rebuild_index'].invoke({
        db_name: 'Orders',
        table_name: 'dbo.Invoices',
        index_name: 'IX_InvoiceDate',
        reason: 'fragmentation > 30%'
      })
      const call = vi.mocked(repo.createAction).mock.calls[0]
      const tsql: string = call[3]
      expect(tsql).toContain('[dbo].[Invoices]')
    })
  })
})

describe('buildActionSqlForExecution', () => {
  it('regenerates executable SQL from structured params', () => {
    const sql = buildActionSqlForExecution('kill_session', { session_id: 99 })
    expect(sql).toBe('KILL 99;')
  })

  it('rejects malformed structured params', () => {
    expect(() => buildActionSqlForExecution('kill_session', { session_id: '99' })).toThrow(
      'Invalid kill_session params'
    )
  })
})
