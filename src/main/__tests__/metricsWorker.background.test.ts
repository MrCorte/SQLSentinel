import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn() }))
vi.mock('../collectors/agCollector', () => ({
  detectAndSyncReplicaRoles: vi.fn(() => Promise.resolve([]))
}))
vi.mock('../store/sqlserver/dbCustomFieldsRepository', () => ({
  getAllCustomFields: vi.fn(async () => ({}))
}))
vi.mock('../store/sqlserver/metricsRepository', () => ({
  cleanup: vi.fn(async () => {}),
  findLastNBulk: vi.fn(async () => ({})),
  batchSave: vi.fn(async () => {})
}))
vi.mock('../store/sqlserver/settingsRepository', () => ({
  getSettings: vi.fn(async () => ({ retentionMinutes: 60 }))
}))
vi.mock('../store/sqlserver/serverDatabasesRepository', () => ({
  upsertDatabases: vi.fn(async () => {}),
  deleteStale: vi.fn(async () => {}),
  deleteByNames: vi.fn(async () => {}),
  getAllGroupedByServer: vi.fn(async () => ({}))
}))
vi.mock('../store/sqlserver/serverRepository')

import {
  onAlert,
  __resetForTests,
  __getAlertCallbackForTest,
  setIntervalOverrides,
  __getJobForTest,
  syncServers
} from '../metricsWorker'
import type { CollectMetricsRequest } from '../ipc/types'

const mockServer: CollectMetricsRequest = {
  ip: '10.0.0.1',
  port: 1433,
  useWindowsAuth: true
}

describe('setIntervalOverrides', () => {
  beforeEach(() => {
    __resetForTests()
  })

  it('accepts overrides without throwing', () => {
    expect(() =>
      setIntervalOverrides({ activeMs: 1000, idleMs: 1000, offlineMs: 1000 })
    ).not.toThrow()
  })

  it('accepts null to restore defaults without throwing', () => {
    setIntervalOverrides({ activeMs: 1000, idleMs: 1000, offlineMs: 1000 })
    expect(() => setIntervalOverrides(null)).not.toThrow()
  })

  it('staggers nextRun across [now, now + N/2] when applied', () => {
    syncServers([mockServer, { ...mockServer, ip: '10.0.0.2' }])
    const before = Date.now()
    setIntervalOverrides({ activeMs: 60_000, idleMs: 60_000, offlineMs: 60_000 })
    const job1 = __getJobForTest('10.0.0.1:1433')!
    const job2 = __getJobForTest('10.0.0.2:1433')!
    expect(job1.nextRun).toBeGreaterThanOrEqual(before)
    expect(job1.nextRun).toBeLessThanOrEqual(before + 30_000 + 100)
    expect(job2.nextRun).toBeGreaterThanOrEqual(before)
    expect(job2.nextRun).toBeLessThanOrEqual(before + 30_000 + 100)
  })
})

describe('onAlert', () => {
  beforeEach(() => {
    __resetForTests()
  })

  it('registers a callback that becomes the active one', () => {
    const cb = vi.fn()
    onAlert(cb)
    expect(__getAlertCallbackForTest()).toBe(cb)
  })

  it('replaces previous callback when called twice — only second is active', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    onAlert(cb1)
    onAlert(cb2)
    expect(__getAlertCallbackForTest()).toBe(cb2)
    expect(__getAlertCallbackForTest()).not.toBe(cb1)
  })
})
