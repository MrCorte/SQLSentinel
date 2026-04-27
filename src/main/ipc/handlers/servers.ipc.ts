import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { scanSubnet } from '../../discovery/tcpScanner'
import {
  resolveConnection,
  listServersLegacy,
  addServerManual,
  removeServer,
  clearMockServers,
  detectServer,
  collectMetricsWithCustomFields
} from '../../services/ServerService'
import { serviceApi } from '../../serviceClient'
import {
  IpcChannel,
  type ManualServerRequest,
  type RemoveServerRequest,
  type CollectMetricsRequest,
  type ScanSubnetResponse,
  type AddServerManualResponse,
  type GetServersResponse,
  type RemoveServerResponse,
  type CollectMetricsResponse,
  type IpcResult,
  type ServerAddResult,
  type ServerInfo
} from '../types'
import type { StoredServer } from '../../store/serverStore'
import type { ScanOptions } from '../../discovery/types'

// Re-export resolveConnection so metrics.ipc.ts and system.ipc.ts can import it
// from a single location without reaching into the service layer themselves.
export { resolveConnection }

export function registerServerHandlers(): void {
  // SCAN_SUBNET — runs async TCP scan, streams progress events back to renderer
  handle(
    IpcChannel.SCAN_SUBNET,
    async (event: IpcMainInvokeEvent, options: ScanOptions): Promise<ScanSubnetResponse> => {
      try {
        const results = await scanSubnet(options, (progress) => {
          event.sender.send(IpcChannel.SCAN_PROGRESS, progress)
        })
        return { ok: true, data: results }
      } catch (err) {
        log.error('[IPC] SCAN_SUBNET:', safeError(err))
        return { ok: false, error: 'Subnet scan failed' }
      }
    }
  )

  // ADD_SERVER_MANUAL — TCP-probes the given host:port, persists to electron-store
  handle(
    IpcChannel.ADD_SERVER_MANUAL,
    async (
      _event: IpcMainInvokeEvent,
      req: ManualServerRequest
    ): Promise<AddServerManualResponse> => {
      try {
        const probed = await addServerManual(req)
        return { ok: true, data: probed }
      } catch (err) {
        log.error('[IPC] ADD_SERVER_MANUAL:', safeError(err))
        return { ok: false, error: 'Failed to add server' }
      }
    }
  )

  // GET_SERVERS — returns all persisted servers as DiscoveredServer shape (legacy)
  handle(IpcChannel.GET_SERVERS, async (): Promise<GetServersResponse> => {
    try {
      return { ok: true, data: listServersLegacy() }
    } catch (err) {
      log.error('[IPC] GET_SERVERS:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  // REMOVE_SERVER — removes by ip:port (legacy, used by Discovery context menu)
  handle(
    IpcChannel.REMOVE_SERVER,
    async (_event: IpcMainInvokeEvent, req: RemoveServerRequest): Promise<RemoveServerResponse> => {
      try {
        removeServer(req)
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] REMOVE_SERVER:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // SERVERS_GET_ALL — proxied to service HTTP
  handle(IpcChannel.SERVERS_GET_ALL, async (): Promise<IpcResult<StoredServer[]>> => {
    try {
      const res = await serviceApi.getServers()
      return res as IpcResult<StoredServer[]>
    } catch (err) {
      log.error('[IPC] SERVERS_GET_ALL:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  // SERVERS_ADD — proxied to service HTTP
  handle(
    IpcChannel.SERVERS_ADD,
    async (
      _event: IpcMainInvokeEvent,
      params: Omit<StoredServer, 'id' | 'addedAt'>
    ): Promise<IpcResult<ServerAddResult>> => {
      try {
        const res = await serviceApi.addServer(params)
        return res as IpcResult<ServerAddResult>
      } catch (err) {
        log.error('[IPC] SERVERS_ADD:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // SERVERS_UPDATE — proxied to service HTTP
  handle(
    IpcChannel.SERVERS_UPDATE,
    async (
      _event: IpcMainInvokeEvent,
      id: string,
      patch: Partial<StoredServer>
    ): Promise<IpcResult<{ success: boolean }>> => {
      try {
        await serviceApi.updateServer(id, patch)
        return { ok: true, data: { success: true } }
      } catch (err) {
        log.error('[IPC] SERVERS_UPDATE:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // SERVERS_REMOVE_BY_ID — proxied to service HTTP
  handle(
    IpcChannel.SERVERS_REMOVE_BY_ID,
    async (_event: IpcMainInvokeEvent, id: string): Promise<IpcResult<{ success: boolean }>> => {
      try {
        await serviceApi.removeServer(id)
        return { ok: true, data: { success: true } }
      } catch (err) {
        log.error('[IPC] SERVERS_REMOVE_BY_ID:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // SERVERS_CLEAR_MOCKS — removes servers with id starting with 'mock-'
  handle(
    IpcChannel.SERVERS_CLEAR_MOCKS,
    (): IpcResult<{ success: boolean; removed: number; remaining: number }> => {
      try {
        const { removed, remaining } = clearMockServers()
        return { ok: true, data: { success: true, removed, remaining } }
      } catch (err) {
        log.error('[IPC] servers:clearMocks:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // DETECT_SERVER_INFO — test connection + retrieve MachineName / InstanceName
  handle(
    IpcChannel.DETECT_SERVER_INFO,
    async (
      _event: IpcMainInvokeEvent,
      req: CollectMetricsRequest
    ): Promise<IpcResult<ServerInfo>> => {
      try {
        const info = await detectServer(req)
        return { ok: true, data: info }
      } catch (err) {
        log.error('[IPC] DETECT_SERVER_INFO:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // COLLECT_METRICS — connects to SQL Server, collects metrics, enriches with custom fields
  handle(
    IpcChannel.COLLECT_METRICS,
    async (
      _event: IpcMainInvokeEvent,
      req: CollectMetricsRequest
    ): Promise<CollectMetricsResponse> => {
      try {
        const enriched = await collectMetricsWithCustomFields(req)
        return { ok: true, data: enriched }
      } catch (err) {
        log.error('[IPC] COLLECT_METRICS:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
