import { BrowserWindow } from 'electron'
import { IpcChannel } from './ipc/types'
import type { Alert, AlertCategory, AlertSeverity, WorkerStartRequest, CollectMetricsRequest } from './ipc/types'
import { collectMetrics } from './collectors/sqlCollector'
import type { ServerMetrics } from './collectors/types'
import { getAllCustomFields } from './store/dbCustomFields'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY = 20
const MIN_INTERVAL_S = 30
const MAX_INTERVAL_S = 300

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let timerId: ReturnType<typeof setInterval> | null = null
let currentServers: CollectMetricsRequest[] = []
const metricsHistory = new Map<string, ServerMetrics[]>()
let storedAlerts: Alert[] = []
let alertCounter = 0

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
    }
  }
}

// ---------------------------------------------------------------------------
// Collection tick
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  // Carica i campi custom una volta per tick (better-sqlite3 è sincrono)
  const allCustomFields = getAllCustomFields()

  for (const server of currentServers) {
    const sid = serverId(server.ip, server.port)
    try {
      const metrics = await collectMetrics(server)

      // Merge campi custom (alias, referente) nei DatabaseInfo prima di pushare al renderer
      const enrichedMetrics: ServerMetrics = {
        ...metrics,
        databases: metrics.databases.map((db) => ({
          ...db,
          ...(allCustomFields[`${sid}/${db.name}`] ?? {})
        }))
      }

      // Rolling history
      const hist = metricsHistory.get(sid) ?? []
      hist.push(enrichedMetrics)
      if (hist.length > MAX_HISTORY) hist.shift()
      metricsHistory.set(sid, hist)

      pushToRenderer(IpcChannel.METRICS_UPDATED, { serverId: sid, metrics: enrichedMetrics })
      processAlerts(sid, enrichedMetrics)
    } catch (err) {
      console.error(`[Worker] ${sid}:`, err instanceof Error ? err.message : err)
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startWorker(req: WorkerStartRequest): void {
  stopWorker()
  const interval = Math.max(MIN_INTERVAL_S, Math.min(MAX_INTERVAL_S, req.intervalSeconds))
  currentServers = req.servers
  timerId = setInterval(() => {
    tick().catch(console.error)
  }, interval * 1000)
  // Collect immediately on start
  tick().catch(console.error)
}

export function stopWorker(): void {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
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
