import { beforeEach, describe, expect, it, vi } from 'vitest'

const mssqlMocks = vi.hoisted(() => ({
  query: vi.fn(),
  input: vi.fn(),
  close: vi.fn(),
  connect: vi.fn()
}))

vi.mock('mssql', () => ({
  NVarChar: 'NVarChar',
  connect: mssqlMocks.connect
}))

import { getShrinkEstimate, shrinkDatabase, shrinkFile } from './dbAdmin'
import type { CollectMetricsRequest } from '../ipc/types'

const CONN: CollectMetricsRequest = {
  ip: '127.0.0.1',
  port: 1433,
  useWindowsAuth: false,
  username: 'sa',
  password: 'Secret1!'
}

beforeEach(() => {
  vi.clearAllMocks()
  mssqlMocks.input.mockReturnValue({ query: mssqlMocks.query, input: mssqlMocks.input })
  mssqlMocks.connect.mockResolvedValue({
    request: () => ({ query: mssqlMocks.query, input: mssqlMocks.input }),
    close: mssqlMocks.close
  })
  mssqlMocks.close.mockResolvedValue(undefined)
})

describe('dbAdmin smoke tests', () => {
  it('getShrinkEstimate reads sys.database_files and closes the pool', async () => {
    mssqlMocks.query.mockResolvedValue({ recordset: [{ file_name: 'data', current_mb: 100 }] })

    const result = await getShrinkEstimate(CONN, 'AppDb')

    expect(result).toEqual([{ file_name: 'data', current_mb: 100 }])
    expect(mssqlMocks.query.mock.calls[0][0]).toContain('FROM sys.database_files')
    expect(mssqlMocks.close).toHaveBeenCalledOnce()
  })

  it('shrinkDatabase clamps target percentage before building DBCC', async () => {
    mssqlMocks.query.mockResolvedValue({ recordset: [] })

    const result = await shrinkDatabase(CONN, 'AppDb', 140)

    expect(result.success).toBe(true)
    expect(mssqlMocks.query.mock.calls[0][0]).toBe('DBCC SHRINKDATABASE (0, 99)')
  })

  it('shrinkFile bracket-escapes file and database names in DBCC commands', async () => {
    mssqlMocks.query
      .mockResolvedValueOnce({ recordset: [{ recovery_model_desc: 'FULL' }] })
      .mockResolvedValueOnce({ recordset: [{ size_mb: 100 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ size_mb: 80 }] })

    const result = await shrinkFile(CONN, 'App]Db', 'Data]File', 80, true)

    expect(result.success).toBe(true)
    expect(mssqlMocks.query.mock.calls[1][0]).toBe("BACKUP LOG [App]]Db] TO DISK = N'NUL'")
    expect(mssqlMocks.query.mock.calls[3][0]).toBe('DBCC SHRINKFILE ([Data]]File], 80)')
  })
})
