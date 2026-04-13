import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import {
  login,
  logout,
  getSession,
  isAuthenticated,
  changePassword,
} from '../authService'
import { buildCsvContent } from '../csvUtils'
import { writeFileSync, promises as fsPromises } from 'node:fs'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import {
  IpcChannel,
  type ManualServerRequest,
  type RemoveServerRequest,
  type CollectMetricsRequest,
  type WorkerStartRequest,
  type WorkerSetActiveRequest,
  type WorkerSyncServersRequest,
  type ExportInventoryCsvRequest,
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
} from './types'
import type { ServerMetrics } from '../collectors/types'
import { startWorker, stopWorker, setActiveServer, syncServers, getAlerts, acknowledgeAlert, getHistory, getHistoryAll } from '../metricsWorker'
import { getSettings, saveSettings } from '../store/settings'
import { getEmailSettings, saveEmailSettings } from '../store/emailSettings'
import { sendTestEmail } from '../emailService'
import { getCustomFields, setCustomFields, getAllCustomFields } from '../store/dbCustomFields'
import type { DiscoveredServer, ScanOptions } from '../discovery/types'
import { aiAsk } from '../ai/agent'
import { checkOllamaHealth } from '../ai/ollama'
import type { ChatMessage } from '../ai/ollama'
import { langGraphAsk, type AgentHistory } from '../ai/langGraphAgent'
import * as ragRepository from '../store/ragRepository'
import type { RagDocument } from './types'
import { scanSubnet, scanHost } from '../discovery/tcpScanner'
import { collectMetrics, detectServerInfo } from '../collectors/sqlCollector'
import { getShrinkEstimate, shrinkDatabase, shrinkFile } from '../collectors/dbAdmin'
import { getAvailabilityGroups, getAvailabilityReplicas, getAvailabilityDatabases } from '../collectors/agCollector'
import * as serverStore from '../store/serverStore'
import type { StoredServer } from '../store/serverStore'

function serverKey(ip: string, port: number): string {
  return `${ip}:${port}`
}

/** Convert StoredServer → DiscoveredServer shape for legacy callers */
function toDiscovered(s: StoredServer): DiscoveredServer {
  return {
    ip: s.host,
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
  // ── Auth handlers (no guard needed) ──────────────────────────────────────

  ipcMain.handle(
    IpcChannel.AUTH_LOGIN,
    async (_event: IpcMainInvokeEvent, username: string, password: string): Promise<LoginResult> => {
      try {
        return await login(username, password)
      } catch (err) {
        return { success: false, error: safeError(err) }
      }
    }
  )

  ipcMain.handle(IpcChannel.AUTH_LOGOUT, async (): Promise<{ success: boolean }> => {
    logout()
    return { success: true }
  })

  ipcMain.handle(
    IpcChannel.AUTH_CHECK,
    async (): Promise<{ authenticated: boolean; session: AuthSession | null }> => ({
      authenticated: isAuthenticated(),
      session: getSession(),
    })
  )

  ipcMain.handle(
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

  // ── Auth guard — protects all handlers registered after this point ───────
  // Channels exempt from auth (needed before login or are auth themselves)
  const AUTH_EXEMPT = new Set<string>([
    IpcChannel.AUTH_LOGIN,
    IpcChannel.AUTH_LOGOUT,
    IpcChannel.AUTH_CHECK,
    IpcChannel.SETTINGS_GET,
    IpcChannel.SETTINGS_SET,
  ])
  const _origHandle = ipcMain.handle.bind(ipcMain)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(ipcMain as any).handle = (channel: string, listener: (...args: any[]) => any) => {
    if (AUTH_EXEMPT.has(channel)) return _origHandle(channel, listener)
    return _origHandle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isAuthenticated()) throw new Error('UNAUTHORIZED')
      return listener(event, ...args)
    })
  }

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
          host: probed.ip,
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

  // SERVERS_GET_ALL — returns StoredServer[] directly (flat array, no IpcResult wrapper)
  ipcMain.handle(
    IpcChannel.SERVERS_GET_ALL,
    (): StoredServer[] => {
      try {
        return serverStore.getAll()
      } catch (err) {
        console.error('[IPC] SERVERS_GET_ALL:', safeError(err))
        return []
      }
    }
  )

  // SERVERS_ADD — returns { success, reason?, server? } directly (flat, no IpcResult wrapper)
  ipcMain.handle(
    IpcChannel.SERVERS_ADD,
    (_event: IpcMainInvokeEvent, params: Omit<StoredServer, 'id' | 'addedAt'>): ServerAddResult => {
      try {
        return serverStore.add(params)
      } catch (err) {
        console.error('[IPC] SERVERS_ADD:', safeError(err))
        return { success: false, reason: safeError(err) }
      }
    }
  )

  // SERVERS_UPDATE — takes (id, patch) as separate args (flat response)
  ipcMain.handle(
    IpcChannel.SERVERS_UPDATE,
    (_event: IpcMainInvokeEvent, id: string, patch: Partial<StoredServer>): { success: boolean } => {
      try {
        serverStore.update(id, patch)
        return { success: true }
      } catch (err) {
        console.error('[IPC] SERVERS_UPDATE:', safeError(err))
        return { success: false }
      }
    }
  )

  // SERVERS_REMOVE_BY_ID — removes a server from electron-store by UUID (flat response)
  ipcMain.handle(
    IpcChannel.SERVERS_REMOVE_BY_ID,
    (_event: IpcMainInvokeEvent, id: string): { success: boolean } => {
      try {
        serverStore.remove(id)
        return { success: true }
      } catch (err) {
        console.error('[IPC] SERVERS_REMOVE_BY_ID:', safeError(err))
        return { success: false }
      }
    }
  )

  // SERVERS_CLEAR_MOCKS — rimuove server con id che inizia con 'mock-' (usati dal preload mock)
  ipcMain.handle(IpcChannel.SERVERS_CLEAR_MOCKS, (): { success: boolean; removed: number; remaining: number } => {
    try {
      const before = serverStore.getAll()
      const mocks = before.filter((s) => s.id.startsWith('mock-'))
      mocks.forEach((s) => serverStore.remove(s.id))
      const after = serverStore.getAll()
      console.log(`[clearMocks] rimossi ${mocks.length} mock, rimasti: ${after.length}`)
      return { success: true, removed: mocks.length, remaining: after.length }
    } catch (err) {
      console.error('[IPC] servers:clearMocks:', safeError(err))
      return { success: false, removed: 0, remaining: -1 }
    }
  })

  // DETECT_SERVER_INFO — test connection + retrieve MachineName / InstanceName
  ipcMain.handle(
    IpcChannel.DETECT_SERVER_INFO,
    async (_event: IpcMainInvokeEvent, req: CollectMetricsRequest): Promise<IpcResult<import('./types').ServerInfo>> => {
      try {
        const info = await detectServerInfo({
          ip: req.ip,
          port: req.port,
          instanceName: req.instanceName,
          useWindowsAuth: req.useWindowsAuth,
          username: req.username,
          password: req.password
        })
        return { ok: true, data: info }
      } catch (err) {
        console.error('[IPC] DETECT_SERVER_INFO:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
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

  // WORKER_SET_ACTIVE — segnala quale server è "attivo" (polling più frequente)
  ipcMain.handle(IpcChannel.WORKER_SET_ACTIVE, (_e, req: WorkerSetActiveRequest): IpcResult<null> => {
    setActiveServer(req.serverId)
    return { ok: true, data: null }
  })

  // WORKER_SYNC_SERVERS — UPSERT server list without full restart
  ipcMain.handle(IpcChannel.WORKER_SYNC_SERVERS, (_e, req: WorkerSyncServersRequest): IpcResult<null> => {
    syncServers(req.servers)
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

  // METRICS_HISTORY_BULK — restituisce tutta la history in-memory al boot (pre-popolata da SQLite)
  ipcMain.handle(
    IpcChannel.METRICS_HISTORY_BULK,
    async (): Promise<IpcResult<Record<string, ServerMetrics[]>>> => {
      return { ok: true, data: getHistoryAll() }
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

  // SETTINGS_GET — restituisce le impostazioni salvate + stato autostart dal SO
  ipcMain.handle(IpcChannel.SETTINGS_GET, async (): Promise<IpcResult<AppSettings>> => {
    return {
      ok: true,
      data: {
        ...getSettings(),
        autostartEnabled: app.getLoginItemSettings().openAtLogin,
      },
    }
  })

  // SETTINGS_SET — salva le impostazioni; aggiorna autostart nel registro di SO se richiesto
  ipcMain.handle(
    IpcChannel.SETTINGS_SET,
    async (_event: IpcMainInvokeEvent, req: SaveSettingsRequest): Promise<IpcResult<null>> => {
      saveSettings(req)
      if (req.autostartEnabled !== undefined) {
        app.setLoginItemSettings({ openAtLogin: req.autostartEnabled })
      }
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
      const sid = serverKey(s.host, s.port)
      const dbEntries = Object.entries(all)
        .filter(([key]) => key.startsWith(sid + '/'))
        .map(([key]) => key.slice(sid.length + 1))
        .join('; ')
      return [
        s.host,
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

  // DB_SHRINK_ESTIMATE — anteprima spazio recuperabile per un database
  ipcMain.handle(
    IpcChannel.DB_SHRINK_ESTIMATE,
    async (_event: IpcMainInvokeEvent, req: ShrinkEstimateParams): Promise<IpcResult<ShrinkEstimate[]>> => {
      try {
        const estimates = await getShrinkEstimate(req.connection, req.dbName)
        return { ok: true, data: estimates }
      } catch (err) {
        console.error('[IPC] DB_SHRINK_ESTIMATE:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // DB_SHRINK — shrink intero database
  ipcMain.handle(
    IpcChannel.DB_SHRINK,
    async (_event: IpcMainInvokeEvent, req: ShrinkDatabaseParams): Promise<IpcResult<ShrinkResult>> => {
      try {
        const result = await shrinkDatabase(req.connection, req.dbName, req.targetPercent)
        return { ok: true, data: result }
      } catch (err) {
        console.error('[IPC] DB_SHRINK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // DB_SHRINK_FILE — shrink file specifico (dati o log)
  ipcMain.handle(
    IpcChannel.DB_SHRINK_FILE,
    async (_event: IpcMainInvokeEvent, req: ShrinkFileParams): Promise<IpcResult<ShrinkResult>> => {
      try {
        const result = await shrinkFile(req.connection, req.dbName, req.fileName, req.targetSizeMb, req.isLog)
        return { ok: true, data: result }
      } catch (err) {
        console.error('[IPC] DB_SHRINK_FILE:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // AG_GET_GROUPS — availability groups sul server
  ipcMain.handle(
    IpcChannel.AG_GET_GROUPS,
    async (_event: IpcMainInvokeEvent, req: AgParams): Promise<IpcResult<AvailabilityGroup[]>> => {
      try {
        const data = await getAvailabilityGroups(req.connection)
        return { ok: true, data }
      } catch (err) {
        // Server non in AG o permessi insufficienti — non è un errore critico
        console.info('[IPC] AG_GET_GROUPS: no AG or insufficient perms:', safeError(err))
        return { ok: true, data: [] }
      }
    }
  )

  // AG_GET_REPLICAS — repliche AG
  ipcMain.handle(
    IpcChannel.AG_GET_REPLICAS,
    async (_event: IpcMainInvokeEvent, req: AgParams): Promise<IpcResult<AvailabilityReplica[]>> => {
      try {
        const data = await getAvailabilityReplicas(req.connection)
        return { ok: true, data }
      } catch (err) {
        console.info('[IPC] AG_GET_REPLICAS:', safeError(err))
        return { ok: true, data: [] }
      }
    }
  )

  // AG_GET_DATABASES — database in AG
  ipcMain.handle(
    IpcChannel.AG_GET_DATABASES,
    async (_event: IpcMainInvokeEvent, req: AgParams): Promise<IpcResult<AvailabilityDatabase[]>> => {
      try {
        const data = await getAvailabilityDatabases(req.connection)
        return { ok: true, data }
      } catch (err) {
        console.info('[IPC] AG_GET_DATABASES:', safeError(err))
        return { ok: true, data: [] }
      }
    }
  )

  // EXPORT_INVENTORY_CSV — apre showSaveDialog e scrive il CSV inventario con BOM UTF-8
  ipcMain.handle(
    IpcChannel.EXPORT_INVENTORY_CSV,
    async (event: IpcMainInvokeEvent, req: ExportInventoryCsvRequest): Promise<IpcResult<string | null>> => {
      try {
        const win =
          BrowserWindow.fromWebContents(event.sender) ??
          BrowserWindow.getFocusedWindow() ??
          BrowserWindow.getAllWindows()[0]
        const result = await dialog.showSaveDialog(win, {
          title: 'Salva inventario CSV',
          defaultPath: path.join(app.getPath('downloads'), `inventario-sql-${new Date().toISOString().slice(0, 10)}.csv`),
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        })
        if (result.canceled || !result.filePath) return { ok: true, data: null }
        const content = buildCsvContent(req.headers, req.rows)
        await fsPromises.writeFile(result.filePath, content, 'utf8')
        return { ok: true, data: result.filePath }
      } catch (err) {
        console.error('[IPC] EXPORT_INVENTORY_CSV:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // FILE_SAVE_CSV — apre showSaveDialog e scrive il file
  ipcMain.handle(
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

  // EMAIL_SETTINGS_GET
  ipcMain.handle(
    IpcChannel.EMAIL_SETTINGS_GET,
    async (): Promise<IpcResult<EmailSettings>> => {
      try {
        return { ok: true, data: getEmailSettings() }
      } catch (err) {
        console.error('[IPC] EMAIL_SETTINGS_GET:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // EMAIL_SETTINGS_SET
  ipcMain.handle(
    IpcChannel.EMAIL_SETTINGS_SET,
    async (_event: IpcMainInvokeEvent, req: SaveEmailSettingsRequest): Promise<IpcResult<null>> => {
      try {
        saveEmailSettings(req)
        return { ok: true, data: null }
      } catch (err) {
        console.error('[IPC] EMAIL_SETTINGS_SET:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // EMAIL_TEST — sendTestEmail() has internal try/catch; outer try/catch catches unexpected throws
  ipcMain.handle(
    IpcChannel.EMAIL_TEST,
    async (): Promise<IpcResult<null>> => {
      try {
        return await sendTestEmail()
      } catch (err) {
        console.error('[IPC] EMAIL_TEST:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // AI_CHECK — verifica se Ollama è raggiungibile localmente
  ipcMain.handle(IpcChannel.AI_CHECK, async (): Promise<IpcResult<boolean>> => {
    try {
      return { ok: true, data: await checkOllamaHealth() }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  // AI_ASK — risposta AI con contesto RAG (metriche + alert + server)
  ipcMain.handle(
    IpcChannel.AI_ASK,
    async (
      _event: IpcMainInvokeEvent,
      question: string,
      history: ChatMessage[]
    ): Promise<IpcResult<string>> => {
      try {
        return { ok: true, data: await aiAsk(question, history) }
      } catch (err) {
        console.error('[IPC] AI_ASK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // AI_AGENT_ASK — agente DBA multi-step con tool calling (LangGraph + Ollama)
  ipcMain.handle(
    IpcChannel.AI_AGENT_ASK,
    async (
      _event: IpcMainInvokeEvent,
      question: string,
      history: AgentHistory[]
    ): Promise<IpcResult<string>> => {
      try {
        return { ok: true, data: await langGraphAsk(question, history) }
      } catch (err) {
        console.error('[IPC] AI_AGENT_ASK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // RAG_GET_DOCUMENTS — lista libri indicizzati (sola lettura)
  ipcMain.handle(IpcChannel.RAG_GET_DOCUMENTS, async (): Promise<IpcResult<RagDocument[]>> => {
    try {
      return { ok: true, data: ragRepository.getAllDocuments() }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  // Restore original ipcMain.handle after all handlers are registered
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(ipcMain as any).handle = _origHandle
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  const dangerous = /^[=+\-@\t\r]/.test(s)
  if (dangerous || s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}
