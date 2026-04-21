import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { resetAgent } from '../../ai/langGraphAgent'
import { scanSubnet, scanHost } from '../../discovery/tcpScanner'
import { collectMetrics, detectServerInfo } from '../../collectors/sqlCollector'
import * as serverStore from '../../store/serverStore'
import type { StoredServer } from '../../store/serverStore'
import { getAllCustomFields } from '../../store/dbCustomFields'
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
} from '../types'
import type { DiscoveredServer, ScanOptions } from '../../discovery/types'

const stripCredentials = serverStore.stripCredentials

/** Convert StoredServer → DiscoveredServer shape for legacy callers */
function toDiscovered(s: StoredServer): DiscoveredServer {
  return {
    ip: s.host,
    port: s.port,
    reachable: !s.unreachable,
    responseTimeMs: 0,
    discoveredAt: new Date(s.addedAt),
  }
}

/**
 * C2 hardening: resolves credentials from serverStore when the renderer-supplied
 * request omits them. This allows handlers to accept the legacy
 * CollectMetricsRequest shape (ip/port + optional creds) while pulling the
 * actual password from encrypted storage on demand. SQL-auth requests without
 * a password get their creds hydrated here; Windows-auth requests pass through.
 */
export function resolveConnection(req: CollectMetricsRequest): CollectMetricsRequest {
  if (req.useWindowsAuth) return req
  if (req.password) return req
  const stored = serverStore.getByIpPort(req.ip, req.port)
  if (!stored) return req
  return {
    ...req,
    username: req.username ?? stored.username,
    password: stored.password,
  }
}

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
        const probed = await scanHost(req.ip, req.port, 2000)
        serverStore.upsertByIpPort({
          host: probed.ip,
          port: probed.port,
          instanceName: req.instanceName,
          useWindowsAuth: true,
        })
        return { ok: true, data: probed }
      } catch (err) {
        log.error('[IPC] ADD_SERVER_MANUAL:', safeError(err))
        return { ok: false, error: 'Failed to add server' }
      }
    }
  )

  // GET_SERVERS — returns all persisted servers as DiscoveredServer shape (legacy)
  handle(IpcChannel.GET_SERVERS, async (): Promise<GetServersResponse> => {
    return { ok: true, data: serverStore.getAll().map(toDiscovered) }
  })

  // REMOVE_SERVER — removes by ip:port (legacy, used by Discovery context menu)
  handle(
    IpcChannel.REMOVE_SERVER,
    async (
      _event: IpcMainInvokeEvent,
      req: RemoveServerRequest
    ): Promise<RemoveServerResponse> => {
      const existing = serverStore.getByIpPort(req.ip, req.port)
      if (existing) serverStore.remove(existing.id)
      return { ok: true, data: null }
    }
  )

  // SERVERS_GET_ALL — returns StoredServer[] with credentials removed (C2).
  // The renderer never handles plaintext passwords — operations that need
  // credentials resolve them server-side via resolveConnection().
  handle(IpcChannel.SERVERS_GET_ALL, (): StoredServer[] => {
    try {
      return serverStore.getAll().map(stripCredentials)
    } catch (err) {
      log.error('[IPC] SERVERS_GET_ALL:', safeError(err))
      return []
    }
  })

  // SERVERS_ADD — returns { success, reason?, server? } directly (flat, no IpcResult wrapper).
  // C2: strip credentials from returned server payload before it crosses IPC.
  handle(
    IpcChannel.SERVERS_ADD,
    (
      _event: IpcMainInvokeEvent,
      params: Omit<StoredServer, 'id' | 'addedAt'>
    ): ServerAddResult => {
      try {
        const result = serverStore.add(params)
        if (result.server) result.server = stripCredentials(result.server)
        return result
      } catch (err) {
        log.error('[IPC] SERVERS_ADD:', safeError(err))
        return { success: false, reason: safeError(err) }
      }
    }
  )

  // SERVERS_UPDATE — takes (id, patch) as separate args (flat response)
  handle(
    IpcChannel.SERVERS_UPDATE,
    (
      _event: IpcMainInvokeEvent,
      id: string,
      patch: Partial<StoredServer>
    ): { success: boolean } => {
      try {
        serverStore.update(id, patch)
        resetAgent()
        return { success: true }
      } catch (err) {
        log.error('[IPC] SERVERS_UPDATE:', safeError(err))
        return { success: false }
      }
    }
  )

  // SERVERS_REMOVE_BY_ID — removes a server from electron-store by UUID (flat response)
  handle(
    IpcChannel.SERVERS_REMOVE_BY_ID,
    (_event: IpcMainInvokeEvent, id: string): { success: boolean } => {
      try {
        serverStore.remove(id)
        resetAgent()
        return { success: true }
      } catch (err) {
        log.error('[IPC] SERVERS_REMOVE_BY_ID:', safeError(err))
        return { success: false }
      }
    }
  )

  // SERVERS_CLEAR_MOCKS — rimuove server con id che inizia con 'mock-' (usati dal preload mock)
  handle(
    IpcChannel.SERVERS_CLEAR_MOCKS,
    (): { success: boolean; removed: number; remaining: number } => {
      try {
        const before = serverStore.getAll()
        const mocks = before.filter((s) => s.id.startsWith('mock-'))
        mocks.forEach((s) => serverStore.remove(s.id))
        const after = serverStore.getAll()
        log.info(`[clearMocks] rimossi ${mocks.length} mock, rimasti: ${after.length}`)
        return { success: true, removed: mocks.length, remaining: after.length }
      } catch (err) {
        log.error('[IPC] servers:clearMocks:', safeError(err))
        return { success: false, removed: 0, remaining: -1 }
      }
    }
  )

  // DETECT_SERVER_INFO — test connection + retrieve MachineName / InstanceName
  handle(
    IpcChannel.DETECT_SERVER_INFO,
    async (
      _event: IpcMainInvokeEvent,
      req: CollectMetricsRequest
    ): Promise<IpcResult<import('../types').ServerInfo>> => {
      try {
        const info = await detectServerInfo(resolveConnection(req))
        return { ok: true, data: info }
      } catch (err) {
        log.error('[IPC] DETECT_SERVER_INFO:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // COLLECT_METRICS — connects to SQL Server and collects all metrics
  handle(
    IpcChannel.COLLECT_METRICS,
    async (
      _event: IpcMainInvokeEvent,
      req: CollectMetricsRequest
    ): Promise<CollectMetricsResponse> => {
      try {
        const metrics = await collectMetrics(resolveConnection(req))
        // Merge campi custom nei DatabaseInfo
        const sid = `${req.ip}:${req.port}`
        const allCf = getAllCustomFields()
        const enriched = {
          ...metrics,
          databases: metrics.databases.map((db) => ({
            ...db,
            ...(allCf[`${sid}/${db.name}`] ?? {}),
          })),
        }
        return { ok: true, data: enriched }
      } catch (err) {
        log.error('[IPC] COLLECT_METRICS:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
