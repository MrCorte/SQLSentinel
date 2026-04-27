import { Tray, Menu, Notification, app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { CollectMetricsRequest, Alert } from './ipc/types'
import type { IntervalOverrides } from './metricsWorker'
import { getSettings, saveSettings } from './store/settings'
import * as serverStore from './store/serverStore'
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
  quitting = false
  private wasStoppedWhenHidden = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly worker: WorkerApi
  ) {
    this.createTray()
    this.attachWindowListeners()
    worker.onAlert((alert) => this.maybeNotify(alert))
    this.menuTimer = setInterval(() => this.rebuildMenu(), 30_000)
  }

  private createTray(): void {
    this.tray = new Tray(trayIconNormal)
    this.rebuildMenu()
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
    this.win.on('hide', () => this.reconfigureWorker())
    this.win.on('show', () => this.restoreWorker())
  }

  private rebuildMenu(): void {
    if (!this.tray || this.tray.isDestroyed()) return
    const servers = serverStore.getAll()
    const online = servers.filter((s) => !s.unreachable).length
    const offline = servers.filter((s) => s.unreachable).length
    const settings = getSettings()
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
          if (!next) {
            this.worker.stopWorker()
          } else {
            this.restoreWorker()
          }
          this.rebuildMenu()
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

  private reconfigureWorker(): void {
    const s = getSettings()
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

  private maybeNotify(alert: Alert): void {
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
    if (!getSettings().backgroundNotifications) return
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
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
