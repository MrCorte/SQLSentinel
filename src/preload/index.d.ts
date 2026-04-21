import { ElectronAPI } from '@electron-toolkit/preload'

// Types mirroring src/main/discovery/types.ts and src/main/ipc/types.ts.
// Declared here (not imported from main) because this file is compiled
// under tsconfig.web.json which does not include src/main/.
// Renderer code can import these via: import type { ... } from '../../../preload/index'

export interface DiscoveredServer {
  ip: string
  port: number
  reachable: boolean
  responseTimeMs: number
  discoveredAt: Date
}

export interface ScanOptions {
  cidr: string
  ports: number[]
  timeoutMs: number
  concurrency: number
}

export interface ScanProgress {
  total: number
  completed: number
  found: number
}

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

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface ServerInfo {
  machineName: string
  instanceName: string | null
}

export interface InstanceInfo {
  version: string
  edition: string
  memoryUsedMb: number
  memoryTargetMb: number
  cpuUsagePercent: number
  uptimeDays: number
  logicalCpus: number
  physicalCpus: number
}

export interface HistoryRequest {
  ip: string
  port: number
}

export interface DatabaseInfo {
  name: string
  stateDesc: string
  recoveryModel: string
  sizeMb: number
  logSizeMb: number
  /** Compatibility level raw (80=SQL2000, 150=SQL2019, 160=SQL2022) — undefined for snapshots from older app versions */
  compatibilityLevel?: number
  /** TDE (Transparent Data Encryption) enabled — undefined for snapshots from older app versions */
  isEncrypted?: boolean
  isReadOnly?: boolean
  /** Database owner principal name — undefined for snapshots from older app versions */
  owner?: string
  /** Creation date — ISO 8601 string — undefined for snapshots from older app versions */
  createDate?: string
  alias?: string
  referente?: string
  /** ISO 8601 — set by the worker on first detection of a non-ONLINE state */
  offlineSince?: string
}

export interface SessionInfo {
  sessionId: number
  status: string
  blockingSessionId: number
  waitType: string
  waitTimeMs: number
  cpuTime: number
  logicalReads: number
}

export interface QueryInfo {
  queryText: string
  executionCount: number
  totalElapsedTimeMs: number
  avgCpuTimeMs: number
  avgLogicalReads: number
}

export interface BackupInfo {
  databaseName: string
  lastFullBackup: Date | null
  lastDiffBackup: Date | null
  lastLogBackup: Date | null
}

export interface WaitStatInfo {
  waitType: string
  waitTimeMs: number
  maxWaitTimeMs: number
  signalWaitTimeMs: number
  waitingTasksCount: number
  waitPercent: number
}

export interface StoredServer {
  id: string
  host: string              // canonical address — required
  ip?: string               // legacy alias; populated by normalization in serversStore.ts
  port: number
  instanceName?: string
  machineName?: string      // SERVERPROPERTY('MachineName') — used to group multiple instances on the same physical machine
  useWindowsAuth: boolean
  username?: string
  password?: string
  addedAt: string           // ISO 8601
  lastSeen?: string         // ISO 8601
  unreachable?: boolean
  unreachableSince?: string // ISO 8601
  agGroupId?: string        // group_id UUID if part of an AG
  agName?: string           // AG human-readable name, e.g. "AG-PROD-01"
  agRole?: AgRole
  logicalCpus?: number      // cpu_count (with HT); persisted from polling
  physicalCpus?: number     // cpu_count / hyperthread_ratio
  notes?: string            // free-text notes; persisted in electron-store
}

export interface ServerAddResult {
  success: boolean
  reason?: string
  server?: StoredServer
}

export interface UpdateServerRequest {
  id: string
  patch: Partial<StoredServer>
}

export interface ServerUnreachableEvent {
  serverId: string
  ip: string
  port: number
  since: string // ISO 8601
}

export interface DiskVolume {
  volume_mount_point: string
  logical_volume_name: string
  total_gb: number
  free_gb: number
  used_gb: number
  free_pct: number
}

export interface DatabaseFile {
  database_name: string
  file_name: string
  type_desc: 'ROWS' | 'LOG'
  physical_name: string
  size_mb: number
  used_mb: number
  free_mb: number
  max_mb: number | null
  is_percent_growth: boolean
  growth: number
}

export interface ServerMetrics {
  collectedAt: Date
  instanceInfo: InstanceInfo
  databases: DatabaseInfo[]
  activeSessions: SessionInfo[]
  topQueries: QueryInfo[]
  backupStatus: BackupInfo[]
  waitStats: WaitStatInfo[]
  diskVolumes: DiskVolume[]
  databaseFiles: DatabaseFile[]
  /** Present only on delta updates from main process — merge instead of replace */
  isDelta?: boolean
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

export interface WorkerStartRequest {
  intervalSeconds: number
  servers: CollectMetricsRequest[]
  activeServerId?: string
}

export interface WorkerSetActiveRequest {
  serverId: string
}

export interface WorkerSyncServersRequest {
  servers: CollectMetricsRequest[]
}

export interface ServerHealthPayload {
  serverId: string
  failCount: number
  nextRetry: number
  lastSuccess: number | null
}

export interface ExportInventoryCsvRequest {
  rows: string[][]
  headers: string[]
}

export interface AcknowledgeAlertRequest {
  alertId: string
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

export interface SaveCsvRequest {
  filename: string
  content: string
}

export interface ShrinkDatabaseParams {
  connection: CollectMetricsRequest
  dbName: string
  targetPercent: number
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

// ---------------------------------------------------------------------------
// Always On Availability Groups
// ---------------------------------------------------------------------------

export type AgHealth = 'HEALTHY' | 'PARTIALLY_HEALTHY' | 'NOT_HEALTHY'
export type AgRole = 'PRIMARY' | 'SECONDARY' | 'RESOLVING'

export interface AvailabilityGroup {
  group_id: string
  ag_name: string
  primary_replica: string
  ag_health: AgHealth
  failure_condition_level: number
  health_check_timeout: number
}

export interface AvailabilityReplica {
  replica_id: string
  ag_name: string
  group_id: string
  replica_server_name: string
  role_desc: AgRole
  availability_mode_desc: 'SYNCHRONOUS_COMMIT' | 'ASYNCHRONOUS_COMMIT'
  failover_mode_desc: 'AUTOMATIC' | 'MANUAL'
  synchronization_health_desc: AgHealth
  connected_state_desc: 'CONNECTED' | 'DISCONNECTED'
  operational_state_desc: string
  recovery_health_desc: string
  endpoint_url: string
}

export interface AvailabilityDatabase {
  ag_name: string
  database_name: string
  synchronization_state_desc: 'SYNCHRONIZED' | 'SYNCHRONIZING' | 'NOT_SYNCHRONIZING'
  synchronization_health_desc: AgHealth
  is_suspended: boolean
  suspend_reason_desc: string | null
  log_send_queue_kb: number
  redo_queue_kb: number
  log_send_rate_kb: number
  redo_rate_kb: number
  last_commit_time: string | null
}

export interface AgParams {
  connection: CollectMetricsRequest
}

export interface AgGroup {
  id: string            // = group_id UUID
  ag_name: string
  health: AgHealth
  primary_replica: string
  serverIds: string[]   // ids of StoredServer that are part of this AG
}


export interface SqlSentinelAPI {
  scanSubnet(options: ScanOptions): Promise<IpcResult<DiscoveredServer[]>>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  addServerManual(req: ManualServerRequest): Promise<IpcResult<DiscoveredServer>>
  getServers(): Promise<IpcResult<DiscoveredServer[]>>
  removeServer(req: RemoveServerRequest): Promise<IpcResult<null>>
  detectServerInfo(req: CollectMetricsRequest): Promise<IpcResult<ServerInfo>>
  collectMetrics(req: CollectMetricsRequest): Promise<IpcResult<ServerMetrics>>
  workerStart(req: WorkerStartRequest): Promise<IpcResult<null>>
  workerStop(): Promise<IpcResult<null>>
  workerSetActive(req: WorkerSetActiveRequest): Promise<IpcResult<null>>
  workerSyncServers(req: WorkerSyncServersRequest): Promise<IpcResult<null>>
  onServerHealthUpdate(callback: (health: ServerHealthPayload) => void): () => void
  getAlerts(): Promise<IpcResult<Alert[]>>
  acknowledgeAlert(req: AcknowledgeAlertRequest): Promise<IpcResult<null>>
  getHistory(req: HistoryRequest): Promise<IpcResult<ServerMetrics[]>>
  getHistoryBulk(): Promise<IpcResult<Record<string, ServerMetrics[]>>>
  onMetricsUpdated(callback: (data: { serverId: string; metrics: ServerMetrics }) => void): () => void
  onMetricsBatchUpdated(callback: (batch: Array<{ serverId: string; metrics: ServerMetrics }>) => void): () => void
  onAlertNew(callback: (alert: Alert) => void): () => void
  getSettings(): Promise<IpcResult<AppSettings>>
  saveSettings(req: SaveSettingsRequest): Promise<IpcResult<null>>
  getEmailSettings(): Promise<IpcResult<EmailSettings>>
  saveEmailSettings(req: SaveEmailSettingsRequest): Promise<IpcResult<null>>
  sendTestEmail(): Promise<IpcResult<null>>
  getDbCustomFields(req: { serverId: string; dbName: string }): Promise<IpcResult<DbCustomFields>>
  setDbCustomFields(req: { serverId: string; dbName: string; fields: DbCustomFields }): Promise<IpcResult<null>>
  getAllDbCustomFields(): Promise<IpcResult<Record<string, DbCustomFields>>>
  exportCustomFields(): Promise<IpcResult<string>>
  exportInventory(): Promise<IpcResult<string>>
  exportAlerts(): Promise<IpcResult<string>>
  exportInventoryCsv(req: ExportInventoryCsvRequest): Promise<IpcResult<string | null>>
  saveCsv(req: SaveCsvRequest): Promise<IpcResult<string | null>>
  db: {
    shrinkEstimate(req: ShrinkEstimateParams): Promise<IpcResult<ShrinkEstimate[]>>
    shrink(req: ShrinkDatabaseParams): Promise<IpcResult<ShrinkResult>>
    shrinkFile(req: ShrinkFileParams): Promise<IpcResult<ShrinkResult>>
  }
  ag: {
    getGroups(req: AgParams): Promise<IpcResult<AvailabilityGroup[]>>
    getReplicas(req: AgParams): Promise<IpcResult<AvailabilityReplica[]>>
    getDatabases(req: AgParams): Promise<IpcResult<AvailabilityDatabase[]>>
  }
  servers: {
    getAll(): Promise<IpcResult<StoredServer[]>>
    add(params: Omit<StoredServer, 'id' | 'addedAt'>): Promise<IpcResult<ServerAddResult>>
    update(id: string, patch: Partial<StoredServer>): Promise<IpcResult<{ success: boolean }>>
    remove(id: string): Promise<IpcResult<{ success: boolean }>>
    clearMocks(): Promise<IpcResult<{ success: boolean; removed: number; remaining: number }>>
  }
  onServerUnreachable(callback: (data: ServerUnreachableEvent) => void): () => void
  onServerRecovered(callback: (serverId: string) => void): () => void
  /** Pushed by worker when AG detection updates StoredServer records in electron-store */
  onServerConfigUpdated(callback: (servers: StoredServer[]) => void): () => void
  onAppBackground(callback: () => void): () => void
  onAppForeground(callback: () => void): () => void
  login(username: string, password: string): Promise<LoginResult>
  logout(): Promise<{ success: boolean }>
  checkAuth(): Promise<{ authenticated: boolean; session: AuthSession | null }>
  changePassword(userId: string, oldPassword: string, newPassword: string): Promise<ChangePasswordResult>
  aiCheck(): Promise<IpcResult<boolean>>
  aiAgentAsk(question: string, history: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<IpcResult<string>>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    sqlSentinel: SqlSentinelAPI
  }
}
