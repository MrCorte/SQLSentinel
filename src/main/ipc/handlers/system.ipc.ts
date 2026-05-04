import { dialog, app, BrowserWindow } from 'electron'
import { serviceApi, getStatus } from '../../serviceClient'
import { writeFileSync, promises as fsPromises } from 'node:fs'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { login, logout, getSession, isAuthenticated, changePassword } from '../../authService'
import { buildCsvContent } from '../../csvUtils'
import { getEmailSettings, saveEmailSettings } from '../../store/sqlserver/emailSettingsRepository'
import { sendTestEmail } from '../../emailService'
import { getCustomFields, setCustomFields, getAllCustomFields } from '../../store/sqlserver/dbCustomFieldsRepository'
import { getShrinkEstimate, shrinkDatabase, shrinkFile } from '../../collectors/dbAdmin'
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

export function registerSystemHandlers(): void {
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

  // SETTINGS_GET — proxied to service HTTP (autostart state merged locally)
  handle(IpcChannel.SETTINGS_GET, async (): Promise<IpcResult<AppSettings>> => {
    try {
      const res = await serviceApi.getSettings()
      const data = (res as { ok: true; data: AppSettings }).data
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

  // SETTINGS_SET — proxied to service HTTP; OS autostart handled locally
  handle(
    IpcChannel.SETTINGS_SET,
    async (_event: IpcMainInvokeEvent, req: SaveSettingsRequest): Promise<IpcResult<null>> => {
      try {
        await serviceApi.updateSettings(req)
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
      return { ok: true, data: await getCustomFields(req.serverId, req.dbName) }
    }
  )

  // DB_SET_CUSTOM_FIELDS — saves custom fields for a single DB
  handle(
    IpcChannel.DB_SET_CUSTOM_FIELDS,
    async (_event: IpcMainInvokeEvent, req: DbCustomFieldsSetRequest): Promise<IpcResult<null>> => {
      await setCustomFields(req.serverId, req.dbName, req.fields)
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
        return { ok: false, error: safeError(err) }
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
    return { ok: true, data: exportCustomFieldsCsv() }
  })

  // EXPORT_INVENTORY — generates CSV of the server inventory
  handle(IpcChannel.EXPORT_INVENTORY, async (): Promise<IpcResult<string>> => {
    return { ok: true, data: exportInventoryCsv() }
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
