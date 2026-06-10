import { app, shell, BrowserWindow, ipcMain, powerMonitor, session } from 'electron'
import type { BrowserWindow as BrowserWindowType } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'

const icon = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../resources/icon.png')
import { registerIpcHandlers } from './ipc'
import { setRendererWindow, pushToRenderer } from './ipc/push'
import { initDefaultAdmin } from './authService'
import { BackgroundService } from './backgroundService'
import type { WorkerApi } from './backgroundService'
import {
  syncServers,
  stopWorker,
  setIntervalOverrides,
  onAlert,
  setPushHandler,
  restaggerAll
} from './metricsWorker'
import { getStorageConfig } from './store/storageConfig'
import { initStoragePool, closeStoragePool, getPool } from './store/sqlserver/connection'
import { initSchema } from './store/sqlserver/database'
import { cleanup as purgeOldSnapshots } from './store/sqlserver/metricsRepository'
import { getSettings } from './store/sqlserver/settingsRepository'
import { migrateEncryptEmailPassword } from './store/sqlserver/emailSettingsRepository'
import { removeExpiredSessions } from './store/sqlserver/sessionsRepository'
import { isAvailable as safeStorageAvailable } from './utils/safeStorageUtil'
import { IpcChannel } from './ipc/types'
import { initAutoUpdate } from './autoUpdate'
import * as serverStore from './store/sqlserver/serverRepository'
import { scanHost } from './discovery/tcpScanner'
import { abortActiveStream, warmupModel } from './ai/langGraphAgent'
import {
  preWarmIndex,
  warmupEmbedder,
  importKnowledgeIfEmpty
} from './store/sqlserver/knowledgeRepository'
import { preWarm as preWarmFeedbackIndex } from './ai/feedbackIndex'
import { reloadDynamicTsqlMap } from './ai/langGraphAgent'
import { safeError as redactError } from './utils/safeLog'
import { createLogger } from './utils/logger'
import { connect, onStatusChange, serviceApi } from './serviceClient'
import { closeAllPools } from './collectors/connectionPool'
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
  // TCP probe needs no credentials — stripped view skips one DPAPI decrypt
  // per server per minute (200/min at fleet scale with getAll()).
  const servers = serverStore.getAllStripped()

  for (let i = 0; i < servers.length; i += HEALTH_CONCURRENCY) {
    const chunk = servers.slice(i, i + HEALTH_CONCURRENCY)
    await Promise.allSettled(
      chunk.map(async (server) => {
        const addr = server.host ?? server.ip
        try {
          // TCP probe with 5 s timeout — no SQL credentials needed
          await scanHost(addr, server.port, 5000)
          const now = new Date().toISOString()
          if (server.unreachable) {
            // Was marked unreachable — now back online. The transition is
            // operationally significant, so we WRITE the unreachable flag
            // synchronously and only buffer the lastSeen.
            await serverStore.update(server.id, {
              unreachable: false,
              unreachableSince: undefined
            })
            serverStore.markLastSeen(server.id, now)
            mainWindow?.webContents.send(IpcChannel.SERVER_RECOVERED, server.id)
            log.info('[HealthCheck] RECOVERED:', `${addr}:${server.port}`)
          } else {
            // Hot path: lastSeen-only update goes to the in-memory buffer.
            // Flushed every 5 min to electron-store. Cuts ~200 disk writes/min
            // (50KB each + AV scan on Windows) down to 1 every 5 min.
            serverStore.markLastSeen(server.id, now)
          }
        } catch {
          if (!server.unreachable) {
            // First failure — mark as unreachable and notify renderer
            const since = new Date().toISOString()
            await serverStore.update(server.id, { unreachable: true, unreachableSince: since })
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
    setRendererWindow(mainWindow!)
    mainWindow!.setTitle('SQL Sentinel')
    mainWindow!.show()
    if (isDev) {
      mainWindow!.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Validate scheme before opening — blocks file://, javascript:, ms-msdt:,
    // smb:, vscode:, etc. Only http/https/mailto are user-safe in this context.
    try {
      const proto = new URL(details.url).protocol
      if (proto === 'http:' || proto === 'https:' || proto === 'mailto:') {
        shell.openExternal(details.url)
      } else {
        log.warn('[main] Blocked external URL with unsafe scheme:', proto)
      }
    } catch {
      log.warn('[main] Blocked malformed external URL')
    }
    return { action: 'deny' }
  })

  // H10: renderer crash recovery — without this, a crashed renderer leaves
  // the user staring at a blank window with no recovery path.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error(`[main] Renderer process gone — reason=${details.reason}`)
    if (details.reason === 'clean-exit' || details.reason === 'killed') return
    // Reload the renderer; main-process state is preserved.
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.reload()
      } catch (err) {
        log.error('[main] Reload after crash failed:', err)
      }
    }
  })

  // Same scheme allow-list for renderer-initiated navigations
  const appIndexUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const proto = new URL(url).protocol
      // Allow internal app reload (dev-server URL); block others.
      const devOrigin = process.env['ELECTRON_RENDERER_URL']
      if (devOrigin && url.startsWith(devOrigin)) return
      // For file:, only allow navigating to our own bundled index.html (optionally
      // with a hash/query for client-side routing) — not arbitrary local paths.
      if (proto === 'file:') {
        const target = url.split(/[?#]/)[0]
        if (target === appIndexUrl) return
        event.preventDefault()
        return
      }
      event.preventDefault()
      if (proto === 'http:' || proto === 'https:' || proto === 'mailto:') {
        shell.openExternal(url)
      }
    } catch {
      event.preventDefault()
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// PROD-5: single-instance lock — prevents two app instances on the same user
// session from racing on electron-store writes. The second instance signals
// the first to focus and exits.
const gotInstanceLock = app.requestSingleInstanceLock()
if (!gotInstanceLock) {
  log.warn('[main] Another instance is already running — exiting')
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  // Initialize SQL Server storage pool first — the server registry now lives
  // there too, so we cannot load the cache (or run migrations) before the pool
  // and schema are up.
  const storageCfg = getStorageConfig()
  // Valorizzato se pool/schema/migrazioni falliscono: il probe getPool() in
  // did-finish-load non basta — il pool può essere connesso anche quando
  // initSchema è esploso a metà, e il renderer mostrerebbe un'app "sana" con
  // registry vuoto e zero indicazioni per l'utente.
  let storageInitError: string | null = null
  if (storageCfg) {
    try {
      await initStoragePool(storageCfg)
      await initSchema()
      await serverStore.init()
      serverStore.migrateHostField()
      // These three only touch their own tables (servers, users,
      // email_settings respectively) and only depend on serverStore.init()
      // having populated the cache — they can run concurrently to overlap
      // their network round-trips on remote SQL Servers.
      await Promise.all([
        serverStore.migrateEncryptCredentials(),
        initDefaultAdmin(),
        migrateEncryptEmailPassword()
      ])
      // One-shot import of the SQLite knowledge_base.db build artifact into
      // the dbo.knowledge_* / dbo.dba_cards tables. Idempotent — skipped if
      // the destination already has rows. Deferred to run after createWindow
      // so it doesn't block the login screen; the renderer's AI Assistant is
      // the only consumer and isn't reachable until after login.
      setImmediate(() => {
        importKnowledgeIfEmpty().catch((err) => {
          log.warn('[main] knowledge base import failed:', redactError(err))
        })
      })
    } catch (err) {
      log.error('[main] Storage pool init failed:', redactError(err))
      storageInitError = err instanceof Error ? err.message : String(err)
    }
  }

  // Purge snapshots older than the configured retention: once at boot, then every 24 h.
  const retentionDays = async (): Promise<number> => {
    try {
      const s = await getSettings()
      return s.retentionMinutes / (60 * 24)
    } catch {
      return 1
    }
  }
  const deferredPurge = (): void => {
    setImmediate(async () => {
      const days = await retentionDays()
      try {
        await purgeOldSnapshots(days)
      } catch (err) {
        log.warn('[main] purgeOldSnapshots:', err)
      }
      try {
        await removeExpiredSessions()
      } catch (err) {
        log.warn('[main] removeExpiredSessions:', err)
      }
    })
  }
  deferredPurge()
  deferredPurgeIntervalId = setInterval(deferredPurge, 24 * 60 * 60 * 1000)

  // Migrations are already invoked above, right after initDb() — no need to
  // run them a second time. Each migration scans the full electron-store
  // payload and is harmless when re-run, but the duplicate adds ~5-15 ms to
  // cold start on a 200-server file.

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

  // On non-Windows (dev/macOS), spawn service as child process using Electron's Node
  if (process.platform !== 'win32') {
    const { fork } = await import('node:child_process')
    const servicePath = join(__dirname, '../../out/service/index.js')
    const svc = fork(servicePath, [], { silent: true, execPath: process.execPath, execArgv: [] })
    svc.stdout?.on('data', (d: Buffer) => process.stdout.write(d))
    svc.stderr?.on('data', (d: Buffer) => process.stderr.write(d))
    svc.on('exit', (code) => log.warn(`[main] service exited with code ${code}`))
    // Wait for service to start before connecting WebSocket
    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
  }

  // Connect to Windows Service and migrate servers on first connect
  connect()
  // Forward service connection status to the renderer so it can stand down its
  // in-process metrics worker while the service is the authoritative collector.
  // Without this, the app and the service would poll every monitored SQL Server
  // simultaneously (2× query load, duplicate metric rows).
  onStatusChange((status) => {
    pushToRenderer(IpcChannel.SERVICE_STATUS_CHANGED, status)
  })
  onStatusChange(async (status) => {
    if (status !== 'connected') return
    if (process.platform !== 'win32') return
    try {
      const serviceServers = await serviceApi.getServers()
      const localServers = serverStore.getAll()
      if ((serviceServers.data as unknown[]).length === 0 && localServers.length > 0) {
        await serviceApi.migrateServers(
          localServers.map((s) => ({
            id: s.id,
            host: s.host,
            port: s.port,
            instanceName: s.instanceName,
            useWindowsAuth: s.useWindowsAuth,
            username: s.username,
            password: s.password,
            addedAt: s.addedAt,
            hostingType: s.hostingType,
            notes: s.notes
          }))
        )
      }
    } catch (err) {
      log.error('[index] Migration error:', err)
    }
  })

  // Pre-load the LLM into Ollama memory so the first AI query is fast
  warmupModel()
  preWarmIndex()
  warmupEmbedder()
  // Load AI feedback (positive thumbs-up examples) and dynamic T-SQL map overlay
  // — best-effort: they depend on SQL Server storage being configured.
  preWarmFeedbackIndex().catch((err) => log.warn('[main] preWarmFeedbackIndex:', err))
  reloadDynamicTsqlMap().catch((err) => log.warn('[main] reloadDynamicTsqlMap:', err))

  setPushHandler((channel, data) => {
    BrowserWindow.getAllWindows().forEach((w) => {
      // Don't gate on isVisible(): WorkerContext already buffers events when
      // document.hidden is true, so filtering here only drops events without
      // saving IPC budget. A minimized window still needs to receive updates
      // so the store stays current when the user brings it back.
      if (!w.isDestroyed()) w.webContents.send(channel, data)
    })
  })

  // Enforce CSP at the header level too, not just the <meta> tag — a header
  // can't be stripped by tampering with the bundled HTML, and it covers
  // responses the meta tag doesn't. Kept in sync with renderer/index.html.
  //
  // In dev (renderer servito da Vite) header e meta vengono rilassati allo
  // stesso modo: il preamble react-refresh è uno script inline e l'HMR usa un
  // WebSocket — con la CSP di produzione il renderer resta bianco. Header e
  // meta si INTERSECANO (vince il più severo), quindi il rilassamento deve
  // avvenire in entrambi (il meta è gestito dal plugin relax-csp-for-dev in
  // electron.vite.config.ts).
  const isDevRenderer = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
  const CSP = isDevRenderer
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self' ws:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP]
      }
    })
  })

  createWindow()

  // Background auto-update via GitHub Releases (no-op in dev / unpackaged).
  initAutoUpdate()

  // Notify renderer of storage readiness after the window loads
  mainWindow?.webContents.on('did-finish-load', () => {
    if (!storageCfg) {
      mainWindow?.webContents.send('storage:not-configured', {})
    } else if (storageInitError) {
      // Pool su ma schema/migrazioni falliti (o pool mai aperto): senza questo
      // ramo l'app sembrava sana — registry vuoto, monitoring morto, zero errori.
      mainWindow?.webContents.send('storage:not-configured', { error: storageInitError })
    } else {
      try {
        getPool()
        mainWindow?.webContents.send('storage:configured', {})
      } catch {
        mainWindow?.webContents.send('storage:not-configured', {
          error: 'Could not connect to storage database'
        })
      }
    }
  })

  // H8: power suspend/resume — without this, on resume every job's nextRun is
  // in the past, triggering a thundering herd against every monitored server
  // simultaneously while every cached pool's underlying socket is dead.
  powerMonitor.on('resume', async () => {
    log.info('[main] System resumed — closing pools and re-staggering jobs')
    try {
      // reopen: true — the process keeps running, so the pool module must
      // accept new connections after the dead post-sleep sockets are closed.
      await closeAllPools({ reopen: true })
    } catch (err) {
      log.warn('[main] closeAllPools on resume:', err)
    }
    // restaggerAll() actively spreads every existing job's nextRun across
    // the polling interval. The previous implementation called syncServers()
    // expecting it to re-stagger, but syncServers only handles add/remove —
    // existing jobs kept their stale nextRun and fired in 30-job waves.
    try {
      restaggerAll()
    } catch (err) {
      log.warn('[main] restaggerAll on resume:', err)
    }
  })

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
  // Stop the metrics worker so any in-flight collect aborts cleanly.
  try {
    stopWorker()
  } catch (err) {
    log.warn('[main] stopWorker on shutdown:', err)
  }
  // Final flush of buffered lastSeen updates so the server registry on disk
  // reflects reality post-shutdown (within the last health-check cycle).
  try {
    serverStore.flushLastSeenBuffer()
    serverStore.stopLastSeenFlushTimer()
  } catch (err) {
    log.warn('[main] flushLastSeenBuffer:', err)
  }
  closeStoragePool().catch((err) => log.warn('[main] closeStoragePool:', err))
  closeAllPools().catch((err) => log.warn('[main] closeAllPools:', err))
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
  if (backgroundService) backgroundService.quitting = true
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
