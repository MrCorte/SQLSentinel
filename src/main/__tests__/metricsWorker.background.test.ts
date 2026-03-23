import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn() }))
vi.mock('../collectors/agCollector', () => ({ detectAndSyncReplicaRoles: vi.fn(() => Promise.resolve([])) }))
vi.mock('../store/dbCustomFields', () => ({ getAllCustomFields: vi.fn(() => ({})) }))
vi.mock('../store/serverStore')

import { onAlert, __resetForTests, __getAlertCallbackForTest } from '../metricsWorker'

describe('onAlert', () => {
  beforeEach(() => { __resetForTests() })

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
