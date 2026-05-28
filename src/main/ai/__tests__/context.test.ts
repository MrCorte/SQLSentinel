import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllStripped: vi.fn(),
  findLastNBulk: vi.fn()
}))

vi.mock('../../store/sqlserver/serverRepository', () => ({
  getAllStripped: mocks.getAllStripped
}))

vi.mock('../../store/sqlserver/metricsRepository', () => ({
  findLastNBulk: mocks.findLastNBulk
}))

vi.mock('../../metricsWorker', () => ({
  getAlerts: vi.fn(() => [])
}))

import { gatherContext } from '../context'

describe('gatherContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads latest metrics by persisted server id, not host:port display key', async () => {
    mocks.getAllStripped.mockReturnValue([
      { id: 'srv-1', host: '10.0.0.1', port: 1433 },
      { id: 'srv-2', host: '10.0.0.2', port: 1433 }
    ])
    mocks.findLastNBulk.mockResolvedValue({})

    await gatherContext()

    expect(mocks.findLastNBulk).toHaveBeenCalledWith(['srv-1', 'srv-2'], 1)
  })
})
