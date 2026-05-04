import type { IpcMainInvokeEvent } from 'electron'
import { dialog } from 'electron'
import { promises as dns } from 'dns'
import { readFileSync, writeFileSync } from 'node:fs'
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
import * as serverStore from '../../store/serverStore'
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
  type ServerInfo,
  type ServerBackupImportResult
} from '../types'
import type { StoredServer } from '../../store/serverStore'
import {
  exportForBackup,
  importFromBackup,
  writeAutoBackup
} from '../../store/serverStore'
import type { ScanOptions } from '../../discovery/types'

// Re-export resolveConnection so metrics.ipc.ts and system.ipc.ts can import it
// from a single location without reaching into the service layer themselves.
export { resolveConnection }

// Single-shot scan controller — only one scan runs at a time. A new SCAN_SUBNET
// invocation aborts the previous one (defensive) and SCAN_CANCEL aborts the active one.
let activeScanController: AbortController | null = null

export function registerServerHandlers(): void {
  // SCAN_SUBNET — runs async TCP scan, streams progress events back to renderer
  handle(
    IpcChannel.SCAN_SUBNET,
    async (event: IpcMainInvokeEvent, options: ScanOptions): Promise<ScanSubnetResponse> => {
      // Abort any prior scan before starting a new one.
      activeScanController?.abort()
      const controller = new AbortController()
      activeScanController = controller
      try {
        const results = await scanSubnet(
          options,
          (progress) => {
            event.sender.send(IpcChannel.SCAN_PROGRESS, progress)
          },
          controller.signal
        )
        return { ok: true, data: results }
      } catch (err) {
        log.error('[IPC] SCAN_SUBNET:', safeError(err))
        return { ok: false, error: 'Subnet scan failed' }
      } finally {
        if (activeScanController === controller) activeScanController = null
      }
    }
  )

  // SCAN_CANCEL — abort the in-flight subnet scan (if any).
  handle(IpcChannel.SCAN_CANCEL, async (): Promise<IpcResult<{ cancelled: boolean }>> => {
    if (!activeScanController) return { ok: true, data: { cancelled: false } }
    activeScanController.abort()
    return { ok: true, data: { cancelled: true } }
  })

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

  const isWin = process.platform === 'win32'

  // SERVERS_GET_ALL — Windows: proxied to service HTTP; macOS/Linux: direct SQLite
  handle(IpcChannel.SERVERS_GET_ALL, async (): Promise<IpcResult<StoredServer[]>> => {
    try {
      if (isWin) {
        const res = await serviceApi.getServers()
        return res as IpcResult<StoredServer[]>
      }
      // Skip decryption entirely — credentials are stripped before crossing the IPC boundary anyway
      return { ok: true, data: serverStore.getAllStripped() }
    } catch (err) {
      log.error('[IPC] SERVERS_GET_ALL:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  // SERVERS_ADD — Windows: proxied to service HTTP; macOS/Linux: direct SQLite
  handle(
    IpcChannel.SERVERS_ADD,
    async (
      _event: IpcMainInvokeEvent,
      params: Omit<StoredServer, 'id' | 'addedAt'>
    ): Promise<IpcResult<ServerAddResult>> => {
      try {
        if (isWin) {
          const res = await serviceApi.addServer(params)
          return res as IpcResult<ServerAddResult>
        }
        const result = serverStore.add(params)
        if (result.server) result.server = serverStore.stripCredentials(result.server)
        return { ok: true, data: result }
      } catch (err) {
        log.error('[IPC] SERVERS_ADD:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // SERVERS_UPDATE — Windows: proxied to service HTTP; macOS/Linux: direct SQLite
  handle(
    IpcChannel.SERVERS_UPDATE,
    async (
      _event: IpcMainInvokeEvent,
      id: string,
      patch: Partial<StoredServer>
    ): Promise<IpcResult<{ success: boolean }>> => {
      try {
        if (isWin) {
          await serviceApi.updateServer(id, patch)
          return { ok: true, data: { success: true } }
        }
        serverStore.update(id, patch)
        return { ok: true, data: { success: true } }
      } catch (err) {
        log.error('[IPC] SERVERS_UPDATE:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // SERVERS_REMOVE_BY_ID — Windows: proxied to service HTTP; macOS/Linux: direct SQLite
  handle(
    IpcChannel.SERVERS_REMOVE_BY_ID,
    async (_event: IpcMainInvokeEvent, id: string): Promise<IpcResult<{ success: boolean }>> => {
      try {
        if (isWin) {
          await serviceApi.removeServer(id)
          return { ok: true, data: { success: true } }
        }
        serverStore.remove(id)
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

  // RESOLVE_HOSTNAME — DNS reverse lookup (PTR) for an IPv4 address
  handle(
    IpcChannel.RESOLVE_HOSTNAME,
    async (_event: IpcMainInvokeEvent, ip: string): Promise<IpcResult<string>> => {
      try {
        const hostnames = await dns.reverse(ip)
        const hostname = (hostnames[0] ?? '').replace(/\.$/, '')
        return hostname ? { ok: true, data: hostname } : { ok: false, error: 'No PTR record' }
      } catch (err) {
        log.error('[IPC] RESOLVE_HOSTNAME:', safeError(err))
        return { ok: false, error: 'No PTR record' }
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

  // SERVERS_EXPORT_BACKUP — shows Save dialog, writes JSON backup sans passwords
  handle(
    IpcChannel.SERVERS_EXPORT_BACKUP,
    async (): Promise<IpcResult<{ saved: boolean }>> => {
      try {
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export server backup',
          defaultPath: `sqlsentinel-backup-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON backup', extensions: ['json'] }]
        })
        if (canceled || !filePath) return { ok: true, data: { saved: false } }
        const json = exportForBackup()
        writeFileSync(filePath, json, 'utf8')
        return { ok: true, data: { saved: true } }
      } catch (err) {
        log.error('[IPC] SERVERS_EXPORT_BACKUP:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // SERVERS_IMPORT_BACKUP — shows Open dialog, imports servers from JSON backup
  handle(
    IpcChannel.SERVERS_IMPORT_BACKUP,
    async (): Promise<IpcResult<ServerBackupImportResult>> => {
      try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: 'Import server backup',
          filters: [{ name: 'JSON backup', extensions: ['json'] }],
          properties: ['openFile']
        })
        if (canceled || filePaths.length === 0)
          return { ok: true, data: { imported: 0, skipped: 0, errors: [] } }
        const json = readFileSync(filePaths[0], 'utf8')
        const result = importFromBackup(json)
        if (result.imported > 0) writeAutoBackup()
        return { ok: true, data: result }
      } catch (err) {
        log.error('[IPC] SERVERS_IMPORT_BACKUP:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
