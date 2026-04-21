import { dialog, app, BrowserWindow } from 'electron'
import { writeFileSync, promises as fsPromises } from 'node:fs'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import {
  login,
  logout,
  getSession,
  isAuthenticated,
  changePassword,
} from '../../authService'
import { getAlerts } from '../../metricsWorker'
import { buildCsvContent } from '../../csvUtils'
import { getSettings, saveSettings } from '../../store/settings'
import { getEmailSettings, saveEmailSettings } from '../../store/emailSettings'
import { sendTestEmail } from '../../emailService'
import { getCustomFields, setCustomFields, getAllCustomFields } from '../../store/dbCustomFields'
import { getShrinkEstimate, shrinkDatabase, shrinkFile } from '../../collectors/dbAdmin'
import {
  getAvailabilityGroups,
  getAvailabilityReplicas,
  getAvailabilityDatabases,
} from '../../collectors/agCollector'
import * as serverStore from '../../store/serverStore'
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
  type AuthSession,
} from '../types'
import { resolveConnection } from './servers.ipc'

function serverKey(ip: string, port: number): string {
  return `${ip}:${port}`
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  const dangerous = /^[=+\-@\t\r]/.test(s)
  if (dangerous || s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function registerSystemHandlers(): void {
  // ── Auth handlers (no guard needed) ──────────────────────────────────────

  handle(
    IpcChannel.AUTH_LOGIN,
    async (
      _event: IpcMainInvokeEvent,
      username: string,
      password: string
    ): Promise<LoginResult> => {
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
      session: getSession(),
    })
  )

  handle(
    IpcChannel.AUTH_CHANGE_PASSWORD,
    async (
      _event: IpcMainInvokeEvent,
      userId: string,
      oldPassword: string,
      newPassword: string
    ): Promise<ChangePasswordResult> => {
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

  // SETTINGS_GET — restituisce le impostazioni salvate + stato autostart dal SO
  handle(IpcChannel.SETTINGS_GET, async (): Promise<IpcResult<AppSettings>> => {
    return {
      ok: true,
      data: {
        ...getSettings(),
        autostartEnabled: app.getLoginItemSettings().openAtLogin,
      },
    }
  })

  // SETTINGS_SET — salva le impostazioni; aggiorna autostart nel registro di SO se richiesto
  handle(
    IpcChannel.SETTINGS_SET,
    async (
      _event: IpcMainInvokeEvent,
      req: SaveSettingsRequest
    ): Promise<IpcResult<null>> => {
      saveSettings(req)
      if (req.autostartEnabled !== undefined) {
        app.setLoginItemSettings({ openAtLogin: req.autostartEnabled })
      }
      return { ok: true, data: null }
    }
  )

  // EMAIL_SETTINGS_GET
  handle(IpcChannel.EMAIL_SETTINGS_GET, async (): Promise<IpcResult<EmailSettings>> => {
    try {
      return { ok: true, data: getEmailSettings() }
    } catch (err) {
      log.error('[IPC] EMAIL_SETTINGS_GET:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  // EMAIL_SETTINGS_SET
  handle(
    IpcChannel.EMAIL_SETTINGS_SET,
    async (
      _event: IpcMainInvokeEvent,
      req: SaveEmailSettingsRequest
    ): Promise<IpcResult<null>> => {
      try {
        saveEmailSettings(req)
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] EMAIL_SETTINGS_SET:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // EMAIL_TEST — sendTestEmail() has internal try/catch; outer try/catch catches unexpected throws
  handle(IpcChannel.EMAIL_TEST, async (): Promise<IpcResult<null>> => {
    try {
      return await sendTestEmail()
    } catch (err) {
      log.error('[IPC] EMAIL_TEST:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  // DB_GET_CUSTOM_FIELDS — restituisce i campi custom per un singolo DB
  handle(
    IpcChannel.DB_GET_CUSTOM_FIELDS,
    async (
      _event: IpcMainInvokeEvent,
      req: DbCustomFieldsGetRequest
    ): Promise<IpcResult<DbCustomFields>> => {
      return { ok: true, data: getCustomFields(req.serverId, req.dbName) }
    }
  )

  // DB_SET_CUSTOM_FIELDS — salva i campi custom per un singolo DB
  handle(
    IpcChannel.DB_SET_CUSTOM_FIELDS,
    async (
      _event: IpcMainInvokeEvent,
      req: DbCustomFieldsSetRequest
    ): Promise<IpcResult<null>> => {
      setCustomFields(req.serverId, req.dbName, req.fields)
      return { ok: true, data: null }
    }
  )

  // DB_GET_ALL_CUSTOM_FIELDS — restituisce tutti i campi custom (usato dal worker per alert suppression)
  handle(
    IpcChannel.DB_GET_ALL_CUSTOM_FIELDS,
    async (): Promise<IpcResult<Record<string, DbCustomFields>>> => {
      return { ok: true, data: getAllCustomFields() }
    }
  )

  // DB_SHRINK_ESTIMATE — anteprima spazio recuperabile per un database
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

  // DB_SHRINK — shrink intero database
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

  // DB_SHRINK_FILE — shrink file specifico (dati o log)
  handle(
    IpcChannel.DB_SHRINK_FILE,
    async (
      _event: IpcMainInvokeEvent,
      req: ShrinkFileParams
    ): Promise<IpcResult<ShrinkResult>> => {
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

  // AG_GET_GROUPS — availability groups sul server
  handle(
    IpcChannel.AG_GET_GROUPS,
    async (
      _event: IpcMainInvokeEvent,
      req: AgParams
    ): Promise<IpcResult<AvailabilityGroup[]>> => {
      try {
        const data = await getAvailabilityGroups(resolveConnection(req.connection))
        return { ok: true, data }
      } catch (err) {
        // Server non in AG o permessi insufficienti — non è un errore critico
        log.info('[IPC] AG_GET_GROUPS: no AG or insufficient perms:', safeError(err))
        return { ok: true, data: [] }
      }
    }
  )

  // AG_GET_REPLICAS — repliche AG
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

  // AG_GET_DATABASES — database in AG
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

  // EXPORT_CUSTOM_FIELDS — genera CSV dei campi custom di tutti i DB
  handle(IpcChannel.EXPORT_CUSTOM_FIELDS, async (): Promise<IpcResult<string>> => {
    const all = getAllCustomFields()
    const rows = Object.entries(all).map(([key, fields]) => {
      const slash = key.indexOf('/')
      const serverId = slash >= 0 ? key.slice(0, slash) : key
      const dbName = slash >= 0 ? key.slice(slash + 1) : ''
      return [serverId, dbName, fields.alias ?? '', fields.referente ?? '']
        .map(csvEscape)
        .join(',')
    })
    const csv = ['serverId,dbName,alias,referente', ...rows].join('\r\n')
    return { ok: true, data: csv }
  })

  // EXPORT_INVENTORY — genera CSV dell'inventario server
  handle(IpcChannel.EXPORT_INVENTORY, async (): Promise<IpcResult<string>> => {
    const all = getAllCustomFields()
    const header = 'ip,porta,raggiungibile,aggiunto_il,database'
    const rows = serverStore.getAll().map((s) => {
      const sid = serverKey(s.host, s.port)
      const dbEntries = Object.entries(all)
        .filter(([key]) => key.startsWith(sid + '/'))
        .map(([key]) => key.slice(sid.length + 1))
        .join('; ')
      return [s.host, String(s.port), s.unreachable ? 'NO' : 'SI', s.addedAt, dbEntries]
        .map(csvEscape)
        .join(',')
    })
    const csv = [header, ...rows].join('\r\n')
    return { ok: true, data: csv }
  })

  // EXPORT_ALERTS — genera CSV degli alert storici
  handle(IpcChannel.EXPORT_ALERTS, async (): Promise<IpcResult<string>> => {
    const alerts = getAlerts()
    const header = 'id,serverId,categoria,severita,messaggio,rilevato_il,acknowledged_il'
    const rows = alerts.map((a) =>
      [
        a.id,
        a.serverId,
        a.category,
        a.severity,
        a.message,
        a.detectedAt instanceof Date ? a.detectedAt.toISOString() : String(a.detectedAt),
        a.acknowledgedAt
          ? a.acknowledgedAt instanceof Date
            ? a.acknowledgedAt.toISOString()
            : String(a.acknowledgedAt)
          : '',
      ]
        .map(csvEscape)
        .join(',')
    )
    const csv = [header, ...rows].join('\r\n')
    return { ok: true, data: csv }
  })

  // EXPORT_INVENTORY_CSV — apre showSaveDialog e scrive il CSV inventario con BOM UTF-8
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
          title: 'Salva inventario CSV',
          defaultPath: path.join(
            app.getPath('downloads'),
            `inventario-sql-${new Date().toISOString().slice(0, 10)}.csv`
          ),
          filters: [{ name: 'CSV', extensions: ['csv'] }],
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

  // FILE_SAVE_CSV — apre showSaveDialog e scrive il file
  handle(
    IpcChannel.FILE_SAVE_CSV,
    async (
      event: IpcMainInvokeEvent,
      req: SaveCsvRequest
    ): Promise<IpcResult<string | null>> => {
      try {
        const win =
          BrowserWindow.fromWebContents(event.sender) ??
          BrowserWindow.getFocusedWindow() ??
          BrowserWindow.getAllWindows()[0]
        const result = await dialog.showSaveDialog(win, {
          defaultPath: req.filename,
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        })
        if (result.canceled || !result.filePath) return { ok: true, data: null }
        writeFileSync(result.filePath, '\uFEFF' + req.content, 'utf8')
        return { ok: true, data: result.filePath }
      } catch (err) {
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
