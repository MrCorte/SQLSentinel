import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---
const mockTray = {
  destroy: vi.fn(),
  setContextMenu: vi.fn(),
  setImage: vi.fn(),
  isDestroyed: vi.fn(() => false),
  on: vi.fn()
}
// vi.fn with arrow fn cannot be used as constructor in Vitest v4 — use regular function
const MockTray = vi.fn(function () {
  return mockTray
})
const mockMenu = { popup: vi.fn() }
const MockMenu = {
  buildFromTemplate: vi.fn(function () {
    return mockMenu
  })
}
const mockNotification = { show: vi.fn(), on: vi.fn() }
const MockNotification = vi.fn(function () {
  return mockNotification
})
;(MockNotification as any).isSupported = vi.fn(() => true)

vi.mock('electron', () => ({
  Tray: MockTray,
  Menu: MockMenu,
  Notification: MockNotification,
  app: { quit: vi.fn(), isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('../store/serverStore', () => ({
  getAll: vi.fn(() => []),
  getAllStripped: vi.fn(() => [])
}))
vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({
    retentionMinutes: 60,
    backgroundEnabled: true,
    backgroundMode: 'light',
    backgroundIntervalMinutes: 30,
    backgroundNotifications: true,
    themeMode: 'system'
  })),
  saveSettings: vi.fn()
}))
vi.mock('../metricsWorker', () => ({
  syncServers: vi.fn(),
  stopWorker: vi.fn(),
  setIntervalOverrides: vi.fn(),
  onAlert: vi.fn(),
  getAlerts: vi.fn(() => [])
}))
vi.mock('../emailService', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../serviceClient', () => ({
  getStatus: vi.fn(() => 'disconnected')
}))

function makeMockWin() {
  const listeners: Record<string, Function[]> = {}
  return {
    on: vi.fn((event: string, cb: Function) => {
      ;(listeners[event] ??= []).push(cb)
    }),
    emit: (event: string, ...args: unknown[]) => listeners[event]?.forEach((cb) => cb(...args)),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isVisible: vi.fn(() => true),
    isDestroyed: vi.fn(() => false)
  }
}

describe('BackgroundService — window close intercept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides the window instead of closing when quitting=false', async () => {
    vi.resetModules()
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const workerApi = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
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
      onAlert: vi.fn()
    }
    const svc = new BackgroundService(win, workerApi)
    ;(svc as any).quitting = true
    const preventDefault = vi.fn()
    win.emit('close', { preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

describe('BackgroundService — background mode manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls setIntervalOverrides with correct ms on hide (light mode)', async () => {
    vi.resetModules()
    const settingsMock = {
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60,
        themeMode: 'system'
      })),
      saveSettings: vi.fn()
    }
    vi.doMock('../store/settings', () => settingsMock)
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    new BackgroundService(win, worker)
    win.emit('hide')
    expect(worker.setIntervalOverrides).toHaveBeenCalledWith(
      expect.objectContaining({
        activeMs: 30 * 60_000,
        lightCollectors: true,
        historyCapOverride: 3
      })
    )
  })

  it('calls stopWorker on hide when backgroundEnabled=false', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: false,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60,
        themeMode: 'system'
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    new BackgroundService(win, worker)
    win.emit('hide')
    expect(worker.stopWorker).toHaveBeenCalled()
  })

  it('calls setIntervalOverrides(null) on show', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'full',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60,
        themeMode: 'system'
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    new BackgroundService(win, worker)
    win.emit('show')
    expect(worker.setIntervalOverrides).toHaveBeenCalledWith(null)
  })

  it('does not call setIntervalOverrides or stopWorker on hide when backgroundMode=full', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'full',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60,
        themeMode: 'system'
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    new BackgroundService(win, worker)
    win.emit('hide')
    expect(worker.setIntervalOverrides).not.toHaveBeenCalled()
    expect(worker.stopWorker).not.toHaveBeenCalled()
  })
})

describe('BackgroundService — notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not notify for WARNING alerts', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60,
        themeMode: 'system'
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    win.isVisible.mockReturnValue(false)
    let capturedCb: Function | null = null
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn((cb) => {
        capturedCb = cb
      })
    }
    new BackgroundService(win, worker)
    capturedCb!({
      severity: 'WARNING',
      serverId: 'x',
      category: 'cpu_high',
      message: 'test',
      detectedAt: new Date(),
      acknowledgedAt: null,
      id: '1'
    })
    expect(MockNotification).not.toHaveBeenCalled()
  })

  it('notifies for CRITICAL alerts when window hidden', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60,
        themeMode: 'system'
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    win.isVisible.mockReturnValue(false)
    let capturedCb: Function | null = null
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn((cb) => {
        capturedCb = cb
      })
    }
    new BackgroundService(win, worker)
    capturedCb!({
      severity: 'CRITICAL',
      serverId: '10.0.0.1:1433',
      category: 'cpu_high',
      message: 'CPU 95%',
      detectedAt: new Date(),
      acknowledgedAt: null,
      id: '1'
    })
    expect(MockNotification).toHaveBeenCalled()
    expect(mockNotification.show).toHaveBeenCalled()
  })

  it('does not re-notify within 15-minute cooldown', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60,
        themeMode: 'system'
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    win.isVisible.mockReturnValue(false)
    let capturedCb: Function | null = null
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn((cb) => {
        capturedCb = cb
      })
    }
    new BackgroundService(win, worker)
    const alert = {
      severity: 'CRITICAL' as const,
      serverId: '10.0.0.1:1433',
      category: 'cpu_high' as const,
      message: 'CPU 95%',
      detectedAt: new Date(),
      acknowledgedAt: null,
      id: '1'
    }
    capturedCb!(alert)
    capturedCb!(alert) // second call — should be deduped
    expect(MockNotification).toHaveBeenCalledTimes(1)
  })
})
