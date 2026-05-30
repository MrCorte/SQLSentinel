import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeReadOnly, ReadOnlyViolation } from '../executeReadOnly'

vi.mock('../../collectors/connectionPool', () => ({
  getPool: vi.fn().mockResolvedValue({
    request: () => ({
      query: vi.fn().mockResolvedValue({ recordset: [{ col: 1 }] })
    })
  })
}))

describe('executeReadOnly', () => {
  describe('DML rejection', () => {
    const blocked = [
      'INSERT INTO foo VALUES (1)',
      'UPDATE foo SET x=1',
      'DELETE FROM foo',
      'DROP TABLE foo',
      'CREATE TABLE foo (id INT)',
      'ALTER TABLE foo ADD col INT',
      'TRUNCATE TABLE foo',
      'EXEC sp_something',
      'EXECUTE sp_something',
      'MERGE INTO foo USING bar',
      'KILL 123',
      'DBCC CHECKDB',
      'BACKUP DATABASE foo',
      'RESTORE DATABASE foo',
      'SHUTDOWN',
      'SELECT * INTO new_table FROM sys.objects'
    ]

    for (const sql of blocked) {
      it(`rejects: ${sql.split(' ').slice(0, 2).join(' ')}`, async () => {
        const conn = { ip: '127.0.0.1', port: 1433 } as never
        await expect(executeReadOnly(conn, sql)).rejects.toBeInstanceOf(ReadOnlyViolation)
      })
    }
  })

  describe('comment stripping (injection defense)', () => {
    it('does not false-positive on SELECT with block comment mentioning INSERT', async () => {
      const conn = { ip: '127.0.0.1', port: 1433 } as never
      const sql = 'SELECT /* INSERT INTO foo VALUES(1) */ 1 AS n'
      await expect(executeReadOnly(conn, sql)).resolves.toBeDefined()
    })

    it('does not false-positive on SELECT with line comment mentioning DELETE', async () => {
      const conn = { ip: '127.0.0.1', port: 1433 } as never
      const sql = 'SELECT 1 AS n -- DELETE FROM foo'
      await expect(executeReadOnly(conn, sql)).resolves.toBeDefined()
    })

    it('still rejects INSERT hidden after a comment prefix', async () => {
      const conn = { ip: '127.0.0.1', port: 1433 } as never
      // comment ends, then INSERT starts
      const sql = '/* safe comment */ INSERT INTO foo VALUES (1)'
      await expect(executeReadOnly(conn, sql)).rejects.toBeInstanceOf(ReadOnlyViolation)
    })
  })

  describe('allowed queries', () => {
    const allowed = [
      'SELECT * FROM sys.dm_exec_sessions',
      'SELECT TOP 10 wait_type FROM sys.dm_os_wait_stats ORDER BY wait_time_ms DESC',
      'SELECT session_id, blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id > 0'
    ]

    for (const sql of allowed) {
      it(`allows: ${sql.slice(0, 40)}…`, async () => {
        const conn = { ip: '127.0.0.1', port: 1433 } as never
        await expect(executeReadOnly(conn, sql)).resolves.toBeDefined()
      })
    }
  })

  describe('row cap', () => {
    it('caps the returned rows at MAX_ROWS (200) regardless of SET ROWCOUNT', async () => {
      const big = Array.from({ length: 500 }, (_, i) => ({ n: i }))
      const { getPool } = await import('../../collectors/connectionPool')
      vi.mocked(getPool).mockResolvedValueOnce({
        request: () => ({ query: vi.fn().mockResolvedValue({ recordset: big }) })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      const conn = { ip: '127.0.0.1', port: 1433 } as never
      const rows = await executeReadOnly(conn, 'SELECT n FROM big_view')
      expect(rows).toHaveLength(200)
    })
  })
})
