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

export interface SqlSentinelAPI {
  scanSubnet(options: ScanOptions): Promise<IpcResult<DiscoveredServer[]>>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  addServerManual(req: ManualServerRequest): Promise<IpcResult<DiscoveredServer>>
  getServers(): Promise<IpcResult<DiscoveredServer[]>>
  removeServer(req: RemoveServerRequest): Promise<IpcResult<null>>
  collectMetrics(req: CollectMetricsRequest): Promise<IpcResult<ServerMetrics>>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    sqlSentinel: SqlSentinelAPI
  }
}
