import type { DiscoveredServer, ScanOptions, ScanProgress } from '../discovery/types'
import type { ServerMetrics } from '../collectors/types'

/**
 * IPC channel names. Regular enum (not const enum) to avoid
 * esbuild cross-file inlining issues with electron-vite.
 */
export enum IpcChannel {
  APP_VERSION = 'app:version',
  SCAN_SUBNET = 'discovery:scan-subnet',
  SCAN_PROGRESS = 'discovery:scan-progress', // push-only: main → renderer
  SCAN_CANCEL = 'discovery:scan-cancel',
  ADD_SERVER_MANUAL = 'servers:add-manual',
  GET_SERVERS = 'servers:get',
  REMOVE_SERVER = 'servers:remove',
  // Persistent server store (electron-store backed)
  SERVERS_GET_ALL = 'servers:getAll',
  SERVERS_ADD = 'servers:add',
  SERVERS_UPDATE = 'servers:update',
  SERVERS_REMOVE_BY_ID = 'servers:removeById',
  SERVERS_CLEAR_MOCKS = 'servers:clearMocks',
  // Push events — main → renderer
  SERVER_UNREACHABLE = 'server:unreachable',
  SERVER_RECOVERED = 'server:recovered',
  COLLECT_METRICS = 'metrics:collect',
  METRICS_UPDATED = 'metrics:updated', // push-only: main → renderer (legacy single-server)
  METRICS_BATCH_UPDATED = 'metrics:batchUpdated', // push-only: coalesced batch per polling cycle
  ALERT_NEW = 'metrics:alert-new', // push-only: main → renderer
  WORKER_START = 'worker:start',
  WORKER_STOP = 'worker:stop',
  WORKER_SET_ACTIVE = 'worker:setActive',
  WORKER_SYNC_SERVERS = 'worker:syncServers',
  SERVER_HEALTH_UPDATE = 'server:healthUpdate', // push-only: main → renderer
  ALERTS_GET_ALL = 'alerts:get-all',
  ALERTS_ACKNOWLEDGE = 'alerts:acknowledge',
  METRICS_HISTORY = 'metrics:history',
  METRICS_HISTORY_BULK = 'metrics:historyBulk',
  SETTINGS_GET = 'settings:get',
  SETTINGS_SET = 'settings:set',
  DB_GET_CUSTOM_FIELDS = 'db:get-custom-fields',
  DB_SET_CUSTOM_FIELDS = 'db:set-custom-fields',
  DB_GET_ALL_CUSTOM_FIELDS = 'db:get-all-custom-fields',
  EXPORT_CUSTOM_FIELDS = 'export:customFields',
  EXPORT_INVENTORY = 'export:inventory',
  EXPORT_ALERTS = 'export:alerts',
  FILE_SAVE_CSV = 'file:saveCsv',
  // DB admin operations
  DB_SHRINK = 'db:shrink',
  DB_SHRINK_FILE = 'db:shrinkFile',
  DB_SHRINK_ESTIMATE = 'db:shrinkEstimate',
  // Always On Availability Groups
  AG_GET_GROUPS = 'ag:getGroups',
  AG_GET_REPLICAS = 'ag:getReplicas',
  AG_GET_DATABASES = 'ag:getDatabases',
  EXPORT_INVENTORY_CSV = 'export:inventoryCsv',
  // Push: worker detected AG membership changes — updates StoredServer records
  SERVER_CONFIG_UPDATED = 'server:configUpdated',
  // App visibility — pushed from main to renderer on window blur/focus
  APP_BACKGROUND = 'app:background',
  APP_FOREGROUND = 'app:foreground',
  SERVICE_STATUS_GET = 'service:statusGet',
  // Server detection — MachineName + InstanceName via SERVERPROPERTY
  DETECT_SERVER_INFO = 'servers:detectInfo',
  // Hostname resolution — DNS reverse lookup (PTR record)
  RESOLVE_HOSTNAME = 'servers:resolveHostname',
  // Server configuration backup / restore (file dialogs)
  SERVERS_EXPORT_BACKUP = 'servers:exportBackup',
  SERVERS_IMPORT_BACKUP = 'servers:importBackup',
  // Email alerting
  EMAIL_SETTINGS_GET = 'email:getSettings',
  EMAIL_SETTINGS_SET = 'email:setSettings',
  EMAIL_TEST = 'email:test',
  // Authentication
  AUTH_LOGIN = 'auth:login',
  AUTH_LOGOUT = 'auth:logout',
  AUTH_CHECK = 'auth:check',
  AUTH_CHANGE_PASSWORD = 'auth:changePassword',
  // AI assistant (Ollama local)
  AI_ASK = 'ai:ask',
  AI_CHECK = 'ai:check',
  // AI LangGraph agent (tool calling, local Ollama)
  AI_AGENT_ASK = 'ai:agentAsk',
  AI_AGENT_STREAM = 'ai:agentStream', // invoke: starts stream, returns IpcResult<void> immediately
  AI_AGENT_CANCEL = 'ai:agentCancel', // invoke: aborts active stream
  AI_STREAM_EVENT = 'ai:streamEvent', // push-only: main → renderer
  // AI provider settings (Ollama / Claude)
  AI_GET_SETTINGS = 'ai:getSettings',
  AI_SAVE_SETTINGS = 'ai:saveSettings',
  AI_CHECK_PROVIDER = 'ai:checkProvider',
  // Storage connection management
  STORAGE_GET_CONFIG      = 'storage:get-config',
  STORAGE_TEST_CONNECTION = 'storage:test-connection',
  STORAGE_SAVE_CONFIG     = 'storage:save-config',
  STORAGE_SAFE_STORAGE_STATUS = 'storage:safeStorageStatus',
  // Incident management
  INCIDENTS_LIST           = 'incidents:list',
  INCIDENTS_GET            = 'incidents:get',
  INCIDENTS_SET_STATUS     = 'incidents:setStatus',
  INCIDENTS_COUNT_OPEN     = 'incidents:countOpen',
  INCIDENTS_EXPORT_POSTMORTEM = 'incidents:exportPostmortem',
  INCIDENTS_RUN_AGENT      = 'incidents:runAgent',
  INCIDENTS_APPROVE_ACTION = 'incidents:approveAction',
  INCIDENTS_REJECT_ACTION  = 'incidents:rejectAction',
  INCIDENT_CREATED         = 'incident:created',   // push: main → renderer
  INCIDENT_UPDATED         = 'incident:updated',   // push: main → renderer
  INCIDENT_EVENT           = 'incident:event',     // push: main → renderer
  INCIDENT_ACTION          = 'incident:action',    // push: main → renderer
  INCIDENT_AGENT_EVENT     = 'incident:agentEvent' // push: AiStreamEvent for live token streaming
}

/** Unified result envelope — never throw raw errors to the renderer. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export type AiProviderName = 'ollama' | 'claude'

export interface AiProviderSettings {
  provider: AiProviderName
  ollamaModel: string
  /** Claude API key — returned masked (first 8 chars + '…') on read, full value on save */
  claudeApiKey?: string
  claudeModel: string
}

export type AiStreamEvent =
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; output: string }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

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
  /** TLS encryption for TDS channel — default true */
  encrypt?: boolean
  /** Accept self-signed certs — default true (most monitored boxes use self-signed) */
  trustServerCertificate?: boolean
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
  activeServerId?: string
  /**
   * When true (default), spread initial nextRun across the polling interval to
   * prevent thundering-herd at boot. Set to false in deterministic test runs.
   */
  staggerStartup?: boolean
}

export interface WorkerSetActiveRequest {
  serverId: string
}

export interface WorkerSyncServersRequest {
  servers: CollectMetricsRequest[]
}

/** Pushed to renderer after every poll attempt (success or failure). */
export interface ServerHealthPayload {
  serverId: string
  failCount: number
  nextRetry: number // ms timestamp
  lastSuccess: number | null // ms timestamp
}

export interface ExportInventoryCsvRequest {
  rows: string[][]
  headers: string[]
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
  backgroundEnabled: boolean
  backgroundMode: 'light' | 'full'
  backgroundIntervalMinutes: number
  backgroundNotifications: boolean
  themeMode: 'light' | 'dark' | 'system'
  autostartEnabled: boolean
}

export interface SaveSettingsRequest {
  retentionMinutes?: number
  backgroundEnabled?: boolean
  backgroundMode?: 'light' | 'full'
  backgroundIntervalMinutes?: number
  backgroundNotifications?: boolean
  themeMode?: 'light' | 'dark' | 'system'
  autostartEnabled?: boolean
}

export interface EmailSettings {
  emailEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpTls: boolean
  emailRecipients: string[]
}

export interface SaveEmailSettingsRequest {
  emailEnabled?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPassword?: string
  smtpTls?: boolean
  emailRecipients?: string[]
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

// --- Shrink operation types ---

export interface ShrinkDatabaseParams {
  connection: CollectMetricsRequest
  dbName: string
  targetPercent: number // 0–99
}

export interface ShrinkFileParams {
  connection: CollectMetricsRequest
  dbName: string
  fileName: string
  targetSizeMb: number
  isLog: boolean
}

export interface ShrinkEstimateParams {
  connection: CollectMetricsRequest
  dbName: string
}

export interface ShrinkEstimate {
  file_name: string
  current_mb: number
  used_mb: number
  reclaimable_mb: number
}

export interface ShrinkResult {
  success: boolean
  duration_ms: number
  newSizeMb?: number
  reclaimedMb?: number
  error?: string
}

// --- Always On Availability Groups ---

export interface AgParams {
  connection: CollectMetricsRequest
}

// --- Auth types ---

export interface AuthSession {
  token: string
  userId: string
  username: string
  role: string
  expiresAt: number
  mustChangePassword: boolean
}

export interface LoginResult {
  success: boolean
  mustChangePassword?: boolean
  error?: string
}

export interface ChangePasswordResult {
  success: boolean
  error?: string
}

export interface ServerBackupImportResult {
  imported: number
  skipped: number
  errors: string[]
}

// Re-export types so consumers have a single import point
export type { DiscoveredServer, ScanOptions, ScanProgress }
export type { ServerMetrics }
export type { ServerInfo } from '../collectors/types'

export interface StorageConnectionParams {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt?: boolean
  trustServerCertificate?: boolean
}

export interface StorageConfigInfo {
  host: string
  port: number
  database: string
  username: string
  encrypt: boolean
  trustServerCertificate: boolean
}

export type { SchemaInitResult } from '../store/sqlserver/database'
export type {
  AvailabilityGroup,
  AvailabilityReplica,
  AvailabilityDatabase,
  AgHealth,
  AgRole
} from '../collectors/types'

// ---------------------------------------------------------------------------
// Incident management types (re-exported for preload bridge)
// ---------------------------------------------------------------------------

export type {
  Incident,
  IncidentEvent,
  IncidentAction,
  IncidentAuditEntry,
  IncidentStatus,
  IncidentEventKind,
  ActionStatus
} from '../incidents/types'

export interface IncidentSetStatusRequest {
  id: string
  status: import('../incidents/types').IncidentStatus
}

export interface IncidentListRequest {
  status?: import('../incidents/types').IncidentStatus
}

export interface IncidentDetail {
  incident: import('../incidents/types').Incident
  events: import('../incidents/types').IncidentEvent[]
  actions: import('../incidents/types').IncidentAction[]
}
