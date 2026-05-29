import { createLogger } from './utils/logger'
const log = createLogger('metrics-worker')
import { IpcChannel } from './ipc/types'
import type {
  Alert,
  AlertCategory,
  AlertSeverity,
  WorkerStartRequest,
  CollectMetricsRequest,
  ServerHealthPayload
} from './ipc/types'
import { collectMetrics, collectMetricsCritical } from './collectors/sqlCollector'
import { detectAndSyncReplicaRoles } from './collectors/agCollector'
import * as serverStore from './store/sqlserver/serverRepository'
import * as metricsRepository from './store/sqlserver/metricsRepository'
import * as serverDatabasesRepository from './store/sqlserver/serverDatabasesRepository'
import { getSettings } from './store/sqlserver/settingsRepository'
import type { ServerMetrics } from './collectors/types'
import { getAllCustomFields } from './store/sqlserver/dbCustomFieldsRepository'
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

// Main-process ring buffer cap. Renderer keeps its own deeper history
// (60 active / 10 idle) for charts; the main copy is needed only for
// IPC seed at boot + delta computation. 5 entries cover the boot
// sparkline window (~5 min @ 60s polling); after that the renderer's
// own buffer takes over. Was 20 — wasted ~90MB RAM at 200 servers.
const MAX_HISTORY = 5
const BATCH_SIZE = 30
const SYSTEM_DBS = new Set(['master', 'tempdb', 'model', 'msdb', 'distribution'])
const INTERVAL_ACTIVE_MS = 60_000
const INTERVAL_IDLE_MS = 300_000
const INTERVAL_OFFLINE_MS = 600_000
const BACKOFF_CAP_MS = 3_600_000 // 1 hour max back-off
const POLL_TIMEOUT_MS = 90_000 // max 90s per single job
const SAVE_EVERY_N = 5 // save to SQLite every N polls (≈5 min at 60s interval)
// Flush window: was 5 min, lowered to 60s so a hard crash loses at most ~1 min
// of metrics instead of 5. The hard cap below also forces an early flush when
// the queue grows beyond a sane size (e.g. 200 servers × N polls in flight).
const SAVE_FLUSH_MS = 60_000
const SAVE_QUEUE_HARD_CAP = 500
const AG_DETECT_EVERY_N = 5 // detect AG roles every N polls — roles change only on failover

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PollJob {
  server: CollectMetricsRequest
  nextRun: number
  priority: number // 0=active, 1=idle, 2=offline
  lastFailed: boolean
  failCount: number // consecutive failures — drives exponential back-off
  lastSuccess: number | null // ms timestamp of last successful collect
  pollCount: number // total successful polls — drives SAVE_EVERY_N logic
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
// O(1) dedup: map of `${serverId}:${category}:${severity}` → alert id, only
// for alerts with acknowledgedAt === null. Prevents the previous O(N) .some()
// scan inside the hot processAlerts() path.
const openAlertKeys = new Map<string, string>()
// Hard cap: with 200 servers × 5 categories × 2 severities = 2000 possible
// open alerts, but in practice a healthy fleet stays under 50. The cap exists
// for runaway scenarios (e.g. flapping fleet during an incident) so the
// memory footprint stays bounded.
const MAX_STORED_ALERTS = 1000

// --- SQLite persistence ---
const saveQueue: metricsRepository.SaveItem[] = []
let saveFlushTimer: ReturnType<typeof setTimeout> | null = null

// Track previous metrics for delta computation
const previousMetrics = new Map<string, ServerMetrics>()

// Track when each DB first went non-ONLINE: serverId → dbName → ISO 8601 timestamp
const dbOfflineTimestamps = new Map<string, Map<string, string>>()

// Batch buffer: coalesce per-server metrics pushes.
// The macroscopic debounce window (BATCH_FLUSH_MS) groups all jobs that
// complete within that window into a single IPC call — with 30 async I/O jobs
// completing at different times, we go from ~30 IPC calls to 1-2 per poll cycle.
const BATCH_FLUSH_MS = 50
const pendingBatch: Array<{ serverId: string; metrics: ServerMetrics }> = []
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null

let alertCallback: ((alert: Alert) => void) | null = null
let incidentAlertCallback: ((alert: Alert) => void) | null = null
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

// Injectable push handler — set by the host process (Electron or service)
let _pushHandler: (channel: string, data: unknown) => void = () => {}

export function setPushHandler(fn: (channel: string, data: unknown) => void): void {
  _pushHandler = fn
}

function pushToRenderer(channel: string, data: unknown): void {
  _pushHandler(channel, data)
}

function flushMetricsBatch(): void {
  batchFlushTimer = null
  if (pendingBatch.length === 0) return
  const batch = pendingBatch.splice(0)
  pushToRenderer(IpcChannel.METRICS_BATCH_UPDATED, batch)
}

function enqueueBatchPush(sid: string, metrics: ServerMetrics): void {
  pendingBatch.push({ serverId: sid, metrics })
  if (batchFlushTimer === null) {
    batchFlushTimer = setTimeout(flushMetricsBatch, BATCH_FLUSH_MS)
  }
}

// ---------------------------------------------------------------------------
// SQLite persistence helpers
// ---------------------------------------------------------------------------

// Dead-letter buffer for batches that failed to persist. We retry on the next
// flush; if persistence keeps failing for ~5 cycles we drop the oldest items so
// the buffer can't grow unbounded.
const failedBatches: metricsRepository.SaveItem[][] = []
const MAX_FAILED_BATCHES = 5

async function flushSaveQueue(): Promise<void> {
  saveFlushTimer = null
  if (saveQueue.length === 0 && failedBatches.length === 0) return

  // Snapshot what we'll persist BEFORE removing it from the queue. Previously
  // we spliced first and persisted second — on batchSave failure the items
  // were already gone, losing minutes of metrics across the fleet.
  const toFlush = saveQueue.slice(0)
  // Combine pending retry batches with the new items.
  const allBatches = [...failedBatches, toFlush.length > 0 ? toFlush : null].filter(
    (b): b is metricsRepository.SaveItem[] => b !== null && b.length > 0
  )
  if (allBatches.length === 0) return

  // Reset the failed buffer; we'll re-populate on retry.
  failedBatches.length = 0

  let anyFailed = false
  for (const batch of allBatches) {
    try {
      await metricsRepository.batchSave(batch)
    } catch (err) {
      log.error('[worker] batch save failed, will retry:', err)
      // Hold onto the batch for the next flush. Drop the OLDEST batch if we
      // exceed the retry budget so a permanently failing storage can't OOM us.
      if (failedBatches.length >= MAX_FAILED_BATCHES) {
        const dropped = failedBatches.shift()
        log.warn(`[worker] DLQ overflow: dropping oldest batch of ${dropped?.length ?? 0} item(s)`)
      }
      failedBatches.push(batch)
      anyFailed = true
    }
  }

  // Only consume the live queue if it was successfully persisted (or the
  // failure was already recorded in failedBatches).
  if (toFlush.length > 0) {
    saveQueue.splice(0, toFlush.length)
  }

  // If anything failed, schedule a retry on the next regular flush window.
  if (anyFailed && !saveFlushTimer) {
    saveFlushTimer = setTimeout(scheduleFlushSaveQueue, SAVE_FLUSH_MS)
  }
}

function scheduleFlushSaveQueue(): void {
  void flushSaveQueue()
}

function queueSave(srv: CollectMetricsRequest, metrics: ServerMetrics): void {
  // Hot path: only needs the record id — skip DPAPI decrypt entirely.
  const record = serverStore.getStrippedByIpPort(srv.ip, srv.port)
  if (!record) return
  saveQueue.push({ serverId: record.id, metrics })
  // Hard cap: force an immediate flush instead of letting the queue grow
  // unbounded if SAVE_FLUSH_MS hasn't elapsed yet. Protects against memory
  // bloat when many servers save simultaneously after a long offline window.
  if (saveQueue.length >= SAVE_QUEUE_HARD_CAP) {
    if (saveFlushTimer) {
      clearTimeout(saveFlushTimer)
      saveFlushTimer = null
    }
    void flushSaveQueue()
    return
  }
  if (!saveFlushTimer) {
    saveFlushTimer = setTimeout(scheduleFlushSaveQueue, SAVE_FLUSH_MS)
  }
}

async function loadHistoryFromDb(servers: CollectMetricsRequest[]): Promise<void> {
  // Deferred cleanup to next tick: with large DBs (months of snapshots) the
  // DELETE can block for 500ms-2s and delay the first polling cycle.
  // cleanup yields between batches — fire-and-forget so the history seed
  // doesn't wait on it.
  setImmediate(() => {
    void (async () => {
      try {
        const retentionMinutes = (await getSettings()).retentionMinutes
        const retentionDays = retentionMinutes / (60 * 24)
        await metricsRepository.cleanup(retentionDays)
      } catch (err) {
        log.warn('[worker] retention cleanup:', err)
      }
    })()
  })

  // Build the recordId→sid map once. We only need ids — skip DPAPI decrypts.
  // Reading getAllStripped() once is also faster than per-server getByIpPort.
  const recordIdToSid = new Map<string, string>()
  const allRecords = serverStore.getAllStripped() ?? []
  const byHostPort = new Map<string, string>()
  for (const r of allRecords) {
    byHostPort.set(`${r.host}:${r.port}`, r.id)
  }
  for (const srv of servers) {
    const sid = serverId(srv.ip, srv.port)
    const recordId = byHostPort.get(`${srv.ip}:${srv.port}`)
    if (recordId) recordIdToSid.set(recordId, sid)
  }

  if (recordIdToSid.size > 0) {
    try {
      const allHistory = await metricsRepository.findLastNBulk(
        [...recordIdToSid.keys()],
        MAX_HISTORY
      )
      for (const [recordId, snapshots] of Object.entries(allHistory)) {
        const sid = recordIdToSid.get(recordId)
        if (sid && snapshots.length > 0) metricsHistory.set(sid, snapshots)
      }
    } catch (err) {
      log.warn('[worker] load history bulk:', err)
    }
  }
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

  // Build a Map for O(1) lookups instead of O(n) find() inside filter()
  const prevByName = new Map(prev.databases.map((d) => [d.name, d]))

  const changedDbs = fresh.databases.filter((db) => {
    const prevDb = prevByName.get(db.name)
    return (
      !prevDb ||
      prevDb.sizeMb !== db.sizeMb ||
      prevDb.logSizeMb !== db.logSizeMb ||
      prevDb.stateDesc !== db.stateDesc
    )
  })

  if (
    shouldSendDelta(
      changedDbs.length + removedDbs.length,
      fresh.databases.length + removedDbs.length
    )
  ) {
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

  function make(
    category: AlertCategory,
    severity: AlertSeverity,
    message: string,
    suggestion?: string,
    dedupTag?: string
  ): Alert {
    return {
      id: nextAlertId(),
      serverId: sid,
      category,
      severity,
      message,
      suggestion,
      dedupTag,
      detectedAt: now,
      acknowledgedAt: null
    }
  }

  // CPU
  const cpu = metrics.instanceInfo.cpuUsagePercent
  if (cpu > 90) {
    alerts.push(make('cpu_high', 'CRITICAL', `CPU at ${cpu.toFixed(1)}% (threshold: 90%)`))
  } else if (cpu > 70) {
    alerts.push(make('cpu_high', 'WARNING', `CPU at ${cpu.toFixed(1)}% (threshold: 70%)`))
  }

  // Sessioni bloccate
  const blocked = metrics.activeSessions.filter((s) => s.blockingSessionId > 0)
  if (blocked.length > 0) {
    const severity: AlertSeverity = blocked.length >= 5 ? 'CRITICAL' : 'WARNING'
    alerts.push(make('blocking_sessions', severity, `${blocked.length} blocking session(s)`))
  }

  // Database offline
  const offlineDBs = metrics.databases.filter((d) => d.stateDesc === 'OFFLINE')
  if (offlineDBs.length > 0) {
    alerts.push(
      make(
        'database_offline',
        'CRITICAL',
        `DB offline: ${offlineDBs.map((d) => d.name).join(', ')}`
      )
    )
  }

  // Overdue backup (exclude system DBs — distribution has database_id > 4 so it is not filtered by the SQL query)
  const MS_24H = 86_400_000
  const overdueDBs = (metrics.backupStatus ?? [])
    .filter((b) => !SYSTEM_DBS.has(b.databaseName))
    .filter((b) => !b.lastFullBackup || Date.now() - new Date(b.lastFullBackup).getTime() > MS_24H)
    .map((b) => b.databaseName)
  if (overdueDBs.length > 0) {
    alerts.push(
      make('backup_overdue', 'WARNING', `Full backup overdue/missing: ${overdueDBs.join(', ')}`)
    )
  }

  // Spazio disco volumi
  const diskVolumes = metrics.diskVolumes ?? []
  const databaseFiles = metrics.databaseFiles ?? []
  const criticalVolumes = diskVolumes.filter((v) => v.free_pct < 10)
  const warnVolumes = diskVolumes.filter((v) => v.free_pct >= 10 && v.free_pct < 30)

  // Returns a shrink suggestion listing the top files with reclaimable space on the given volumes
  function shrinkSuggestion(volumes: typeof diskVolumes): string | undefined {
    const mounts = volumes.map((v) => v.volume_mount_point.toLowerCase())
    const candidates = databaseFiles
      .filter((f) => {
        const path = f.physical_name.toLowerCase()
        return f.free_mb > 0 && mounts.some((m) => path.startsWith(m))
      })
      .sort((a, b) => b.free_mb - a.free_mb)
      .slice(0, 5)
    if (candidates.length === 0) return undefined
    const list = candidates
      .map((f) => `${f.database_name}/${f.file_name} (${(f.free_mb / 1024).toFixed(1)} GB free)`)
      .join(', ')
    return `Consider SHRINKFILE on: ${list}`
  }

  if (criticalVolumes.length > 0) {
    const desc = criticalVolumes
      .map((v) => `${v.volume_mount_point} (${v.free_pct.toFixed(1)}% free)`)
      .join(', ')
    alerts.push(
      make(
        'disk_space_low',
        'CRITICAL',
        `Volume space critical: ${desc}`,
        shrinkSuggestion(criticalVolumes),
        'volume'
      )
    )
  }
  if (warnVolumes.length > 0) {
    const desc = warnVolumes
      .map((v) => `${v.volume_mount_point} (${v.free_pct.toFixed(1)}% free)`)
      .join(', ')
    alerts.push(
      make(
        'disk_space_low',
        'WARNING',
        `Volume space running low: ${desc}`,
        shrinkSuggestion(warnVolumes),
        'volume'
      )
    )
  }

  // Autogrowth disabled with low available space. Distinct dedupTag so this
  // WARNING isn't suppressed by the warn-volume WARNING (same category/severity).
  const noGrowthLowSpace = databaseFiles.filter((f) => f.growth === 0 && f.free_mb < 100)
  if (noGrowthLowSpace.length > 0) {
    const desc = noGrowthLowSpace
      .map((f) => `${f.database_name} (${f.type_desc}): ${f.free_mb.toFixed(0)} MB free`)
      .join(', ')
    alerts.push(
      make('disk_space_low', 'WARNING', `Autogrowth disabled: ${desc}`, undefined, 'autogrowth')
    )
  }

  return alerts
}

/** Dedup key — includes dedupTag so distinct same-category/severity conditions
 * (e.g. low-volume vs autogrowth) don't suppress each other. */
function alertKey(a: Alert): string {
  return `${a.serverId}:${a.category}:${a.severity}:${a.dedupTag ?? ''}`
}

function processAlerts(sid: string, metrics: ServerMetrics): void {
  const candidates = evaluateAlerts(sid, metrics)
  for (const alert of candidates) {
    const key = alertKey(alert)
    if (openAlertKeys.has(key)) continue // dedup hit, skip
    storedAlerts.push(alert)
    openAlertKeys.set(key, alert.id)
    pushToRenderer(IpcChannel.ALERT_NEW, alert)
    if (alertCallback) alertCallback(alert)
    if (incidentAlertCallback) incidentAlertCallback(alert)
  }

  // Prune acknowledged alerts older than 24 h to keep storedAlerts bounded
  const pruneOlderThan = Date.now() - 24 * 60 * 60 * 1000
  const beforeLen = storedAlerts.length
  storedAlerts = storedAlerts.filter(
    (a) => !(a.acknowledgedAt && new Date(a.acknowledgedAt).getTime() < pruneOlderThan)
  )
  if (storedAlerts.length !== beforeLen) {
    rebuildOpenAlertKeys()
  }

  // Hard cap: if open alerts exceed the cap (incident flood), drop the OLDEST
  // ones — keep the most recent context for the operator. Preserves order:
  // acknowledged first (already filtered above), then oldest open.
  if (storedAlerts.length > MAX_STORED_ALERTS) {
    storedAlerts = storedAlerts.slice(-MAX_STORED_ALERTS)
    rebuildOpenAlertKeys()
  }
}

function rebuildOpenAlertKeys(): void {
  openAlertKeys.clear()
  for (const a of storedAlerts) {
    if (a.acknowledgedAt === null) {
      openAlertKeys.set(alertKey(a), a.id)
    }
  }
}

// ---------------------------------------------------------------------------
// Poll job execution
// ---------------------------------------------------------------------------

async function runJob(sid: string, job: PollJob): Promise<void> {
  const allCustomFields = await getAllCustomFields()

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  // AbortController propagated to the collector: on timeout we close the pool immediately
  // instead of letting the TDS connection dangle until GC.
  const controller = new AbortController()
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new Error('poll timeout'))
    }, POLL_TIMEOUT_MS)
  })
  try {
    const collectFn = intervalOverrides?.lightCollectors ? collectMetricsCritical : collectMetrics
    const metrics = await Promise.race([collectFn(job.server, controller.signal), timeoutPromise])

    // Merge custom fields (alias, referente) into DatabaseInfo before pushing to the renderer
    let enrichedMetrics: ServerMetrics = {
      ...metrics,
      databases: metrics.databases.map((db) => ({
        ...db,
        ...(allCustomFields[`${sid}/${db.name}`] ?? {})
      }))
    }

    // Enrich databases with offlineSince timestamp (track first detection of non-ONLINE state)
    const offlineMap = dbOfflineTimestamps.get(sid) ?? new Map<string, string>()
    enrichedMetrics = {
      ...enrichedMetrics,
      databases: enrichedMetrics.databases.map((db) => {
        if (db.stateDesc !== 'ONLINE') {
          if (!offlineMap.has(db.name)) {
            offlineMap.set(db.name, enrichedMetrics.collectedAt.toISOString())
          }
          return { ...db, offlineSince: offlineMap.get(db.name) }
        }
        offlineMap.delete(db.name)
        return db
      })
    }
    // Prune entries for DBs that no longer exist (dropped between polls).
    // Without this the map keeps growing forever as users drop and recreate
    // databases — a dozen bytes per ghost entry but unbounded over months.
    const liveNames = new Set(enrichedMetrics.databases.map((d) => d.name))
    for (const dbName of offlineMap.keys()) {
      if (!liveNames.has(dbName)) offlineMap.delete(dbName)
    }
    dbOfflineTimestamps.set(sid, offlineMap)

    // Rolling history — we guarantee cap >= 1 so an override of 0 does not
    // let the history grow indefinitely.
    const cap = Math.max(intervalOverrides?.historyCapOverride ?? MAX_HISTORY, 1)
    const hist = metricsHistory.get(sid) ?? []
    hist.push(enrichedMetrics)
    while (hist.length > cap) hist.shift()
    metricsHistory.set(sid, hist)

    const delta = computeDelta(sid, enrichedMetrics)
    enqueueBatchPush(sid, delta)
    processAlerts(sid, enrichedMetrics)

    // Persist database list for instant availability on next startup.
    // Full snapshot: upsert all + remove stale. Delta: upsert only changed + remove dropped.
    try {
      if (!delta.isDelta) {
        await serverDatabasesRepository.upsertDatabases(sid, enrichedMetrics.databases)
        await serverDatabasesRepository.deleteStale(
          sid,
          enrichedMetrics.databases.map((d) => d.name)
        )
      } else {
        if (delta.databases.length > 0) {
          await serverDatabasesRepository.upsertDatabases(sid, delta.databases)
        }
        if (delta.removedDbs?.length) {
          await serverDatabasesRepository.deleteByNames(sid, delta.removedDbs)
        }
      }
    } catch (err) {
      log.warn('[worker] persist server_databases:', err)
    }

    // CPU count persistence — save logicalCpus/physicalCpus to electron-store if changed.
    // These values rarely change (only on hardware upgrade) so the write is infrequent.
    const { logicalCpus, physicalCpus } = enrichedMetrics.instanceInfo
    if (logicalCpus > 0) {
      // CPU update doesn't need the password — use stripped lookup to skip DPAPI.
      const srvRecord = serverStore.getStrippedByIpPort(job.server.ip, job.server.port)
      if (
        srvRecord &&
        (srvRecord.logicalCpus !== logicalCpus || srvRecord.physicalCpus !== physicalCpus)
      ) {
        await serverStore.update(srvRecord.id, { logicalCpus, physicalCpus })
        pushToRenderer(IpcChannel.SERVER_CONFIG_UPDATED, [
          { ...srvRecord, logicalCpus, physicalCpus }
        ])
      }
    }

    // AG detection — throttled to every AG_DETECT_EVERY_N polls. Replica
    // roles change only on failover/restart, so detection every ~5 minutes is
    // sufficient; on intermediate cycles we save a dedicated SQL connection
    // per server in the AG.
    if (job.pollCount % AG_DETECT_EVERY_N === 0) {
      detectAndSyncReplicaRoles(job.server)
        .then((updated) => {
          if (updated.length > 0) {
            pushToRenderer(
              IpcChannel.SERVER_CONFIG_UPDATED,
              updated.map(serverStore.stripCredentials)
            )
          }
        })
        .catch((err: unknown) => log.warn('[worker] AG sync:', err)) // not in AG or insufficient permissions
    }

    // Persist snapshot to SQLite every SAVE_EVERY_N successful polls
    job.pollCount++
    if (job.pollCount % SAVE_EVERY_N === 0) {
      queueSave(job.server, enrichedMetrics)
    }

    // Reset circuit-breaker on success
    job.lastFailed = false
    job.failCount = 0
    job.lastSuccess = Date.now()
    const ov = intervalOverrides
    if (ov) {
      job.nextRun = Date.now() + (job.priority === 0 ? ov.activeMs : ov.idleMs)
    } else {
      job.nextRun = Date.now() + (job.priority === 0 ? activeIntervalMs : INTERVAL_IDLE_MS)
    }
  } catch (err) {
    log.error(`[Worker] ${sid}:`, err)
    job.lastFailed = true
    job.failCount = (job.failCount ?? 0) + 1
    // Exponential back-off: 600s, 1200s, 2400s … capped at 1h
    const backoff = INTERVAL_OFFLINE_MS * Math.pow(2, job.failCount - 1)
    job.nextRun = Date.now() + Math.min(backoff, BACKOFF_CAP_MS)
    // After 50 consecutive failures, release ALL maps tied to the server to
    // prevent unbounded growth for long-offline servers. Previously only
    // previousMetrics was cleared, but metricsHistory and dbOfflineTimestamps
    // remained and accumulated hundreds of KB per dead server.
    if (job.failCount >= 50) {
      previousMetrics.delete(sid)
      metricsHistory.delete(sid)
      dbOfflineTimestamps.delete(sid)
    }
  } finally {
    clearTimeout(timeoutHandle)
    // Always push health state so the UI can show retry info
    const health: ServerHealthPayload = {
      serverId: sid,
      failCount: job.failCount,
      nextRetry: job.nextRun,
      lastSuccess: job.lastSuccess
    }
    pushToRenderer(IpcChannel.SERVER_HEALTH_UPDATE, health)
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

// Set to false from __resetForTests so unit tests get deterministic nextRun=now
// for every job. Production code never touches this.
let _staggerEnabled = true

export function startWorker(req: WorkerStartRequest): void {
  stopWorker()
  activeIntervalMs = Math.max(30_000, Math.min(300_000, req.intervalSeconds * 1000))
  if (req.activeServerId) activeServerId = req.activeServerId
  // Restore history before scheduling any polls — fire-and-forget so the
  // first polling cycle can fire before the DB read completes. Stale history
  // for ~1 cycle is acceptable; missing history would block dashboard load.
  void loadHistoryFromDb(req.servers).catch((err) =>
    log.warn('[worker] loadHistoryFromDb failed:', err)
  )
  // Stagger initial polls across the full interval window (except for the
  // active server, which fires immediately so the dashboard shows fresh data).
  // Without this, all N servers would queue at Date.now() and only BATCH_SIZE
  // would dispatch; the rest would wait + thunder the SQL Servers in waves.
  const stagger = _staggerEnabled && req.staggerStartup !== false
  const now = Date.now()
  for (const srv of req.servers) {
    const sid = serverId(srv.ip, srv.port)
    const isActive = sid === activeServerId
    const offset = stagger && !isActive ? Math.floor(Math.random() * activeIntervalMs) : 0
    jobs.set(sid, {
      server: srv,
      nextRun: now + offset,
      priority: isActive ? 0 : 1,
      lastFailed: false,
      failCount: 0,
      lastSuccess: null,
      pollCount: 0
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
  if (tickHandle) {
    clearTimeout(tickHandle)
    tickHandle = null
  }
  if (activeDebounce) {
    clearTimeout(activeDebounce)
    activeDebounce = null
  }
  if (saveFlushTimer) {
    clearTimeout(saveFlushTimer)
    saveFlushTimer = null
    void flushSaveQueue()
  }
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
/**
 * Re-stagger every existing job's nextRun across the active interval window.
 * Called on power resume: after a long sleep every job's nextRun is far in
 * the past, so without re-staggering scheduleTick would drain 30 jobs/sec
 * causing a thundering herd of 200 simultaneous TLS+TDS handshakes against
 * the entire fleet (with pool sockets just killed by the OS sleep).
 */
export function restaggerAll(): void {
  const now = Date.now()
  for (const job of jobs.values()) {
    const isActive = job.priority === 0
    const offset = isActive ? 0 : Math.floor(Math.random() * activeIntervalMs)
    job.nextRun = now + offset
    // Reset failCount so a server that was OK pre-sleep doesn't stay in
    // exponential backoff forever just because it was caught with a stale
    // socket on the first post-resume probe.
    job.failCount = 0
    job.lastFailed = false
  }
  scheduleTick()
}

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
        lastSuccess: null,
        pollCount: 0
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
      metricsHistory.delete(sid)
      dbOfflineTimestamps.delete(sid)
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
  // Drop from the dedup map so a fresh alert in the same category can re-fire
  // immediately after the operator acknowledges. Without this, the dedup
  // would keep blocking new alerts indefinitely.
  openAlertKeys.delete(alertKey(alert))
  return true
}

export function getHistory(ip: string, port: number): ServerMetrics[] {
  return [...(metricsHistory.get(serverId(ip, port)) ?? [])]
}

/**
 * Returns the entire history map (sid → ServerMetrics[]) as a plain object.
 * Used by the IPC METRICS_HISTORY_BULK at boot to pre-populate the renderer.
 */
export function getHistoryAll(): Record<string, ServerMetrics[]> {
  const result: Record<string, ServerMetrics[]> = {}
  for (const [sid, history] of metricsHistory) {
    if (history.length > 0) result[sid] = [...history]
  }
  return result
}

/**
 * Register a callback invoked for each genuinely new alert (post-dedup).
 * Calling a second time silently replaces the previous callback.
 */
export function onAlert(cb: (alert: Alert) => void): void {
  alertCallback = cb
}

export function onIncidentAlert(cb: (alert: Alert) => void): void {
  incidentAlertCallback = cb
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
  stopWorker() // clears jobs, running, tickHandle, activeDebounce, previousMetrics, flushes saveQueue
  metricsHistory.clear()
  dbOfflineTimestamps.clear()
  saveQueue.length = 0
  failedBatches.length = 0
  storedAlerts = []
  openAlertKeys.clear()
  alertCounter = 0
  activeServerId = null
  alertCallback = null
  incidentAlertCallback = null
  intervalOverrides = null
  pendingBatch.length = 0
  if (batchFlushTimer !== null) {
    clearTimeout(batchFlushTimer)
    batchFlushTimer = null
  }
  // Tests rely on deterministic nextRun=now for every job; disable stagger.
  _staggerEnabled = false
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

/**
 * Returns the offline timestamp map for a given server.
 * For testing only.
 */
export function __getDbOfflineTimestampsForTest(sid: string): Map<string, string> | undefined {
  return dbOfflineTimestamps.get(sid)
}
