import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import type { IpcMainInvokeEvent } from 'electron'
import {
  IpcChannel,
  type ManualServerRequest,
  type RemoveServerRequest,
  type CollectMetricsRequest,
  type WorkerStartRequest,
  type AcknowledgeAlertRequest,
  type HistoryRequest,
  type SaveSettingsRequest,
  type AppSettings,
  type DbCustomFields,
  type DbCustomFieldsGetRequest,
  type DbCustomFieldsSetRequest,
  type SaveCsvRequest,
  type ScanSubnetResponse,
  type AddServerManualResponse,
  type GetServersResponse,
  type RemoveServerResponse,
  type CollectMetricsResponse,
  type IpcResult,
  type Alert,
  type ServerAddResult,
  type UpdateServerRequest
} from './types'
import type { ServerMetrics } from '../collectors/types'
import { startWorker, stopWorker, getAlerts, acknowledgeAlert, getHistory } from '../metricsWorker'
import { getSettings, saveSettings } from '../store/settings'
import { getCustomFields, setCustomFields, getAllCustomFields } from '../store/dbCustomFields'
import type { DiscoveredServer, ScanOptions } from '../discovery/types'
import { scanSubnet, scanHost } from '../discovery/tcpScanner'
import { collectMetrics } from '../collectors/sqlCollector'
import * as serverStore from '../store/serverStore'
import type { StoredServer } from '../store/serverStore'

function serverKey(ip: string, port: number): string {
  return `${ip}:${port}`
}

/** Convert StoredServer → DiscoveredServer shape for legacy callers */
function toDiscovered(s: StoredServer): DiscoveredServer {
  return {
    ip: s.ip,
    port: s.port,
    reachable: !s.unreachable,
    responseTimeMs: 0,
    discoveredAt: new Date(s.addedAt)
  }
}

function safeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerIpcHandlers(): void {
  // SCAN_SUBNET — runs async TCP scan, streams progress events back to renderer
  ipcMain.handle(
    IpcChannel.SCAN_SUBNET,
    async (event: IpcMainInvokeEvent, options: ScanOptions): Promise<ScanSubnetResponse> => {
      try {
        const results = await scanSubnet(options, (progress) => {
          event.sender.send(IpcChannel.SCAN_PROGRESS, progress)
        })
        return { ok: true, data: results }
      } catch (err) {
        console.error('[IPC] SCAN_SUBNET:', safeError(err))
        return { ok: false, error: 'Subnet scan failed' }
      }
    }
  )

  // ADD_SERVER_MANUAL — TCP-probes the given host:port, persists to electron-store
  ipcMain.handle(
    IpcChannel.ADD_SERVER_MANUAL,
    async (_event: IpcMainInvokeEvent, req: ManualServerRequest): Promise<AddServerManualResponse> => {
      try {
        const probed = await scanHost(req.ip, req.port, 2000)
        serverStore.upsertByIpPort({
          ip: probed.ip,
          port: probed.port,
          instanceName: req.instanceName,
          useWindowsAuth: true
        })
        return { ok: true, data: probed }
      } catch (err) {
        console.error('[IPC] ADD_SERVER_MANUAL:', safeError(err))
        return { ok: false, error: 'Failed to add server' }
      }
    }
  )

  // GET_SERVERS — returns all persisted servers as DiscoveredServer shape (legacy)
  ipcMain.handle(
    IpcChannel.GET_SERVERS,
    async (): Promise<GetServersResponse> => {
      return { ok: true, data: serverStore.getAll().map(toDiscovered) }
    }
  )

  // REMOVE_SERVER — removes by ip:port (legacy, used by Discovery context menu)
  ipcMain.handle(
    IpcChannel.REMOVE_SERVER,
    async (_event: IpcMainInvokeEvent, req: RemoveServerRequest): Promise<RemoveServerResponse> => {
      const existing = serverStore.getByIpPort(req.ip, req.port)
      if (existing) serverStore.remove(existing.id)
      return { ok: true, data: null }
    }
  )

  // SERVERS_GET_ALL — returns StoredServer[] from electron-store
  ipcMain.handle(
    IpcChannel.SERVERS_GET_ALL,
    async (): Promise<IpcResult<StoredServer[]>> => {
      return { ok: true, data: serverStore.getAll() }
    }
  )

  // SERVERS_ADD — adds a server to electron-store (validates no duplicates)
  ipcMain.handle(
    IpcChannel.SERVERS_ADD,
    async (_event: IpcMainInvokeEvent, params: Omit<StoredServer, 'id' | 'addedAt'>): Promise<IpcResult<ServerAddResult>> => {
      const result = serverStore.add(params)
      return { ok: true, data: result }
    }
  )

  // SERVERS_UPDATE — patches a server in electron-store
  ipcMain.handle(
    IpcChannel.SERVERS_UPDATE,
    async (_event: IpcMainInvokeEvent, req: UpdateServerRequest): Promise<IpcResult<null>> => {
      serverStore.update(req.id, req.patch)
      return { ok: true, data: null }
    }
  )

  // SERVERS_REMOVE_BY_ID — removes a server from electron-store by UUID
  ipcMain.handle(
    IpcChannel.SERVERS_REMOVE_BY_ID,
    async (_event: IpcMainInvokeEvent, id: string): Promise<IpcResult<null>> => {
      serverStore.remove(id)
      return { ok: true, data: null }
    }
  )

  // COLLECT_METRICS — connects to SQL Server and collects all metrics
  ipcMain.handle(
    IpcChannel.COLLECT_METRICS,
    async (_event: IpcMainInvokeEvent, req: CollectMetricsRequest): Promise<CollectMetricsResponse> => {
      try {
        const metrics = await collectMetrics({
          ip: req.ip,
          port: req.port,
          instanceName: req.instanceName,
          useWindowsAuth: req.useWindowsAuth,
          username: req.username,
          password: req.password
        })
        // Merge campi custom nei DatabaseInfo
        const sid = `${req.ip}:${req.port}`
        const allCf = getAllCustomFields()
        const enriched = {
          ...metrics,
          databases: metrics.databases.map((db) => ({
            ...db,
            ...(allCf[`${sid}/${db.name}`] ?? {})
          }))
        }
        return { ok: true, data: enriched }
      } catch (err) {
        console.error('[IPC] COLLECT_METRICS:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // WORKER_START — avvia il worker con intervallo e lista server
  ipcMain.handle(
    IpcChannel.WORKER_START,
    async (_event: IpcMainInvokeEvent, req: WorkerStartRequest): Promise<IpcResult<null>> => {
      try {
        startWorker(req)
        return { ok: true, data: null }
      } catch (err) {
        console.error('[IPC] WORKER_START:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // WORKER_STOP — ferma il worker
  ipcMain.handle(IpcChannel.WORKER_STOP, async (): Promise<IpcResult<null>> => {
    stopWorker()
    return { ok: true, data: null }
  })

  // ALERTS_GET_ALL — restituisce tutti gli alert (anche riconosciuti)
  ipcMain.handle(IpcChannel.ALERTS_GET_ALL, async (): Promise<IpcResult<Alert[]>> => {
    return { ok: true, data: getAlerts() }
  })

  // ALERTS_ACKNOWLEDGE — segna un alert come riconosciuto
  ipcMain.handle(
    IpcChannel.ALERTS_ACKNOWLEDGE,
    async (_event: IpcMainInvokeEvent, req: AcknowledgeAlertRequest): Promise<IpcResult<null>> => {
      const ok = acknowledgeAlert(req.alertId)
      if (!ok) return { ok: false, error: `Alert ${req.alertId} non trovato` }
      return { ok: true, data: null }
    }
  )

  // METRICS_HISTORY — restituisce gli snapshot del worker per un server
  ipcMain.handle(
    IpcChannel.METRICS_HISTORY,
    async (_event: IpcMainInvokeEvent, req: HistoryRequest): Promise<IpcResult<ServerMetrics[]>> => {
      const history = getHistory(req.ip, req.port)
      console.log('[Main] metrics:history richiesta per', `${req.ip}:${req.port}`, '— snapshot:', history.length)
      return { ok: true, data: history }
    }
  )

  // DB_GET_CUSTOM_FIELDS — restituisce i campi custom per un singolo DB
  ipcMain.handle(
    IpcChannel.DB_GET_CUSTOM_FIELDS,
    async (_event: IpcMainInvokeEvent, req: DbCustomFieldsGetRequest): Promise<IpcResult<DbCustomFields>> => {
      return { ok: true, data: getCustomFields(req.serverId, req.dbName) }
    }
  )

  // DB_SET_CUSTOM_FIELDS — salva i campi custom per un singolo DB
  ipcMain.handle(
    IpcChannel.DB_SET_CUSTOM_FIELDS,
    async (_event: IpcMainInvokeEvent, req: DbCustomFieldsSetRequest): Promise<IpcResult<null>> => {
      setCustomFields(req.serverId, req.dbName, req.fields)
      return { ok: true, data: null }
    }
  )

  // DB_GET_ALL_CUSTOM_FIELDS — restituisce tutti i campi custom (usato dal worker per alert suppression)
  ipcMain.handle(
    IpcChannel.DB_GET_ALL_CUSTOM_FIELDS,
    async (): Promise<IpcResult<Record<string, DbCustomFields>>> => {
      return { ok: true, data: getAllCustomFields() }
    }
  )

  // SETTINGS_GET — restituisce le impostazioni salvate
  ipcMain.handle(IpcChannel.SETTINGS_GET, async (): Promise<IpcResult<AppSettings>> => {
    return { ok: true, data: getSettings() }
  })

  // SETTINGS_SET — salva le impostazioni
  ipcMain.handle(
    IpcChannel.SETTINGS_SET,
    async (_event: IpcMainInvokeEvent, req: SaveSettingsRequest): Promise<IpcResult<null>> => {
      saveSettings(req)
      return { ok: true, data: null }
    }
  )

  // EXPORT_CUSTOM_FIELDS — genera CSV dei campi custom di tutti i DB
  ipcMain.handle(IpcChannel.EXPORT_CUSTOM_FIELDS, async (): Promise<IpcResult<string>> => {
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
  ipcMain.handle(IpcChannel.EXPORT_INVENTORY, async (): Promise<IpcResult<string>> => {
    const all = getAllCustomFields()
    const header = 'ip,porta,raggiungibile,aggiunto_il,database'
    const rows = serverStore.getAll().map((s) => {
      const sid = serverKey(s.ip, s.port)
      const dbEntries = Object.entries(all)
        .filter(([key]) => key.startsWith(sid + '/'))
        .map(([key]) => key.slice(sid.length + 1))
        .join('; ')
      return [
        s.ip,
        String(s.port),
        s.unreachable ? 'NO' : 'SI',
        s.addedAt,
        dbEntries
      ]
        .map(csvEscape)
        .join(',')
    })
    const csv = [header, ...rows].join('\r\n')
    return { ok: true, data: csv }
  })

  // EXPORT_ALERTS — genera CSV degli alert storici
  ipcMain.handle(IpcChannel.EXPORT_ALERTS, async (): Promise<IpcResult<string>> => {
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
          : ''
      ]
        .map(csvEscape)
        .join(',')
    )
    const csv = [header, ...rows].join('\r\n')
    return { ok: true, data: csv }
  })

  // FILE_SAVE_CSV — apre showSaveDialog e scrive il file
  ipcMain.handle(
    IpcChannel.FILE_SAVE_CSV,
    async (event: IpcMainInvokeEvent, req: SaveCsvRequest): Promise<IpcResult<string | null>> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showSaveDialog(win ?? undefined!, {
        defaultPath: req.filename,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (result.canceled || !result.filePath) return { ok: true, data: null }
      writeFileSync(result.filePath, '\uFEFF' + req.content, 'utf8')
      return { ok: true, data: result.filePath }
    }
  )
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}
