import { app, shell, BrowserWindow, ipcMain } from 'electron'
import type { BrowserWindow as BrowserWindowType } from 'electron'
import { join } from 'path'

const icon = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../resources/icon.png')
import { registerIpcHandlers } from './ipc'
import { initDefaultAdmin } from './authService'
import { BackgroundService } from './backgroundService'
import type { WorkerApi } from './backgroundService'
import { syncServers, stopWorker, setIntervalOverrides, onAlert } from './metricsWorker'
import { initDb, closeDb, defaultDbPath } from './store/database'
import { cleanup as purgeOldSnapshots } from './store/metricsRepository'
import { getSettings } from './store/settings'
import { migrateEncryptEmailPassword } from './store/emailSettings'
import { isAvailable as safeStorageAvailable } from './store/safeStorageUtil'
import { IpcChannel } from './ipc/types'
import * as serverStore from './store/serverStore'
import { scanHost } from './discovery/tcpScanner'
import { abortActiveStream, warmupModel } from './ai/langGraphAgent'
import { safeError as redactError } from './utils/safeLog'
import { createLogger } from './utils/logger'
const log = createLogger('main')

const isDev = !app.isPackaged

// Catches unhandled async errors in the main process before they silently crash.
// Stack traces go through redactError → removes absolute user paths (info disclosure).
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandledRejection:', redactError(reason))
})
process.on('uncaughtException', (err) => {
  log.error('[main] uncaughtException:', redactError(err))
})

// Module-level reference so the health checker can push events to the renderer
let mainWindow: BrowserWindow | null = null
let backgroundService: BackgroundService | null = null
let healthCheckIntervalId: ReturnType<typeof setInterval> | null = null
let deferredPurgeIntervalId: ReturnType<typeof setInterval> | null = null
let devGcIntervalId: ReturnType<typeof setInterval> | null = null

function watchWindowShortcuts(window: BrowserWindowType): void {
  const { webContents } = window
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (isDev) {
      // F12 — apri/chiudi DevTools in sviluppo
      if (input.code === 'F12') {
        if (webContents.isDevToolsOpened()) {
          webContents.closeDevTools()
        } else {
          webContents.openDevTools({ mode: 'undocked' })
        }
      }
    } else {
      // Blocca Ctrl+R (reload) e Ctrl+Shift+I (DevTools) in produzione
      if (input.code === 'KeyR' && (input.control || input.meta)) event.preventDefault()
      if (input.code === 'KeyI' && ((input.alt && input.meta) || (input.control && input.shift))) {
        event.preventDefault()
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Health check — TCP probe every 60 s, push events to renderer
// ---------------------------------------------------------------------------

// Probe at most 20 servers concurrently: worst case ceil(200/20) × 5 s = 50 s
// (within the 60 s interval) instead of the sequential 200 × 5 s = 1000 s.
const HEALTH_CONCURRENCY = 20

async function healthCheckAll(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const servers = serverStore.getAll()

  for (let i = 0; i < servers.length; i += HEALTH_CONCURRENCY) {
    const chunk = servers.slice(i, i + HEALTH_CONCURRENCY)
    await Promise.allSettled(
      chunk.map(async (server) => {
        const addr = server.host ?? server.ip
        try {
          // TCP probe with 5 s timeout — no SQL credentials needed
          await scanHost(addr, server.port, 5000)
          if (server.unreachable) {
            // Was marked unreachable — now back online
            serverStore.update(server.id, {
              unreachable: false,
              unreachableSince: undefined,
              lastSeen: new Date().toISOString()
            })
            mainWindow?.webContents.send(IpcChannel.SERVER_RECOVERED, server.id)
            log.info('[HealthCheck] RECOVERED:', `${addr}:${server.port}`)
          } else {
            serverStore.update(server.id, { lastSeen: new Date().toISOString() })
          }
        } catch {
          if (!server.unreachable) {
            // First failure — mark as unreachable and notify renderer
            const since = new Date().toISOString()
            serverStore.update(server.id, { unreachable: true, unreachableSince: since })
            mainWindow?.webContents.send(IpcChannel.SERVER_UNREACHABLE, {
              serverId: server.id,
              ip: addr,
              port: server.port,
              since
            })
            log.warn('[HealthCheck] UNREACHABLE:', `${addr}:${server.port}`)
          }
        }
      })
    )
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'SQL Sentinel',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.setTitle('SQL Sentinel')
    mainWindow!.show()
    if (isDev) {
      mainWindow!.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Initialize SQLite — before any IPC handler
  initDb(defaultDbPath(app.getPath('appData')))

  // Create default admin user if no users exist
  initDefaultAdmin().catch((err) => log.error('[AUTH] initDefaultAdmin failed:', err))

  // Purge snapshots older than the configured retention: once at boot, then every 24 h.
  // Synchronous DELETE on large DBs can block for 1-3s: defer with setImmediate to avoid
  // slowing startup or freezing the main loop once every 24 h.
  const retentionDays = (): number => getSettings().retentionMinutes / (60 * 24)
  const deferredPurge = (): void => {
    setImmediate(() => {
      try {
        purgeOldSnapshots(retentionDays())
      } catch (err) {
        log.warn('[main] purgeOldSnapshots:', err)
      }
    })
  }
  deferredPurge()
  deferredPurgeIntervalId = setInterval(deferredPurge, 24 * 60 * 60 * 1000)

  // One-shot migrations
  serverStore.migrateHostField()
  serverStore.migrateEncryptCredentials()
  migrateEncryptEmailPassword()

  // M4: fail loud if OS-level encryption is unavailable — users must know that
  // credentials are falling back to plaintext storage. See safeStorageUtil.warnOnce()
  // for the one-time warning on each encrypt/decrypt attempt; this is the startup sentinel.
  if (!safeStorageAvailable()) {
    log.error(
      '[SECURITY] OS keyring/DPAPI not available — ALL stored passwords will be in plaintext. ' +
        'Configure your OS keyring or switch user profile to restore encrypted storage.'
    )
  }

  // App User Model ID for Windows (notifications, taskbar)
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.sqlsentinel')
  }

  app.on('browser-window-created', (_, window) => {
    watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => log.info('pong'))

  registerIpcHandlers()

  // Pre-load the LLM into Ollama memory so the first AI query is fast
  warmupModel()

  createWindow()

  const workerApi: WorkerApi = { syncServers, stopWorker, setIntervalOverrides, onAlert }
  if (mainWindow) {
    backgroundService = new BackgroundService(mainWindow, workerApi)
  }

  // Start health check: first run after 5 s, then every 60 s
  setTimeout(() => {
    healthCheckAll()
    healthCheckIntervalId = setInterval(healthCheckAll, 60_000)
  }, 5_000)

  // Push background/foreground events to renderer so it can throttle polling
  app.on('browser-window-blur', () => {
    mainWindow?.webContents.send(IpcChannel.APP_BACKGROUND)
  })
  app.on('browser-window-focus', () => {
    mainWindow?.webContents.send(IpcChannel.APP_FOREGROUND)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // GC logging (dev only — requires --expose-gc flag)
  if (isDev && typeof (globalThis as typeof globalThis & { gc?: () => void }).gc === 'function') {
    const gc = (globalThis as typeof globalThis & { gc: () => void }).gc
    devGcIntervalId = setInterval(() => {
      const mem = process.memoryUsage()
      gc()
      const after = process.memoryUsage()
      log.info(
        `[Main] heap: ${(after.heapUsed / 1024 / 1024).toFixed(1)}MB` +
          ` / ${(after.heapTotal / 1024 / 1024).toFixed(1)}MB` +
          ` | rss: ${(mem.rss / 1024 / 1024).toFixed(1)}MB`
      )
    }, 60_000)
  }
})

function cleanupResources(): void {
  if (healthCheckIntervalId !== null) {
    clearInterval(healthCheckIntervalId)
    healthCheckIntervalId = null
  }
  if (deferredPurgeIntervalId !== null) {
    clearInterval(deferredPurgeIntervalId)
    deferredPurgeIntervalId = null
  }
  if (devGcIntervalId !== null) {
    clearInterval(devGcIntervalId)
    devGcIntervalId = null
  }
  backgroundService?.destroy()
  backgroundService = null
  closeDb()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupResources()
    app.quit()
  }
  // On macOS the app stays alive in the dock; cleanup runs on before-quit instead.
})

// Cleanup also when the process receives termination signals (taskkill,
// Docker stop, etc.) — without these handlers the healthCheck would keep running
// until the kernel kills the process, and the SQLite DB could close
// without flushing.
app.on('before-quit', () => {
  abortActiveStream()
  cleanupResources()
})
process.on('SIGTERM', () => {
  cleanupResources()
  app.quit()
})
process.on('SIGINT', () => {
  cleanupResources()
  app.quit()
})
