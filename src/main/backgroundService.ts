import { Tray, Menu, Notification, app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { CollectMetricsRequest, Alert } from './ipc/types'
import type { IntervalOverrides } from './metricsWorker'
import { getSettings, saveSettings } from './store/sqlserver/settingsRepository'
import * as serverStore from './store/sqlserver/serverRepository'
import { getAlerts } from './metricsWorker'
import { sendAlertEmail } from './emailService'
import { getStatus } from './serviceClient'
import { createLogger } from './utils/logger'
const log = createLogger('background')

const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')

const trayIconNormal = join(resourcesDir, 'tray-icon.png')
const trayIconAlertCandidate = join(resourcesDir, 'tray-icon-alert.png')
const trayIconAlert = existsSync(trayIconAlertCandidate) ? trayIconAlertCandidate : trayIconNormal

export interface WorkerApi {
  syncServers(servers: CollectMetricsRequest[]): void
  stopWorker(): void
  setIntervalOverrides(overrides: IntervalOverrides | null): void
  onAlert(cb: (alert: Alert) => void): void
}

export class BackgroundService {
  private tray: Tray | null = null
  private menuTimer: ReturnType<typeof setInterval> | null = null
  private dedupSweepTimer: ReturnType<typeof setInterval> | null = null
  quitting = false
  private wasStoppedWhenHidden = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly worker: WorkerApi
  ) {
    this.createTray()
    this.attachWindowListeners()
    worker.onAlert((alert) => {
      this.maybeNotify(alert).catch((err) => log.warn('[background] maybeNotify failed:', err))
    })
    this.menuTimer = setInterval(() => {
      this.rebuildMenu().catch((err) => log.warn('[background] rebuildMenu failed:', err))
    }, 30_000)
    // Sweep dedup entries older than 24 h every 6 h so the map can never grow
    // unbounded over long sessions even if alerts churn but never get acknowledged.
    this.dedupSweepTimer = setInterval(() => this.sweepNotifyDedup(), 6 * 60 * 60_000)
  }

  private sweepNotifyDedup(): void {
    const cutoff = Date.now() - 24 * 60 * 60_000
    for (const [key, ts] of this.notifyDedup) {
      if (ts < cutoff) this.notifyDedup.delete(key)
    }
  }

  private createTray(): void {
    this.tray = new Tray(trayIconNormal)
    this.rebuildMenu().catch((err) => log.warn('[background] rebuildMenu failed:', err))
    this.tray.on('double-click', () => {
      this.win.show()
      this.win.focus()
    })
  }

  private attachWindowListeners(): void {
    this.win.on('close', (e: Electron.Event) => {
      if (!this.quitting) {
        e.preventDefault()
        this.win.hide()
      }
    })
    this.win.on('hide', () => {
      this.reconfigureWorker().catch((err) =>
        log.warn('[background] reconfigureWorker failed:', err)
      )
    })
    this.win.on('show', () => this.restoreWorker())
  }

  private async rebuildMenu(): Promise<void> {
    if (!this.tray || this.tray.isDestroyed()) return
    if (this.quitting) return
    // Tray menu only counts online/offline — no need to decrypt every server's
    // password. getAllStripped() avoids ~200 DPAPI calls per 30s tick.
    const servers = serverStore.getAllStripped()
    const online = servers.filter((s) => !s.unreachable).length
    const offline = servers.filter((s) => s.unreachable).length
    let settings: Awaited<ReturnType<typeof getSettings>>
    try {
      settings = await getSettings()
    } catch {
      return
    }
    const hasAlert = getAlerts().some((a) => a.severity === 'CRITICAL' && !a.acknowledgedAt)
    this.tray.setImage(hasAlert ? trayIconAlert : trayIconNormal)
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open SQLSentinel',
        click: () => {
          this.win.show()
          this.win.focus()
        }
      },
      { type: 'separator' },
      { label: `● ${online} server online`, enabled: false },
      { label: `✕  ${offline} server offline`, enabled: false },
      {
        label: `Service: ${getStatus() === 'connected' ? '● Connected' : '○ Disconnected'}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: `Background polling: ${settings.backgroundEnabled ? 'Active' : 'Inactive'}`,
        click: () => {
          const next = !settings.backgroundEnabled
          saveSettings({ backgroundEnabled: next })
            .then(() => {
              if (!next) {
                this.worker.stopWorker()
              } else {
                this.restoreWorker()
              }
              return this.rebuildMenu()
            })
            .catch((err) => log.warn('[background] toggle backgroundEnabled failed:', err))
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.quitting = true
          this.destroy()
          app.quit()
        }
      }
    ])
    this.tray.setContextMenu(menu)
  }

  private async reconfigureWorker(): Promise<void> {
    if (this.quitting) return
    let s: Awaited<ReturnType<typeof getSettings>>
    try {
      s = await getSettings()
    } catch {
      return // pool already closed during shutdown — ignore
    }
    this.wasStoppedWhenHidden = false
    if (!s.backgroundEnabled) {
      this.worker.stopWorker()
      this.wasStoppedWhenHidden = true
    } else if (s.backgroundMode === 'light') {
      const ms = s.backgroundIntervalMinutes * 60_000
      this.worker.setIntervalOverrides({
        activeMs: ms,
        idleMs: ms,
        offlineMs: ms,
        lightCollectors: true,
        historyCapOverride: 3
      })
    }
    // 'full' mode: no change to worker
  }

  private restoreWorker(): void {
    this.worker.setIntervalOverrides(null)
    if (this.wasStoppedWhenHidden) {
      const servers = serverStore.getAll().map(
        (s) =>
          ({
            ip: s.host,
            port: s.port,
            instanceName: s.instanceName,
            useWindowsAuth: s.useWindowsAuth,
            username: s.username,
            password: s.password
          }) as CollectMetricsRequest
      )
      this.worker.syncServers(servers)
      this.wasStoppedWhenHidden = false
    }
  }

  private readonly notifyDedup = new Map<string, number>()

  private async maybeNotify(alert: Alert): Promise<void> {
    // Email — fires for WARNING and CRITICAL, filtered by emailService settings + dedup
    sendAlertEmail(alert).catch((err) =>
      log.error(
        '[BackgroundService] Email error:',
        err instanceof Error ? err.message : String(err)
      )
    )

    // Toast — CRITICAL only, hidden window only
    if (alert.severity !== 'CRITICAL') return
    if (this.win.isVisible()) return
    if (!(await getSettings()).backgroundNotifications) return
    // Reset dedup for acknowledged alerts
    getAlerts()
      .filter((a) => a.severity === 'CRITICAL' && a.acknowledgedAt)
      .forEach((a) => this.notifyDedup.delete(`${a.serverId}::${a.category}`))
    const key = `${alert.serverId}::${alert.category}`
    const last = this.notifyDedup.get(key) ?? 0
    if (Date.now() - last < 15 * 60_000) return
    this.notifyDedup.set(key, Date.now())
    try {
      if (!Notification.isSupported()) return
      const n = new Notification({
        title: 'SQLSentinel — Critical Alert',
        body: `${alert.serverId} — ${alert.message}`
      })
      n.on('click', () => {
        this.win.show()
        this.win.focus()
      })
      n.show()
    } catch (err) {
      log.error(
        '[BackgroundService] Notification error:',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  destroy(): void {
    if (this.menuTimer) {
      clearInterval(this.menuTimer)
      this.menuTimer = null
    }
    if (this.dedupSweepTimer) {
      clearInterval(this.dedupSweepTimer)
      this.dedupSweepTimer = null
    }
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
