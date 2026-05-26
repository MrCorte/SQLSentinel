import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import {
  startWorker,
  stopWorker,
  setActiveServer,
  syncServers,
  getHistory
} from '../../metricsWorker'
import { serviceApi } from '../../serviceClient'
import {
  IpcChannel,
  type WorkerStartRequest,
  type WorkerSetActiveRequest,
  type WorkerSyncServersRequest,
  type HistoryRequest,
  type IpcResult
} from '../types'
import type { ServerMetrics, DatabaseInfo } from '../../collectors/types'
import { resolveConnection } from './servers.ipc'
import { getAllGroupedByServer } from '../../store/sqlserver/serverDatabasesRepository'

export function registerMetricsHandlers(): void {
  // WORKER_START — avvia il worker con intervallo e lista server.
  // C2: il renderer non invia più credenziali; resolveConnection() le aggancia
  // dal serverStore lato main per ciascun server della lista.
  handle(
    IpcChannel.WORKER_START,
    async (_event: IpcMainInvokeEvent, req: WorkerStartRequest): Promise<IpcResult<null>> => {
      try {
        startWorker({ ...req, servers: req.servers.map(resolveConnection) })
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] WORKER_START:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // WORKER_STOP — ferma il worker
  handle(IpcChannel.WORKER_STOP, async (): Promise<IpcResult<null>> => {
    stopWorker()
    return { ok: true, data: null }
  })

  // WORKER_SET_ACTIVE — segnala quale server è "attivo" (polling più frequente)
  handle(
    IpcChannel.WORKER_SET_ACTIVE,
    (_e: IpcMainInvokeEvent, req: WorkerSetActiveRequest): IpcResult<null> => {
      setActiveServer(req.serverId)
      return { ok: true, data: null }
    }
  )

  // WORKER_SYNC_SERVERS — UPSERT server list without full restart.
  // C2: same credential resolution pattern as WORKER_START.
  handle(
    IpcChannel.WORKER_SYNC_SERVERS,
    (_e: IpcMainInvokeEvent, req: WorkerSyncServersRequest): IpcResult<null> => {
      syncServers(req.servers.map(resolveConnection))
      return { ok: true, data: null }
    }
  )

  // METRICS_HISTORY — restituisce gli snapshot del worker per un server
  handle(
    IpcChannel.METRICS_HISTORY,
    async (
      _event: IpcMainInvokeEvent,
      req: HistoryRequest
    ): Promise<IpcResult<ServerMetrics[]>> => {
      const history = getHistory(req.ip, req.port)
      log.info(
        '[Main] metrics:history richiesta per',
        `${req.ip}:${req.port}`,
        '— snapshot:',
        history.length
      )
      return { ok: true, data: history }
    }
  )

  // METRICS_HISTORY_BULK — proxied to service HTTP
  handle(
    IpcChannel.METRICS_HISTORY_BULK,
    async (): Promise<IpcResult<Record<string, ServerMetrics[]>>> => {
      try {
        const res = await serviceApi.getMetricsHistoryBulk()
        return res as IpcResult<Record<string, ServerMetrics[]>>
      } catch (err) {
        log.error('[IPC] METRICS_HISTORY_BULK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // METRICS_DATABASES_BULK — reads directly from dbo.server_databases.
  // No service dependency: always available at startup, returns the last known
  // database list per server so the renderer can show databases immediately.
  handle(
    IpcChannel.METRICS_DATABASES_BULK,
    async (): Promise<IpcResult<Record<string, DatabaseInfo[]>>> => {
      try {
        return { ok: true, data: await getAllGroupedByServer() }
      } catch (err) {
        log.error('[IPC] METRICS_DATABASES_BULK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
