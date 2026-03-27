import { BrowserWindow } from 'electron'
import { IpcChannel } from './ipc/types'
import type { Alert, AlertCategory, AlertSeverity, WorkerStartRequest, CollectMetricsRequest, ServerHealthPayload } from './ipc/types'
import { collectMetrics } from './collectors/sqlCollector'
import { detectAndSyncReplicaRoles } from './collectors/agCollector'
import * as serverStore from './store/serverStore'
import type { ServerMetrics } from './collectors/types'
import { getAllCustomFields } from './store/dbCustomFields'
import { shouldSendDelta } from './deltaUtils'

export interface IntervalOverrides {
  activeMs: number
  idleMs: number
  offlineMs: number
  lightCollectors?: boolean
  historyCapOverride?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY = 20
const BATCH_SIZE = 30
const INTERVAL_ACTIVE_MS  = 60_000
const INTERVAL_IDLE_MS    = 300_000
const INTERVAL_OFFLINE_MS = 600_000
const BACKOFF_CAP_MS      = 3_600_000 // 1 hour max back-off
const POLL_TIMEOUT_MS     = 90_000   // max 90s per singolo job

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PollJob {
  server: CollectMetricsRequest
  nextRun: number
  priority: number // 0=active, 1=idle, 2=offline
  lastFailed: boolean
  failCount: number       // consecutive failures — drives exponential back-off
  lastSuccess: number | null  // ms timestamp of last successful collect
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const jobs = new Map<string, PollJob>()
let running = 0
let tickHandle: ReturnType<typeof setTimeout> | null = null
let activeServerId: string | null = null
let activeIntervalMs = INTERVAL_ACTIVE_MS
// Debounce handle for setActiveServer to prevent burst-fetching on rapid navigation
let activeDebounce: ReturnType<typeof setTimeout> | null = null

const metricsHistory = new Map<string, ServerMetrics[]>()
let storedAlerts: Alert[] = []
let alertCounter = 0

// Track previous metrics for delta computation
const previousMetrics = new Map<string, ServerMetrics>()

let alertCallback: ((alert: Alert) => void) | null = null
let intervalOverrides: IntervalOverrides | null = null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serverId(ip: string, port: number): string {
  return `${ip}:${port}`
}

function nextAlertId(): string {
  return `alert-${Date.now()}-${++alertCounter}`
}

function pushToRenderer(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, data)
  })
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

function computeDelta(sid: string, fresh: ServerMetrics): ServerMetrics {
  const prev = previousMetrics.get(sid)
  previousMetrics.set(sid, fresh)
  if (!prev) return fresh // first time: send full

  const freshNames = new Set(fresh.databases.map((d) => d.name))
  const removedDbs = prev.databases.map((d) => d.name).filter((n) => !freshNames.has(n))

  const changedDbs = fresh.databases.filter((db) => {
    const prevDb = prev.databases.find((d) => d.name === db.name)
    return (
      !prevDb ||
      prevDb.sizeMb    !== db.sizeMb    ||
      prevDb.logSizeMb !== db.logSizeMb ||
      prevDb.stateDesc !== db.stateDesc
    )
  })

  if (shouldSendDelta(changedDbs.length + removedDbs.length, fresh.databases.length + removedDbs.length)) {
    return { ...fresh, databases: changedDbs, isDelta: true, removedDbs }
  }
  return fresh
}

// ---------------------------------------------------------------------------
// Alert evaluation
// ---------------------------------------------------------------------------

function evaluateAlerts(sid: string, metrics: ServerMetrics): Alert[] {
  const alerts: Alert[] = []
  const now = new Date()

  function make(category: AlertCategory, severity: AlertSeverity, message: string): Alert {
    return { id: nextAlertId(), serverId: sid, category, severity, message, detectedAt: now, acknowledgedAt: null }
  }

  // CPU
  const cpu = metrics.instanceInfo.cpuUsagePercent
  if (cpu > 90) {
    alerts.push(make('cpu_high', 'CRITICAL', `CPU al ${cpu.toFixed(1)}% (soglia: 90%)`))
  } else if (cpu > 70) {
    alerts.push(make('cpu_high', 'WARNING', `CPU al ${cpu.toFixed(1)}% (soglia: 70%)`))
  }

  // Sessioni bloccate
  const blocked = metrics.activeSessions.filter((s) => s.blockingSessionId > 0)
  if (blocked.length > 0) {
    const severity: AlertSeverity = blocked.length >= 5 ? 'CRITICAL' : 'WARNING'
    alerts.push(make('blocking_sessions', severity, `${blocked.length} sessione/i bloccata/e`))
  }

  // Database offline
  const offlineDBs = metrics.databases.filter((d) => d.stateDesc === 'OFFLINE')
  if (offlineDBs.length > 0) {
    alerts.push(
      make('database_offline', 'CRITICAL', `DB offline: ${offlineDBs.map((d) => d.name).join(', ')}`)
    )
  }

  // Backup scaduto
  const MS_24H = 86_400_000
  const overdueDBs = metrics.backupStatus
    .filter((b) => !b.lastFullBackup || Date.now() - new Date(b.lastFullBackup).getTime() > MS_24H)
    .map((b) => b.databaseName)
  if (overdueDBs.length > 0) {
    alerts.push(
      make('backup_overdue', 'WARNING', `Backup full scaduto/assente: ${overdueDBs.join(', ')}`)
    )
  }

  // Spazio disco volumi
  const diskVolumes = metrics.diskVolumes ?? []
  const criticalVolumes = diskVolumes.filter((v) => v.free_pct < 10)
  const warnVolumes = diskVolumes.filter((v) => v.free_pct >= 10 && v.free_pct < 30)

  if (criticalVolumes.length > 0) {
    const desc = criticalVolumes
      .map((v) => `${v.volume_mount_point} (${v.free_pct.toFixed(1)}% libero)`)
      .join(', ')
    alerts.push(make('disk_space_low', 'CRITICAL', `Volume spazio critico: ${desc}`))
  }
  if (warnVolumes.length > 0) {
    const desc = warnVolumes
      .map((v) => `${v.volume_mount_point} (${v.free_pct.toFixed(1)}% libero)`)
      .join(', ')
    alerts.push(make('disk_space_low', 'WARNING', `Volume spazio in esaurimento: ${desc}`))
  }

  // Autogrowth disabilitato con poco spazio
  const databaseFiles = metrics.databaseFiles ?? []
  const noGrowthLowSpace = databaseFiles.filter((f) => f.growth === 0 && f.free_mb < 100)
  if (noGrowthLowSpace.length > 0) {
    const desc = noGrowthLowSpace
      .map((f) => `${f.database_name} (${f.type_desc}): ${f.free_mb.toFixed(0)} MB liberi`)
      .join(', ')
    alerts.push(make('disk_space_low', 'WARNING', `Autogrowth disabilitato: ${desc}`))
  }

  return alerts
}

function processAlerts(sid: string, metrics: ServerMetrics): void {
  const candidates = evaluateAlerts(sid, metrics)
  for (const alert of candidates) {
    const key = `${alert.serverId}:${alert.category}:${alert.severity}`
    const hasOpen = storedAlerts.some(
      (a) => a.acknowledgedAt === null && `${a.serverId}:${a.category}:${a.severity}` === key
    )
    if (!hasOpen) {
      storedAlerts.push(alert)
      pushToRenderer(IpcChannel.ALERT_NEW, alert)
      if (alertCallback) alertCallback(alert)
    }
  }
}

// ---------------------------------------------------------------------------
// Poll job execution
// ---------------------------------------------------------------------------

async function runJob(sid: string, job: PollJob): Promise<void> {
  const allCustomFields = getAllCustomFields()
  const hasVisibleWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible())
  try {
    const metrics = await Promise.race([
      collectMetrics(job.server),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('poll timeout')), POLL_TIMEOUT_MS)
      ),
    ])

    // Merge campi custom (alias, referente) nei DatabaseInfo prima di pushare al renderer
    let enrichedMetrics: ServerMetrics = {
      ...metrics,
      databases: metrics.databases.map((db) => ({
        ...db,
        ...(allCustomFields[`${sid}/${db.name}`] ?? {})
      }))
    }

    if (intervalOverrides?.lightCollectors) {
      // Strip fields not needed for alert evaluation; reduces IPC payload and history memory.
      // Note: full T-SQL query skipping (collectMetricsCritical) is deferred.
      enrichedMetrics = {
        ...enrichedMetrics,
        topQueries: [],
        waitStats: [],
        databaseFiles: [],
      }
    }

    // Rolling history
    const cap = intervalOverrides?.historyCapOverride ?? MAX_HISTORY
    const hist = metricsHistory.get(sid) ?? []
    hist.push(enrichedMetrics)
    while (hist.length > cap) hist.shift()
    metricsHistory.set(sid, hist)

    const delta = computeDelta(sid, enrichedMetrics)
    if (hasVisibleWindow) {
      pushToRenderer(IpcChannel.METRICS_UPDATED, { serverId: sid, metrics: delta })
    }
    processAlerts(sid, enrichedMetrics)

    // CPU count persistence — save logicalCpus/physicalCpus to electron-store if changed.
    // These values rarely change (only on hardware upgrade) so the write is infrequent.
    const { logicalCpus, physicalCpus } = enrichedMetrics.instanceInfo
    if (logicalCpus > 0) {
      const srvRecord = serverStore.getByIpPort(job.server.ip, job.server.port)
      if (srvRecord && (srvRecord.logicalCpus !== logicalCpus || srvRecord.physicalCpus !== physicalCpus)) {
        serverStore.update(srvRecord.id, { logicalCpus, physicalCpus })
        pushToRenderer(IpcChannel.SERVER_CONFIG_UPDATED, [{ ...srvRecord, logicalCpus, physicalCpus }])
      }
    }

    // AG detection — fire-and-forget: update agGroupId/agName/agRole for all
    // replicas found from this server; push changed records to renderer.
    // Errors are swallowed silently (server not in AG / no permissions).
    detectAndSyncReplicaRoles(job.server)
      .then((updated) => {
        if (updated.length > 0) {
          pushToRenderer(IpcChannel.SERVER_CONFIG_UPDATED, updated)
        }
      })
      .catch(() => {}) // not in AG or insufficient permissions — silent

    // Reset circuit-breaker on success
    job.lastFailed  = false
    job.failCount   = 0
    job.lastSuccess = Date.now()
    const ov = intervalOverrides
    if (ov) {
      job.nextRun = Date.now() + (job.priority === 0 ? ov.activeMs : ov.idleMs)
    } else {
      job.nextRun = Date.now() + (job.priority === 0 ? activeIntervalMs : INTERVAL_IDLE_MS)
    }
  } catch (err) {
    console.error(`[Worker] ${sid}:`, err instanceof Error ? err.message : err)
    job.lastFailed = true
    job.failCount  = (job.failCount ?? 0) + 1
    // Exponential back-off: 600s, 1200s, 2400s … capped at 1h
    const backoff = INTERVAL_OFFLINE_MS * Math.pow(2, job.failCount - 1)
    job.nextRun = Date.now() + Math.min(backoff, BACKOFF_CAP_MS)
  } finally {
    // Always push health state so the UI can show retry info
    const health: ServerHealthPayload = {
      serverId:    sid,
      failCount:   job.failCount,
      nextRetry:   job.nextRun,
      lastSuccess: job.lastSuccess
    }
    if (hasVisibleWindow) {
      pushToRenderer(IpcChannel.SERVER_HEALTH_UPDATE, health)
    }
    // ALERT_NEW is always sent — feeds alertCallback in BackgroundService
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

function scheduleTick(): void {
  if (tickHandle) clearTimeout(tickHandle)
  if (jobs.size === 0) return

  const now = Date.now()
  const dueSorted = [...jobs.values()]
    .filter((j) => j.nextRun <= now)
    .sort((a, b) => a.priority - b.priority)

  for (const job of dueSorted) {
    if (running >= BATCH_SIZE) break
    running++
    const sid = serverId(job.server.ip, job.server.port)
    runJob(sid, job).finally(() => {
      // Guard against negative counter when stopWorker() races an in-flight job
      if (running > 0) running--
      scheduleTick()
    })
  }

  // Schedule next tick at the nearest nextRun
  const nextMs = Math.min(...[...jobs.values()].map((j) => j.nextRun))
  const delay = Math.max(nextMs - Date.now(), 1_000)
  tickHandle = setTimeout(scheduleTick, delay)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startWorker(req: WorkerStartRequest): void {
  stopWorker()
  activeIntervalMs = Math.max(30_000, Math.min(300_000, req.intervalSeconds * 1000))
  if (req.activeServerId) activeServerId = req.activeServerId
  for (const srv of req.servers) {
    const sid = serverId(srv.ip, srv.port)
    jobs.set(sid, {
      server: srv,
      nextRun: Date.now(),
      priority: sid === activeServerId ? 0 : 1,
      lastFailed: false,
      failCount: 0,
      lastSuccess: null
    })
  }
  scheduleTick()
}

export function setActiveServer(sid: string): void {
  activeServerId = sid

  // Update priorities synchronously so the next tick respects the change
  for (const [id, job] of jobs) {
    if (id === sid) {
      job.priority = 0
    } else if (job.priority === 0) {
      job.priority = job.lastFailed ? 2 : 1
    }
  }

  // Debounce the "fetch immediately" trigger — prevents burst when user
  // scrolls quickly through the server list (each click would otherwise
  // schedule an instant fetch, filling all BATCH_SIZE slots)
  if (activeDebounce) clearTimeout(activeDebounce)
  activeDebounce = setTimeout(() => {
    activeDebounce = null
    const job = jobs.get(sid)
    if (job) {
      job.nextRun = Date.now()
      scheduleTick()
    }
  }, 300)
}

export function stopWorker(): void {
  if (tickHandle)      { clearTimeout(tickHandle); tickHandle = null }
  if (activeDebounce)  { clearTimeout(activeDebounce); activeDebounce = null }
  jobs.clear()
  running = 0
  previousMetrics.clear()
}

/**
 * UPSERT the server list without a full restart.
 * - New servers are added and scheduled immediately.
 * - Removed servers are dropped (in-flight jobs for them will be no-ops since
 *   the job reference is gone from the map).
 * - Existing servers retain their failCount / lastSuccess state.
 */
export function syncServers(servers: CollectMetricsRequest[]): void {
  const incoming = new Set(servers.map((s) => serverId(s.ip, s.port)))

  // Add new servers
  for (const srv of servers) {
    const sid = serverId(srv.ip, srv.port)
    if (!jobs.has(sid)) {
      jobs.set(sid, {
        server: srv,
        nextRun: Date.now(),
        priority: sid === activeServerId ? 0 : 1,
        lastFailed: false,
        failCount: 0,
        lastSuccess: null
      })
    } else {
      // Keep state but refresh credentials (may have changed)
      jobs.get(sid)!.server = srv
    }
  }

  // Remove deleted servers
  for (const sid of jobs.keys()) {
    if (!incoming.has(sid)) {
      jobs.delete(sid)
      previousMetrics.delete(sid)
    }
  }

  scheduleTick()
}

export function getAlerts(): Alert[] {
  return [...storedAlerts]
}

export function acknowledgeAlert(alertId: string): boolean {
  const alert = storedAlerts.find((a) => a.id === alertId)
  if (!alert) return false
  alert.acknowledgedAt = new Date()
  return true
}

export function getHistory(ip: string, port: number): ServerMetrics[] {
  return [...(metricsHistory.get(serverId(ip, port)) ?? [])]
}

/**
 * Register a callback invoked for each genuinely new alert (post-dedup).
 * Calling a second time silently replaces the previous callback.
 */
export function onAlert(cb: (alert: Alert) => void): void {
  alertCallback = cb
}

export function setIntervalOverrides(overrides: IntervalOverrides | null): void {
  intervalOverrides = overrides
  if (overrides !== null) {
    // Stagger all jobs across [now, now + N/2] to prevent thundering herd
    const halfInterval = overrides.idleMs / 2
    jobs.forEach((job) => {
      job.nextRun = Date.now() + Math.random() * halfInterval
    })
    // Trim history if historyCapOverride is set
    if (overrides.historyCapOverride != null) {
      const cap = overrides.historyCapOverride
      metricsHistory.forEach((hist) => {
        while (hist.length > cap) hist.shift()
      })
    }
  }
  // On null (restore): leave existing nextRun values; normal interval tiers resume naturally
}

// ---------------------------------------------------------------------------
// Test helpers — NOT for production use
// ---------------------------------------------------------------------------

export type { PollJob }

/**
 * Resets ALL module-level state.
 * Call this in beforeEach / afterEach of unit tests to get a clean slate.
 */
export function __resetForTests(): void {
  stopWorker()           // clears jobs, running, tickHandle, activeDebounce, previousMetrics
  metricsHistory.clear()
  storedAlerts = []
  alertCounter = 0
  activeServerId = null
  alertCallback = null
  intervalOverrides = null
}

/**
 * Returns a direct reference to the PollJob for a given "ip:port" key.
 * Useful for asserting priority, failCount, nextRun etc. in tests.
 * Returns undefined if the job does not exist (e.g. after stopWorker).
 */
export function __getJobForTest(sid: string): PollJob | undefined {
  return jobs.get(sid)
}

/**
 * Returns the currently registered alert callback (or null if none).
 * For testing only.
 */
export function __getAlertCallbackForTest() {
  return alertCallback
}
