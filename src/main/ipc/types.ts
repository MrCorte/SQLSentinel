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
  // Persistent server store (electron-store backed)
  SERVERS_GET_ALL = 'servers:getAll',
  SERVERS_ADD = 'servers:add',
  SERVERS_UPDATE = 'servers:update',
  SERVERS_REMOVE_BY_ID = 'servers:removeById',
  // Push events — main → renderer
  SERVER_UNREACHABLE = 'server:unreachable',
  SERVER_RECOVERED = 'server:recovered',
  COLLECT_METRICS = 'metrics:collect',
  METRICS_UPDATED = 'metrics:updated', // push-only: main → renderer
  ALERT_NEW = 'metrics:alert-new', // push-only: main → renderer
  WORKER_START = 'worker:start',
  WORKER_STOP = 'worker:stop',
  ALERTS_GET_ALL = 'alerts:get-all',
  ALERTS_ACKNOWLEDGE = 'alerts:acknowledge',
  METRICS_HISTORY = 'metrics:history',
  SETTINGS_GET = 'settings:get',
  SETTINGS_SET = 'settings:set',
  DB_GET_CUSTOM_FIELDS = 'db:get-custom-fields',
  DB_SET_CUSTOM_FIELDS = 'db:set-custom-fields',
  DB_GET_ALL_CUSTOM_FIELDS = 'db:get-all-custom-fields',
  EXPORT_CUSTOM_FIELDS = 'export:customFields',
  EXPORT_INVENTORY = 'export:inventory',
  EXPORT_ALERTS = 'export:alerts',
  FILE_SAVE_CSV = 'file:saveCsv'
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

export type AlertCategory =
  | 'cpu_high'
  | 'blocking_sessions'
  | 'database_offline'
  | 'backup_overdue'
  | 'disk_space_low'
export type AlertSeverity = 'WARNING' | 'CRITICAL'

export interface Alert {
  id: string
  serverId: string
  category: AlertCategory
  severity: AlertSeverity
  message: string
  detectedAt: Date
  acknowledgedAt: Date | null
}

export interface WorkerStartRequest {
  intervalSeconds: number
  servers: CollectMetricsRequest[]
}

export interface AcknowledgeAlertRequest {
  alertId: string
}

export interface HistoryRequest {
  ip: string
  port: number
}

export interface AppSettings {
  retentionMinutes: number
}

export interface SaveSettingsRequest {
  retentionMinutes?: number
}

export interface DbCustomFields {
  alias?: string
  referente?: string
}

export interface DbCustomFieldsGetRequest {
  serverId: string
  dbName: string
}

export interface DbCustomFieldsSetRequest {
  serverId: string
  dbName: string
  fields: DbCustomFields
}

export interface SaveCsvRequest {
  filename: string
  content: string
}

// --- Per-channel response types ---

export type ScanSubnetResponse = IpcResult<DiscoveredServer[]>
export type AddServerManualResponse = IpcResult<DiscoveredServer>
export type GetServersResponse = IpcResult<DiscoveredServer[]>
export type RemoveServerResponse = IpcResult<null>
export type CollectMetricsResponse = IpcResult<ServerMetrics>

// --- Persistent server store types ---

export type { StoredServer } from '../store/serverStore'

export interface ServerAddResult {
  success: boolean
  reason?: string
  server?: import('../store/serverStore').StoredServer
}

export interface UpdateServerRequest {
  id: string
  patch: Partial<import('../store/serverStore').StoredServer>
}

export interface ServerUnreachableEvent {
  serverId: string
  ip: string
  port: number
  since: string // ISO 8601
}

// Re-export types so consumers have a single import point
export type { DiscoveredServer, ScanOptions, ScanProgress }
export type { ServerMetrics }
