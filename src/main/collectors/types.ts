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
  cpuUsagePercent: number
  uptimeDays: number
}

export interface DatabaseInfo {
  name: string
  stateDesc: string
  recoveryModel: string
  sizeMb: number
  logSizeMb: number
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

export interface ServerMetrics {
  collectedAt: Date
  instanceInfo: InstanceInfo
  databases: DatabaseInfo[]
  activeSessions: SessionInfo[]
  topQueries: QueryInfo[]
  backupStatus: BackupInfo[]
}
