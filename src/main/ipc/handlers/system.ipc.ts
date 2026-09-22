import { dialog, app, BrowserWindow } from 'electron'
import { serviceApi, getStatus } from '../../serviceClient'
import { writeFileSync, promises as fsPromises } from 'node:fs'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { login, logout, getSession, isAuthenticated, changePassword } from '../../authService'
import { buildCsvContent } from '../../csvUtils'
import { getEmailSettings, saveEmailSettings } from '../../store/sqlserver/emailSettingsRepository'
import {
  getSettings as getSettingsDirect,
  saveSettings as saveSettingsDirect,
  type AppSettings as RepoAppSettings
} from '../../store/sqlserver/settingsRepository'
import { sendTestEmail } from '../../emailService'
import {
  getCustomFields,
  setCustomFields,
  setCustomFieldsBulk,
  getAllCustomFields
} from '../../store/sqlserver/dbCustomFieldsRepository'
import { getShrinkEstimate, shrinkDatabase, shrinkFile } from '../../collectors/dbAdmin'
import { sanitizeSqlError } from '../../collectors/sqlCollector'
import {
  getAvailabilityGroups,
  getAvailabilityReplicas,
  getAvailabilityDatabases
} from '../../collectors/agCollector'
import {
  exportCustomFieldsCsv,
  exportInventoryCsv,
  exportAlertsCsv
} from '../../services/SystemService'
import {
  IpcChannel,
  type SaveSettingsRequest,
  type AppSettings,
  type DbCustomFields,
  type DbCustomFieldsGetRequest,
  type DbCustomFieldsSetRequest,
  type DbCustomFieldsSetBulkRequest,
  type SaveCsvRequest,
  type ExportInventoryCsvRequest,
  type IpcResult,
  type ShrinkDatabaseParams,
  type ShrinkFileParams,
  type ShrinkEstimateParams,
  type ShrinkEstimate,
  type ShrinkResult,
  type AgParams,
  type AvailabilityGroup,
  type AvailabilityReplica,
  type AvailabilityDatabase,
  type EmailSettings,
  type SaveEmailSettingsRequest,
  type LoginResult,
  type ChangePasswordResult,
  type AuthSession
} from '../types'
import { resolveConnection } from './servers.ipc'

// serverId is "ip:port" and dbName is a SQL identifier; both are used as map
// keys / parameterized inputs downstream. Bound them so a hijacked renderer
// can't push unbounded/garbage keys into the custom-fields store.
function isValidCustomFieldKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

// Settings live in the SQL Server `dbo.settings` table. On Windows we normally
// route reads/writes through the service (so its running worker reacts to
// interval/mode changes), but the main process shares the same storage pool. When
// the service is down — or the proxy call fails — fall back to the repository
// directly instead of failing outright. Without this, the theme (loaded from
// SETTINGS_GET before login) and every settings read/write break whenever the
// service is offline.
// Returns the persisted settings WITHOUT autostartEnabled — that field is an OS
// setting the caller merges in via app.getLoginItemSettings().
async function readSettings(): Promise<RepoAppSettings> {
  if (getStatus() === 'connected') {
    try {
      const res = await serviceApi.getSettings()
      return (res as { ok: true; data: RepoAppSettings }).data
    } catch (err) {
      log.warn('[IPC] SETTINGS_GET via service failed — using local store:', safeError(err))
    }
  }
  return getSettingsDirect()
}

async function writeSettings(req: SaveSettingsRequest): Promise<void> {
  if (getStatus() === 'connected') {
    try {
      await serviceApi.updateSettings(req)
      return
    } catch (err) {
      log.warn('[IPC] SETTINGS_SET via service failed — using local store:', safeError(err))
    }
  }
  // saveSettings only persists known AppSettings keys, so the extra
  // autostartEnabled field (handled by the OS, not the DB) is harmlessly ignored.
  await saveSettingsDirect(req)
}

export function registerSystemHandlers(): void {
  // App version — surfaced in the UI for support / triage. Reads from
  // package.json via Electron's app.getVersion() which is set at build time.
  handle(IpcChannel.APP_VERSION, async (): Promise<IpcResult<{ version: string }>> => {
    return { ok: true, data: { version: app.getVersion() } }
  })

  // ── Auth handlers ─────────────────────────────────────────────────────────

  handle(
    IpcChannel.AUTH_LOGIN,
    async (
      _event: IpcMainInvokeEvent,
      username: unknown,
      password: unknown
    ): Promise<LoginResult> => {
      // Validate the IPC input shape — a hijacked renderer (or malformed test
      // call) could send objects/null. Bcrypt expects strings; coercion errors
      // would otherwise surface as 500-style stack traces.
      if (typeof username !== 'string' || typeof password !== 'string') {
        return { success: false, error: 'Invalid credentials' }
      }
      if (username.length === 0 || username.length > 128) {
        return { success: false, error: 'Invalid credentials' }
      }
      if (password.length === 0 || password.length > 256) {
        return { success: false, error: 'Invalid credentials' }
      }
      try {
        return await login(username, password)
      } catch (err) {
        return { success: false, error: safeError(err) }
      }
    }
  )

  handle(IpcChannel.AUTH_LOGOUT, async (): Promise<{ success: boolean }> => {
    logout()
    return { success: true }
  })

  handle(
    IpcChannel.AUTH_CHECK,
    async (): Promise<{ authenticated: boolean; session: AuthSession | null }> => ({
      authenticated: isAuthenticated(),
      session: getSession()
    })
  )

  handle(
    IpcChannel.AUTH_CHANGE_PASSWORD,
    async (
      _event: IpcMainInvokeEvent,
      userId: unknown,
      oldPassword: unknown,
      newPassword: unknown
    ): Promise<ChangePasswordResult> => {
      if (
        typeof userId !== 'string' ||
        typeof oldPassword !== 'string' ||
        typeof newPassword !== 'string'
      ) {
        return { success: false, error: 'Invalid request' }
      }
      if (newPassword.length === 0 || newPassword.length > 256) {
        return { success: false, error: 'Invalid password length' }
      }
      const session = getSession()
      if (!session || session.userId !== userId) {
        return { success: false, error: 'Unauthorized' }
      }
      try {
        return await changePassword(userId, oldPassword, newPassword)
      } catch (err) {
        return { success: false, error: safeError(err) }
      }
    }
  )

  // SETTINGS_GET — service when connected, local store as fallback (autostart merged locally)
  handle(IpcChannel.SETTINGS_GET, async (): Promise<IpcResult<AppSettings>> => {
    try {
      const data = await readSettings()
      return {
        ok: true,
        data: {
          ...data,
          autostartEnabled: app.getLoginItemSettings().openAtLogin
        }
      }
    } catch (err) {
      log.error('[IPC] SETTINGS_GET:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  // SETTINGS_SET — service when connected, local store as fallback; OS autostart handled locally
  handle(
    IpcChannel.SETTINGS_SET,
    async (_event: IpcMainInvokeEvent, req: SaveSettingsRequest): Promise<IpcResult<null>> => {
      try {
        await writeSettings(req)
        if (req.autostartEnabled !== undefined) {
          app.setLoginItemSettings({ openAtLogin: req.autostartEnabled })
        }
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] SETTINGS_SET:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // EMAIL_SETTINGS_GET
  handle(IpcChannel.EMAIL_SETTINGS_GET, async (): Promise<IpcResult<EmailSettings>> => {
    try {
      return { ok: true, data: await getEmailSettings() }
    } catch (err) {
      log.error('[IPC] EMAIL_SETTINGS_GET:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  // EMAIL_SETTINGS_SET
  handle(
    IpcChannel.EMAIL_SETTINGS_SET,
    async (_event: IpcMainInvokeEvent, req: SaveEmailSettingsRequest): Promise<IpcResult<null>> => {
      try {
        await saveEmailSettings(req)
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] EMAIL_SETTINGS_SET:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // EMAIL_TEST
  handle(IpcChannel.EMAIL_TEST, async (): Promise<IpcResult<null>> => {
    try {
      return await sendTestEmail()
    } catch (err) {
      log.error('[IPC] EMAIL_TEST:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  // DB_GET_CUSTOM_FIELDS — returns custom fields for a single DB
  handle(
    IpcChannel.DB_GET_CUSTOM_FIELDS,
    async (
      _event: IpcMainInvokeEvent,
      req: DbCustomFieldsGetRequest
    ): Promise<IpcResult<DbCustomFields>> => {
      if (!isValidCustomFieldKey(req?.serverId) || !isValidCustomFieldKey(req?.dbName)) {
        return { ok: false, error: 'Invalid serverId/dbName' }
      }
      return { ok: true, data: await getCustomFields(req.serverId, req.dbName) }
    }
  )

  // DB_SET_CUSTOM_FIELDS — saves custom fields for a single DB
  handle(
    IpcChannel.DB_SET_CUSTOM_FIELDS,
    async (_event: IpcMainInvokeEvent, req: DbCustomFieldsSetRequest): Promise<IpcResult<null>> => {
      if (!isValidCustomFieldKey(req?.serverId) || !isValidCustomFieldKey(req?.dbName)) {
        return { ok: false, error: 'Invalid serverId/dbName' }
      }
      if (typeof req.fields !== 'object' || req.fields === null) {
        return { ok: false, error: 'Invalid fields' }
      }
      await setCustomFields(req.serverId, req.dbName, req.fields)
      return { ok: true, data: null }
    }
  )

  // DB_SET_CUSTOM_FIELDS_BULK — applica gli stessi custom fields a più DB in una
  // sola MERGE batch (evita il pattern N+1 del bulk-edit "seleziona tutti").
  handle(
    IpcChannel.DB_SET_CUSTOM_FIELDS_BULK,
    async (
      _event: IpcMainInvokeEvent,
      req: DbCustomFieldsSetBulkRequest
    ): Promise<IpcResult<null>> => {
      if (!isValidCustomFieldKey(req?.serverId) || !Array.isArray(req?.dbNames)) {
        return { ok: false, error: 'Invalid serverId/dbNames' }
      }
      if (!req.dbNames.every(isValidCustomFieldKey)) {
        return { ok: false, error: 'Invalid dbName in list' }
      }
      if (typeof req.fields !== 'object' || req.fields === null) {
        return { ok: false, error: 'Invalid fields' }
      }
      await setCustomFieldsBulk(req.serverId, req.dbNames, req.fields)
      return { ok: true, data: null }
    }
  )

  // DB_GET_ALL_CUSTOM_FIELDS — returns all custom fields (used by worker for alert suppression)
  handle(
    IpcChannel.DB_GET_ALL_CUSTOM_FIELDS,
    async (): Promise<IpcResult<Record<string, DbCustomFields>>> => {
      return { ok: true, data: await getAllCustomFields() }
    }
  )

  // DB_SHRINK_ESTIMATE — preview recoverable space for a database
  handle(
    IpcChannel.DB_SHRINK_ESTIMATE,
    async (
      _event: IpcMainInvokeEvent,
      req: ShrinkEstimateParams
    ): Promise<IpcResult<ShrinkEstimate[]>> => {
      try {
        const estimates = await getShrinkEstimate(resolveConnection(req.connection), req.dbName)
        return { ok: true, data: estimates }
      } catch (err) {
        log.error('[IPC] DB_SHRINK_ESTIMATE:', safeError(err))
        return { ok: false, error: sanitizeSqlError(err) }
      }
    }
  )

  // DB_SHRINK — shrink entire database
  handle(
    IpcChannel.DB_SHRINK,
    async (
      _event: IpcMainInvokeEvent,
      req: ShrinkDatabaseParams
    ): Promise<IpcResult<ShrinkResult>> => {
      try {
        const result = await shrinkDatabase(
          resolveConnection(req.connection),
          req.dbName,
          req.targetPercent
        )
        return { ok: true, data: result }
      } catch (err) {
        log.error('[IPC] DB_SHRINK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // DB_SHRINK_FILE — shrink specific file (data or log)
  handle(
    IpcChannel.DB_SHRINK_FILE,
    async (_event: IpcMainInvokeEvent, req: ShrinkFileParams): Promise<IpcResult<ShrinkResult>> => {
      try {
        // Log shrink on a FULL-recovery DB executes BACKUP LOG TO NUL, which
        // breaks the backup chain. Require explicit opt-in so the operator
        // cannot trigger this destructive side-effect by accident.
        if (req.isLog && !req.logBackupConfirmed) {
          return {
            ok: false,
            error:
              'Log shrink requires explicit confirmation: this operation will run ' +
              'BACKUP LOG TO NUL on FULL-recovery databases, breaking the log backup chain ' +
              'until a new FULL backup is taken. Check the confirmation box before proceeding.'
          }
        }
        const result = await shrinkFile(
          resolveConnection(req.connection),
          req.dbName,
          req.fileName,
          req.targetSizeMb,
          req.isLog
        )
        return { ok: true, data: result }
      } catch (err) {
        log.error('[IPC] DB_SHRINK_FILE:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // AG_GET_GROUPS — availability groups on the server
  handle(
    IpcChannel.AG_GET_GROUPS,
    async (_event: IpcMainInvokeEvent, req: AgParams): Promise<IpcResult<AvailabilityGroup[]>> => {
      try {
        const data = await getAvailabilityGroups(resolveConnection(req.connection))
        return { ok: true, data }
      } catch (err) {
        log.info('[IPC] AG_GET_GROUPS: no AG or insufficient perms:', safeError(err))
        return { ok: true, data: [] }
      }
    }
  )

  // AG_GET_REPLICAS — AG replicas
  handle(
    IpcChannel.AG_GET_REPLICAS,
    async (
      _event: IpcMainInvokeEvent,
      req: AgParams
    ): Promise<IpcResult<AvailabilityReplica[]>> => {
      try {
        const data = await getAvailabilityReplicas(resolveConnection(req.connection))
        return { ok: true, data }
      } catch (err) {
        log.warn('[IPC] AG_GET_REPLICAS:', safeError(err))
        return { ok: true, data: [] }
      }
    }
  )

  // AG_GET_DATABASES — databases in AG
  handle(
    IpcChannel.AG_GET_DATABASES,
    async (
      _event: IpcMainInvokeEvent,
      req: AgParams
    ): Promise<IpcResult<AvailabilityDatabase[]>> => {
      try {
        const data = await getAvailabilityDatabases(resolveConnection(req.connection))
        return { ok: true, data }
      } catch (err) {
        log.warn('[IPC] AG_GET_DATABASES:', safeError(err))
        return { ok: true, data: [] }
      }
    }
  )

  // EXPORT_CUSTOM_FIELDS — generates CSV of all DB custom fields
  handle(IpcChannel.EXPORT_CUSTOM_FIELDS, async (): Promise<IpcResult<string>> => {
    return { ok: true, data: await exportCustomFieldsCsv() }
  })

  // EXPORT_INVENTORY — generates CSV of the server inventory
  handle(IpcChannel.EXPORT_INVENTORY, async (): Promise<IpcResult<string>> => {
    return { ok: true, data: await exportInventoryCsv() }
  })

  // EXPORT_ALERTS — generates CSV of historical alerts
  handle(IpcChannel.EXPORT_ALERTS, async (): Promise<IpcResult<string>> => {
    return { ok: true, data: exportAlertsCsv() }
  })

  // EXPORT_INVENTORY_CSV — opens showSaveDialog and writes inventory CSV with UTF-8 BOM
  handle(
    IpcChannel.EXPORT_INVENTORY_CSV,
    async (
      event: IpcMainInvokeEvent,
      req: ExportInventoryCsvRequest
    ): Promise<IpcResult<string | null>> => {
      try {
        const win =
          BrowserWindow.fromWebContents(event.sender) ??
          BrowserWindow.getFocusedWindow() ??
          BrowserWindow.getAllWindows()[0]
        const result = await dialog.showSaveDialog(win, {
          title: 'Save inventory CSV',
          defaultPath: path.join(
            app.getPath('downloads'),
            `inventory-sql-${new Date().toISOString().slice(0, 10)}.csv`
          ),
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        })
        if (result.canceled || !result.filePath) return { ok: true, data: null }
        const content = buildCsvContent(req.headers, req.rows)
        await fsPromises.writeFile(result.filePath, content, 'utf8')
        return { ok: true, data: result.filePath }
      } catch (err) {
        log.error('[IPC] EXPORT_INVENTORY_CSV:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // FILE_SAVE_CSV — opens showSaveDialog and writes the file
  handle(
    IpcChannel.FILE_SAVE_CSV,
    async (event: IpcMainInvokeEvent, req: SaveCsvRequest): Promise<IpcResult<string | null>> => {
      try {
        const win =
          BrowserWindow.fromWebContents(event.sender) ??
          BrowserWindow.getFocusedWindow() ??
          BrowserWindow.getAllWindows()[0]
        const result = await dialog.showSaveDialog(win, {
          defaultPath: req.filename,
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        })
        if (result.canceled || !result.filePath) return { ok: true, data: null }
        writeFileSync(result.filePath, '\uFEFF' + req.content, 'utf8')
        return { ok: true, data: result.filePath }
      } catch (err) {
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // SERVICE_STATUS_GET
  handle(IpcChannel.SERVICE_STATUS_GET, (): IpcResult<{ status: string }> => {
    return { ok: true, data: { status: getStatus() } }
  })
}
