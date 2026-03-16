import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
  IpcChannel,
  type ManualServerRequest,
  type RemoveServerRequest,
  type ScanSubnetResponse,
  type AddServerManualResponse,
  type GetServersResponse,
  type RemoveServerResponse
} from './types'
import type { DiscoveredServer, ScanOptions } from '../discovery/types'
import { scanSubnet, scanHost } from '../discovery/tcpScanner'

// Temporary in-memory store — will be replaced by SQLite persistence in FASE 4
let knownServers: DiscoveredServer[] = []

function serverKey(ip: string, port: number): string {
  return `${ip}:${port}`
}

function upsertServer(server: DiscoveredServer): void {
  const key = serverKey(server.ip, server.port)
  const idx = knownServers.findIndex((s) => serverKey(s.ip, s.port) === key)
  if (idx >= 0) {
    knownServers[idx] = server
  } else {
    knownServers.push(server)
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
        results.forEach(upsertServer)
        return { ok: true, data: results }
      } catch (err) {
        console.error('[IPC] SCAN_SUBNET:', safeError(err))
        return { ok: false, error: 'Subnet scan failed' }
      }
    }
  )

  // ADD_SERVER_MANUAL — TCP-probes the given host:port, then persists it
  ipcMain.handle(
    IpcChannel.ADD_SERVER_MANUAL,
    async (_event: IpcMainInvokeEvent, req: ManualServerRequest): Promise<AddServerManualResponse> => {
      try {
        const server = await scanHost(req.ip, req.port, 2000)
        upsertServer(server)
        return { ok: true, data: server }
      } catch (err) {
        console.error('[IPC] ADD_SERVER_MANUAL:', safeError(err))
        return { ok: false, error: 'Failed to add server' }
      }
    }
  )

  // GET_SERVERS — returns all known servers (discovered + manual)
  ipcMain.handle(
    IpcChannel.GET_SERVERS,
    async (): Promise<GetServersResponse> => {
      return { ok: true, data: [...knownServers] }
    }
  )

  // REMOVE_SERVER — removes by ip:port key
  ipcMain.handle(
    IpcChannel.REMOVE_SERVER,
    async (_event: IpcMainInvokeEvent, req: RemoveServerRequest): Promise<RemoveServerResponse> => {
      const key = serverKey(req.ip, req.port)
      knownServers = knownServers.filter((s) => serverKey(s.ip, s.port) !== key)
      return { ok: true, data: null }
    }
  )
}
