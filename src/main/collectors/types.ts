export interface ServerConnection {
  ip: string
  port: number
  /** Stored for UI display only — not passed to the driver (SQL Browser disabled, port always explicit) */
  instanceName?: string
  username?: string
  password?: string
  useWindowsAuth: boolean
}

export interface InstanceInfo {
  version: string
  edition: string
  memoryUsedMb: number
  memoryTargetMb: number
  cpuUsagePercent: number
  uptimeDays: number
}

export interface DatabaseInfo {
  name: string
  stateDesc: string
  recoveryModel: string
  sizeMb: number
  logSizeMb: number
  // Campi custom — popolati dal merge con lo store, non dalla query SQL
  alias?: string
  referente?: string
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
}
