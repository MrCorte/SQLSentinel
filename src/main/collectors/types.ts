export interface ServerConnection {
  ip: string
  port: number
  /** Stored for UI display only — not passed to the driver (SQL Browser disabled, port always explicit) */
  instanceName?: string
  username?: string
  password?: string
  useWindowsAuth: boolean
  /** TLS encryption for the TDS channel. Default: true. */
  encrypt?: boolean
  /** Accept self-signed certs. Default: true (most monitored SQL servers use self-signed certs). */
  trustServerCertificate?: boolean
}

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
  logicalCpus: number // cpu_count from sys.dm_os_sys_info (includes HT threads)
  physicalCpus: number // cpu_count / hyperthread_ratio
  machineName?: string // SERVERPROPERTY('MachineName') — used for AG replica matching
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
  // Custom fields — populated by the merge with the store, not from the SQL query
  alias?: string
  referente?: string
  /** ISO 8601 — set by the worker at the moment of first detection of the non-ONLINE state */
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
  /** Present only on delta updates pushed to renderer — merge instead of replace */
  isDelta?: boolean
  /** Names of databases that were dropped since the previous snapshot (delta only) */
  removedDbs?: string[]
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
