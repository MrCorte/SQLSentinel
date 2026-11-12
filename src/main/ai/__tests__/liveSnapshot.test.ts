import { describe, it, expect, vi, beforeEach } from 'vitest'

const getHistoryAll = vi.fn()
const findLastNBulk = vi.fn()
vi.mock('../../metricsWorker', () => ({ getHistoryAll: () => getHistoryAll() }))
vi.mock('../../store/sqlserver/metricsRepository', () => ({
  findLastNBulk: (...a: unknown[]) => findLastNBulk(...a)
}))

import { loadLatestSnapshots, MEMORY_FRESH_MS } from '../liveSnapshot'

const NOW = Date.parse('2026-11-12T10:00:00Z')
const srv = (id: string, host: string) => ({
  id,
  host,
  port: 1433,
  useWindowsAuth: true,
  addedAt: ''
})
const snap = (ageMs: number, cpu = 10) => ({
  collectedAt: new Date(NOW - ageMs),
  instanceInfo: { cpuUsagePercent: cpu }
})

beforeEach(() => {
  getHistoryAll.mockReset().mockReturnValue({})
  findLastNBulk.mockReset().mockResolvedValue({})
})

describe('loadLatestSnapshots', () => {
  it('uses fresh in-memory snapshots without touching storage', async () => {
    getHistoryAll.mockReturnValue({ 'a.corp:1433': [snap(60_000, 1), snap(5_000, 42)] })
    const r = await loadLatestSnapshots([srv('A', 'a.corp')] as never, NOW)
    expect(r.byId.get('A')?.instanceInfo.cpuUsagePercent).toBe(42)
    expect(r.fromMemory).toBe(1)
    expect(findLastNBulk).not.toHaveBeenCalled()
  })

  it('falls back to SQL for missing or stale memory (e.g. Windows Service collecting)', async () => {
    getHistoryAll.mockReturnValue({ 'a.corp:1433': [snap(MEMORY_FRESH_MS + 1)] })
    findLastNBulk.mockResolvedValue({ A: [snap(1_000, 77)], B: [snap(1_000, 88)] })
    const r = await loadLatestSnapshots([srv('A', 'a.corp'), srv('B', 'b.corp')] as never, NOW)
    expect(findLastNBulk).toHaveBeenCalledWith(['A', 'B'], 1)
    expect(r.byId.get('A')?.instanceInfo.cpuUsagePercent).toBe(77)
    expect(r.fromStorage).toBe(2)
  })

  it('survives a worker that is not running', async () => {
    getHistoryAll.mockImplementation(() => {
      throw new Error('not started')
    })
    findLastNBulk.mockResolvedValue({ A: [snap(1_000)] })
    const r = await loadLatestSnapshots([srv('A', 'a.corp')] as never, NOW)
    expect(r.byId.size).toBe(1)
  })
})
