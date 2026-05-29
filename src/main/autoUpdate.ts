import { app } from 'electron'
import pkg from 'electron-updater'
import { createLogger } from './utils/logger'

// electron-updater ships as CommonJS; the named `autoUpdater` export is reached
// through the default import under electron-vite's ESM interop.
const { autoUpdater } = pkg

const log = createLogger('updater')

const SIX_HOURS_MS = 6 * 60 * 60 * 1000

/**
 * Wire GitHub-Releases auto-update. Behaviour:
 *  - no-op in dev (unpackaged) or when SQLSENTINEL_DISABLE_UPDATE=1
 *  - checks on startup, then every 6 hours
 *  - downloads in the background and installs on next app quit
 *
 * The update feed + signature verification come from the publish config baked
 * into app-update.yml by electron-builder at package time. On Windows the
 * downloaded installer's Authenticode signature is validated against the
 * installed app's signature, so this is only safe once builds are signed.
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) {
    log.info('[updater] skipped — app is not packaged (dev mode)')
    return
  }
  if (process.env.SQLSENTINEL_DISABLE_UPDATE === '1') {
    log.info('[updater] disabled via SQLSENTINEL_DISABLE_UPDATE')
    return
  }

  // Route electron-updater's internal logging through our logger.
  autoUpdater.logger = {
    info: (m: unknown) => log.info('[updater]', String(m)),
    warn: (m: unknown) => log.warn('[updater]', String(m)),
    error: (m: unknown) => log.error('[updater]', String(m)),
    debug: () => {}
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => log.info('[updater] checking for update'))
  autoUpdater.on('update-available', (info) => log.info('[updater] update available', info.version))
  autoUpdater.on('update-not-available', () => log.info('[updater] no update available'))
  autoUpdater.on('download-progress', (p) =>
    log.info(`[updater] downloading ${Math.round(p.percent)}%`)
  )
  autoUpdater.on('update-downloaded', (info) =>
    log.info('[updater] update downloaded — will install on quit', info.version)
  )
  // Never let an updater failure (offline, feed unreachable, bad signature)
  // crash the app — log and carry on.
  autoUpdater.on('error', (err) => log.warn('[updater] error:', err?.message ?? String(err)))

  const check = (): void => {
    autoUpdater
      .checkForUpdatesAndNotify()
      .catch((err) => log.warn('[updater] check failed:', err?.message ?? String(err)))
  }

  check()
  const timer = setInterval(check, SIX_HOURS_MS)
  timer.unref?.()
}
