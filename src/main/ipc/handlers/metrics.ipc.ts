import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import {
  startWorker,
  stopWorker,
  setActiveServer,
  syncServers,
  getHistory,
  getHistoryAll
} from '../../metricsWorker'
import {
  IpcChannel,
  type WorkerStartRequest,
  type WorkerSetActiveRequest,
  type WorkerSyncServersRequest,
  type HistoryRequest,
  type IpcResult
} from '../types'
import type { ServerMetrics } from '../../collectors/types'
import { resolveConnection } from './servers.ipc'

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

  // METRICS_HISTORY_BULK — restituisce tutta la history in-memory al boot (pre-popolata da SQLite)
  handle(
    IpcChannel.METRICS_HISTORY_BULK,
    async (): Promise<IpcResult<Record<string, ServerMetrics[]>>> => {
      return { ok: true, data: getHistoryAll() }
    }
  )
}
