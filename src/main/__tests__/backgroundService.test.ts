import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---
const mockTray = {
  destroy: vi.fn(),
  setContextMenu: vi.fn(),
  setImage: vi.fn(),
  isDestroyed: vi.fn(() => false),
  on: vi.fn(),
}
// vi.fn with arrow fn cannot be used as constructor in Vitest v4 — use regular function
const MockTray = vi.fn(function () { return mockTray })
const mockMenu = { popup: vi.fn() }
const MockMenu = { buildFromTemplate: vi.fn(function () { return mockMenu }) }
const mockNotification = { show: vi.fn(), on: vi.fn() }
const MockNotification = vi.fn(function () { return mockNotification })
;(MockNotification as any).isSupported = vi.fn(() => true)

vi.mock('electron', () => ({
  Tray: MockTray,
  Menu: MockMenu,
  Notification: MockNotification,
  app: { quit: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('../store/serverStore', () => ({ getAll: vi.fn(() => []) }))
vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({
    retentionMinutes: 60,
    backgroundEnabled: true,
    backgroundMode: 'light',
    backgroundIntervalMinutes: 30,
    backgroundNotifications: true,
  })),
  saveSettings: vi.fn(),
}))
vi.mock('../metricsWorker', () => ({
  syncServers: vi.fn(),
  stopWorker: vi.fn(),
  setIntervalOverrides: vi.fn(),
  onAlert: vi.fn(),
  getAlerts: vi.fn(() => []),
}))

function makeMockWin() {
  const listeners: Record<string, Function[]> = {}
  return {
    on: vi.fn((event: string, cb: Function) => {
      ;(listeners[event] ??= []).push(cb)
    }),
    emit: (event: string, ...args: unknown[]) =>
      listeners[event]?.forEach((cb) => cb(...args)),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isVisible: vi.fn(() => true),
    isDestroyed: vi.fn(() => false),
  }
}

describe('BackgroundService — window close intercept', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('hides the window instead of closing when quitting=false', async () => {
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const workerApi = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn(),
    }
    new BackgroundService(win, workerApi)
    const preventDefault = vi.fn()
    win.emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(win.hide).toHaveBeenCalled()
  })

  it('does NOT prevent close when quitting=true (Esci clicked)', async () => {
    vi.resetModules()
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const workerApi = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn(),
    }
    const svc = new BackgroundService(win, workerApi)
    ;(svc as any).quitting = true
    const preventDefault = vi.fn()
    win.emit('close', { preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
