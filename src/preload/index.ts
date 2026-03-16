import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannel } from '../main/ipc/types'
import type { ScanOptions, ScanProgress, DiscoveredServer } from '../main/discovery/types'
import type { ManualServerRequest, RemoveServerRequest, IpcResult } from '../main/ipc/types'

// Re-export types so the renderer can import them from this file.
// TypeScript resolves '../../../preload/index' to this file (index.ts) before
// index.d.ts, so types must be explicitly re-exported here.
// These are type-only exports — erased at compile time, no runtime effect.
export type { DiscoveredServer, ScanOptions, ScanProgress } from '../main/discovery/types'
export type { ManualServerRequest, RemoveServerRequest, IpcResult } from '../main/ipc/types'

const sqlSentinel = {
  scanSubnet: (options: ScanOptions): Promise<IpcResult<DiscoveredServer[]>> =>
    ipcRenderer.invoke(IpcChannel.SCAN_SUBNET, options),

  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, progress: ScanProgress) => callback(progress)
    ipcRenderer.on(IpcChannel.SCAN_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SCAN_PROGRESS, listener)
  },

  addServerManual: (req: ManualServerRequest): Promise<IpcResult<DiscoveredServer>> =>
    ipcRenderer.invoke(IpcChannel.ADD_SERVER_MANUAL, req),

  getServers: (): Promise<IpcResult<DiscoveredServer[]>> =>
    ipcRenderer.invoke(IpcChannel.GET_SERVERS),

  removeServer: (req: RemoveServerRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.REMOVE_SERVER, req)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', {})
    contextBridge.exposeInMainWorld('sqlSentinel', sqlSentinel)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = {}
  // @ts-ignore (define in dts)
  window.sqlSentinel = sqlSentinel
}
