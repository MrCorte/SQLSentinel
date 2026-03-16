import type { DiscoveredServer, ScanOptions, ScanProgress } from '../discovery/types'
import type { ServerMetrics } from '../collectors/types'

/**
 * IPC channel names. Regular enum (not const enum) to avoid
 * esbuild cross-file inlining issues with electron-vite.
 */
export enum IpcChannel {
  SCAN_SUBNET = 'discovery:scan-subnet',
  SCAN_PROGRESS = 'discovery:scan-progress', // push-only: main → renderer
  ADD_SERVER_MANUAL = 'servers:add-manual',
  GET_SERVERS = 'servers:get',
  REMOVE_SERVER = 'servers:remove',
  COLLECT_METRICS = 'metrics:collect'
}

/** Unified result envelope — never throw raw errors to the renderer. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

// --- Per-channel request types ---

export interface ManualServerRequest {
  ip: string
  port: number
  instanceName?: string
}

export interface RemoveServerRequest {
  ip: string
  port: number
}

export interface CollectMetricsRequest {
  ip: string
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  password?: string
}

// --- Per-channel response types ---

export type ScanSubnetResponse = IpcResult<DiscoveredServer[]>
export type AddServerManualResponse = IpcResult<DiscoveredServer>
export type GetServersResponse = IpcResult<DiscoveredServer[]>
export type RemoveServerResponse = IpcResult<null>
export type CollectMetricsResponse = IpcResult<ServerMetrics>

// Re-export types so consumers have a single import point
export type { DiscoveredServer, ScanOptions, ScanProgress }
export type { ServerMetrics }
