import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannel } from '../main/ipc/types'
import type { ScanOptions, ScanProgress, DiscoveredServer } from '../main/discovery/types'
import type {
  ManualServerRequest,
  RemoveServerRequest,
  CollectMetricsRequest,
  WorkerStartRequest,
  WorkerSetActiveRequest,
  WorkerSyncServersRequest,
  ServerHealthPayload,
  ExportInventoryCsvRequest,
  AcknowledgeAlertRequest,
  HistoryRequest,
  SaveSettingsRequest,
  AppSettings,
  DbCustomFields,
  DbCustomFieldsGetRequest,
  DbCustomFieldsSetRequest,
  SaveCsvRequest,
  Alert,
  IpcResult,
  ServerAddResult,
  ServerUnreachableEvent,
  ShrinkDatabaseParams,
  ShrinkFileParams,
  ShrinkEstimateParams,
  ShrinkEstimate,
  ShrinkResult,
  AgParams,
  AvailabilityGroup,
  AvailabilityReplica,
  AvailabilityDatabase,
  EmailSettings,
  SaveEmailSettingsRequest,
  AuthSession,
  LoginResult,
  ChangePasswordResult,
} from '../main/ipc/types'
import type { ServerMetrics, ServerInfo } from '../main/collectors/types'
import type { StoredServer } from '../main/store/serverStore'

// Re-export types so the renderer can import them from this file.
export type { DiscoveredServer, ScanOptions, ScanProgress } from '../main/discovery/types'
export type { ManualServerRequest, RemoveServerRequest, CollectMetricsRequest, IpcResult } from '../main/ipc/types'
export type { WorkerStartRequest, WorkerSetActiveRequest, WorkerSyncServersRequest, ExportInventoryCsvRequest, AcknowledgeAlertRequest, HistoryRequest, Alert, AppSettings, SaveSettingsRequest, ServerHealthPayload } from '../main/ipc/types'
export type { DbCustomFields, SaveCsvRequest, ServerAddResult, UpdateServerRequest, ServerUnreachableEvent } from '../main/ipc/types'
export type { ShrinkDatabaseParams, ShrinkFileParams, ShrinkEstimateParams, ShrinkEstimate, ShrinkResult } from '../main/ipc/types'
export type { AgParams, AvailabilityGroup, AvailabilityReplica, AvailabilityDatabase, AgHealth, AgRole } from '../main/ipc/types'
export type { EmailSettings, SaveEmailSettingsRequest } from '../main/ipc/types'
export type { AuthSession, LoginResult, ChangePasswordResult } from '../main/ipc/types'
export type { ServerMetrics } from '../main/collectors/types'
export type { ServerInfo } from '../main/collectors/types'
export type { InstanceInfo, DatabaseInfo, SessionInfo, QueryInfo, BackupInfo, WaitStatInfo, DiskVolume, DatabaseFile } from '../main/collectors/types'
export type { StoredServer } from '../main/store/serverStore'

// ---------------------------------------------------------------------------
// Mock data — usato solo quando VITE_MOCK_MODE === 'true'
// ---------------------------------------------------------------------------

const MOCK_SERVERS: DiscoveredServer[] = [
  { ip: '192.168.1.10', port: 1433, reachable: true, responseTimeMs: 12, discoveredAt: new Date() },
  { ip: '192.168.1.15', port: 1433, reachable: true, responseTimeMs: 28, discoveredAt: new Date() },
  { ip: '192.168.1.20', port: 1434, reachable: true, responseTimeMs: 45, discoveredAt: new Date() },
]

let mockStoredServers: StoredServer[] = [
  {
    id: 'mock-server-1',
    host: '192.168.1.10',
    port: 1433,
    useWindowsAuth: true,
    addedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    lastSeen: new Date(Date.now() - 60_000).toISOString()
  },
  {
    id: 'mock-server-2',
    host: '192.168.1.15',
    port: 1433,
    useWindowsAuth: true,
    addedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    lastSeen: new Date(Date.now() - 120_000).toISOString()
  }
]

const mockUnreachableListeners: Array<(data: ServerUnreachableEvent) => void> = []
const mockRecoveredListeners: Array<(serverId: string) => void> = []

// ---------------------------------------------------------------------------
// Mock AG data
// ---------------------------------------------------------------------------

const MOCK_AG_GROUPS: AvailabilityGroup[] = [
  {
    group_id: 'ag-001-0000-0000-0000-000000000001',
    ag_name: 'AG-PROD-01',
    primary_replica: '192.168.1.10',
    ag_health: 'HEALTHY',
    failure_condition_level: 3,
    health_check_timeout: 30000
  }
]

const MOCK_AG_REPLICAS: AvailabilityReplica[] = [
  {
    replica_id: 'r-001-0000-0000-0000-000000000001',
    ag_name: 'AG-PROD-01',
    group_id: 'ag-001-0000-0000-0000-000000000001',
    replica_server_name: '192.168.1.10',
    role_desc: 'PRIMARY',
    availability_mode_desc: 'SYNCHRONOUS_COMMIT',
    failover_mode_desc: 'AUTOMATIC',
    synchronization_health_desc: 'HEALTHY',
    connected_state_desc: 'CONNECTED',
    operational_state_desc: 'ONLINE',
    recovery_health_desc: 'ONLINE_IN_PROGRESS',
    endpoint_url: 'TCP://192.168.1.10:5022'
  },
  {
    replica_id: 'r-002-0000-0000-0000-000000000002',
    ag_name: 'AG-PROD-01',
    group_id: 'ag-001-0000-0000-0000-000000000001',
    replica_server_name: '192.168.1.15',
    role_desc: 'SECONDARY',
    availability_mode_desc: 'SYNCHRONOUS_COMMIT',
    failover_mode_desc: 'AUTOMATIC',
    synchronization_health_desc: 'HEALTHY',
    connected_state_desc: 'CONNECTED',
    operational_state_desc: 'ONLINE',
    recovery_health_desc: 'ONLINE_IN_PROGRESS',
    endpoint_url: 'TCP://192.168.1.15:5022'
  }
]

const MOCK_AG_DATABASES: AvailabilityDatabase[] = [
  {
    ag_name: 'AG-PROD-01',
    database_name: 'AdventureWorks',
    synchronization_state_desc: 'SYNCHRONIZED',
    synchronization_health_desc: 'HEALTHY',
    is_suspended: false,
    suspend_reason_desc: null,
    log_send_queue_kb: 0,
    redo_queue_kb: 0,
    log_send_rate_kb: 125,
    redo_rate_kb: 118,
    last_commit_time: new Date().toISOString()
  },
  {
    ag_name: 'AG-PROD-01',
    database_name: 'ReportServer',
    synchronization_state_desc: 'SYNCHRONIZING',
    synchronization_health_desc: 'PARTIALLY_HEALTHY',
    is_suspended: false,
    suspend_reason_desc: null,
    log_send_queue_kb: 2048,
    redo_queue_kb: 1024,
    log_send_rate_kb: 80,
    redo_rate_kb: 75,
    last_commit_time: new Date(Date.now() - 5000).toISOString()
  }
]

const MOCK_MEM_TARGET = 8192

function mockMetrics(cpu = 18, memUsed = 4096): ServerMetrics {
  const now = new Date()
  const daysAgo = (d: number): Date => new Date(now.getTime() - d * 86_400_000)
  return {
    collectedAt: now,
    instanceInfo: {
      version: 'Microsoft SQL Server 2019 (RTM-CU27) 15.0.4375.4',
      edition: 'Enterprise Edition',
      memoryUsedMb: Math.round(memUsed),
      memoryTargetMb: MOCK_MEM_TARGET,
      cpuUsagePercent: Math.round(cpu * 10) / 10,
      uptimeDays: 42,
      logicalCpus: 16,
      physicalCpus: 8,
    },
    databases: [
      { name: 'AdventureWorks', stateDesc: 'ONLINE', recoveryModel: 'FULL', sizeMb: 248, logSizeMb: 64 },
      { name: 'ReportServer', stateDesc: 'ONLINE', recoveryModel: 'SIMPLE', sizeMb: 12, logSizeMb: 2 },
      { name: 'OfflineDB', stateDesc: 'OFFLINE', recoveryModel: 'FULL', sizeMb: 512, logSizeMb: 128 },
    ],
    activeSessions: [
      { sessionId: 51, status: 'running', blockingSessionId: 0, waitType: '', waitTimeMs: 0, cpuTime: 234, logicalReads: 1024 },
      { sessionId: 52, status: 'suspended', blockingSessionId: 51, waitType: 'LCK_M_S', waitTimeMs: 3200, cpuTime: 12, logicalReads: 88 },
      { sessionId: 55, status: 'sleeping', blockingSessionId: 0, waitType: 'WAITFOR', waitTimeMs: 0, cpuTime: 0, logicalReads: 0 },
    ],
    topQueries: [
      {
        queryText: 'SELECT * FROM Sales.SalesOrderHeader WHERE OrderDate > @p1',
        executionCount: 1420,
        totalElapsedTimeMs: 284000,
        avgCpuTimeMs: 120,
        avgLogicalReads: 3200,
      },
      {
        queryText: 'UPDATE Production.Product SET ModifiedDate = GETDATE() WHERE ProductID = @p1',
        executionCount: 320,
        totalElapsedTimeMs: 48000,
        avgCpuTimeMs: 80,
        avgLogicalReads: 420,
      },
    ],
    backupStatus: [
      {
        databaseName: 'AdventureWorks',
        lastFullBackup: daysAgo(1),
        lastDiffBackup: daysAgo(0),
        lastLogBackup: new Date(now.getTime() - 3_600_000),
      },
      {
        databaseName: 'ReportServer',
        lastFullBackup: daysAgo(3),
        lastDiffBackup: null,
        lastLogBackup: null,
      },
      {
        databaseName: 'OfflineDB',
        lastFullBackup: daysAgo(30),
        lastDiffBackup: null,
        lastLogBackup: null,
      },
    ],
    waitStats: [
      { waitType: 'LCK_M_X', waitTimeMs: 45230, maxWaitTimeMs: 8200, signalWaitTimeMs: 120, waitingTasksCount: 3, waitPercent: 38.5 },
      { waitType: 'PAGEIOLATCH_SH', waitTimeMs: 28900, maxWaitTimeMs: 4100, signalWaitTimeMs: 890, waitingTasksCount: 12, waitPercent: 24.6 },
      { waitType: 'CXPACKET', waitTimeMs: 18200, maxWaitTimeMs: 2300, signalWaitTimeMs: 340, waitingTasksCount: 8, waitPercent: 15.5 },
      { waitType: 'SOS_SCHEDULER_YIELD', waitTimeMs: 9100, maxWaitTimeMs: 890, signalWaitTimeMs: 9100, waitingTasksCount: 24, waitPercent: 7.7 },
      { waitType: 'ASYNC_NETWORK_IO', waitTimeMs: 4200, maxWaitTimeMs: 1200, signalWaitTimeMs: 45, waitingTasksCount: 6, waitPercent: 3.6 },
    ],
    diskVolumes: [
      {
        volume_mount_point: 'C:\\',
        logical_volume_name: 'Sistema',
        total_gb: 100,
        used_gb: 72,
        free_gb: 28,
        free_pct: 28.0
      },
      {
        volume_mount_point: 'D:\\',
        logical_volume_name: 'Dati SQL',
        total_gb: 500,
        used_gb: 461,
        free_gb: 39,
        free_pct: 7.8
      }
    ],
    databaseFiles: [
      {
        database_name: 'AdventureWorks',
        file_name: 'AdventureWorks',
        type_desc: 'ROWS',
        physical_name: 'D:\\SQL\\Data\\AdventureWorks.mdf',
        size_mb: 248,
        used_mb: 181,
        free_mb: 67,
        max_mb: null,
        is_percent_growth: false,
        growth: 64
      },
      {
        database_name: 'AdventureWorks',
        file_name: 'AdventureWorks_log',
        type_desc: 'LOG',
        physical_name: 'D:\\SQL\\Log\\AdventureWorks_log.ldf',
        size_mb: 64,
        used_mb: 12,
        free_mb: 52,
        max_mb: null,
        is_percent_growth: true,
        growth: 10
      },
      {
        database_name: 'ReportServer',
        file_name: 'ReportServer',
        type_desc: 'ROWS',
        physical_name: 'D:\\SQL\\Data\\ReportServer.mdf',
        size_mb: 12,
        used_mb: 8,
        free_mb: 4,
        max_mb: 4096,
        is_percent_growth: false,
        growth: 8
      },
      {
        database_name: 'ReportServer',
        file_name: 'ReportServer_log',
        type_desc: 'LOG',
        physical_name: 'D:\\SQL\\Log\\ReportServer_log.ldf',
        size_mb: 2,
        used_mb: 1,
        free_mb: 1,
        max_mb: 2048,
        is_percent_growth: false,
        growth: 0
      }
    ],
  }
}

// ---------------------------------------------------------------------------
// Mock worker — simula raccolta periodica con valori variabili
// ---------------------------------------------------------------------------

let mockWorkerTimer: ReturnType<typeof setInterval> | null = null
let mockWorkerCpu = 18
let mockWorkerMem = 4096
const mockMetricsListeners: Array<(data: { serverId: string; metrics: ServerMetrics }) => void> = []

function vary(value: number, delta: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value + (Math.random() - 0.5) * 2 * delta))
}

// ---------------------------------------------------------------------------
// API reale (IPC → main process)
// ---------------------------------------------------------------------------

const realApi = {
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
    ipcRenderer.invoke(IpcChannel.REMOVE_SERVER, req),

  detectServerInfo: (req: CollectMetricsRequest): Promise<IpcResult<ServerInfo>> =>
    ipcRenderer.invoke(IpcChannel.DETECT_SERVER_INFO, req),

  collectMetrics: (req: CollectMetricsRequest): Promise<IpcResult<ServerMetrics>> =>
    ipcRenderer.invoke(IpcChannel.COLLECT_METRICS, req),

  workerStart: (req: WorkerStartRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.WORKER_START, req),

  workerStop: (): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.WORKER_STOP),

  workerSetActive: (req: WorkerSetActiveRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.WORKER_SET_ACTIVE, req),

  workerSyncServers: (req: WorkerSyncServersRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.WORKER_SYNC_SERVERS, req),

  onServerHealthUpdate: (callback: (health: ServerHealthPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, health: ServerHealthPayload) => callback(health)
    ipcRenderer.on(IpcChannel.SERVER_HEALTH_UPDATE, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SERVER_HEALTH_UPDATE, listener)
  },

  getAlerts: (): Promise<IpcResult<Alert[]>> =>
    ipcRenderer.invoke(IpcChannel.ALERTS_GET_ALL),

  acknowledgeAlert: (req: AcknowledgeAlertRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.ALERTS_ACKNOWLEDGE, req),

  getHistory: (req: HistoryRequest): Promise<IpcResult<ServerMetrics[]>> =>
    ipcRenderer.invoke(IpcChannel.METRICS_HISTORY, req),

  onMetricsUpdated: (
    callback: (data: { serverId: string; metrics: ServerMetrics }) => void
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { serverId: string; metrics: ServerMetrics }) =>
      callback(data)
    ipcRenderer.on(IpcChannel.METRICS_UPDATED, listener)
    return () => ipcRenderer.removeListener(IpcChannel.METRICS_UPDATED, listener)
  },

  onAlertNew: (callback: (alert: Alert) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, alert: Alert) => callback(alert)
    ipcRenderer.on(IpcChannel.ALERT_NEW, listener)
    return () => ipcRenderer.removeListener(IpcChannel.ALERT_NEW, listener)
  },

  getSettings: (): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(IpcChannel.SETTINGS_GET),

  saveSettings: (req: SaveSettingsRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.SETTINGS_SET, req),

  getEmailSettings: (): Promise<IpcResult<EmailSettings>> =>
    ipcRenderer.invoke(IpcChannel.EMAIL_SETTINGS_GET),

  saveEmailSettings: (req: SaveEmailSettingsRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.EMAIL_SETTINGS_SET, req),

  sendTestEmail: (): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.EMAIL_TEST),

  getDbCustomFields: (req: DbCustomFieldsGetRequest): Promise<IpcResult<DbCustomFields>> =>
    ipcRenderer.invoke(IpcChannel.DB_GET_CUSTOM_FIELDS, req),

  setDbCustomFields: (req: DbCustomFieldsSetRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.DB_SET_CUSTOM_FIELDS, req),

  getAllDbCustomFields: (): Promise<IpcResult<Record<string, DbCustomFields>>> =>
    ipcRenderer.invoke(IpcChannel.DB_GET_ALL_CUSTOM_FIELDS),

  exportCustomFields: (): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannel.EXPORT_CUSTOM_FIELDS),

  exportInventory: (): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannel.EXPORT_INVENTORY),

  exportAlerts: (): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannel.EXPORT_ALERTS),

  exportInventoryCsv: (req: ExportInventoryCsvRequest): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IpcChannel.EXPORT_INVENTORY_CSV, req),

  saveCsv: (req: SaveCsvRequest): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IpcChannel.FILE_SAVE_CSV, req),

  // DB admin (shrink)
  db: {
    shrinkEstimate: (req: ShrinkEstimateParams): Promise<IpcResult<ShrinkEstimate[]>> =>
      ipcRenderer.invoke(IpcChannel.DB_SHRINK_ESTIMATE, req),
    shrink: (req: ShrinkDatabaseParams): Promise<IpcResult<ShrinkResult>> =>
      ipcRenderer.invoke(IpcChannel.DB_SHRINK, req),
    shrinkFile: (req: ShrinkFileParams): Promise<IpcResult<ShrinkResult>> =>
      ipcRenderer.invoke(IpcChannel.DB_SHRINK_FILE, req)
  },

  // Always On Availability Groups
  ag: {
    getGroups: (req: AgParams): Promise<IpcResult<AvailabilityGroup[]>> =>
      ipcRenderer.invoke(IpcChannel.AG_GET_GROUPS, req),
    getReplicas: (req: AgParams): Promise<IpcResult<AvailabilityReplica[]>> =>
      ipcRenderer.invoke(IpcChannel.AG_GET_REPLICAS, req),
    getDatabases: (req: AgParams): Promise<IpcResult<AvailabilityDatabase[]>> =>
      ipcRenderer.invoke(IpcChannel.AG_GET_DATABASES, req)
  },

  // Persistent server store — main process returns flat values (no IpcResult wrapper)
  servers: {
    getAll: (): Promise<StoredServer[]> =>
      ipcRenderer.invoke(IpcChannel.SERVERS_GET_ALL),
    add: (params: Omit<StoredServer, 'id' | 'addedAt'>): Promise<ServerAddResult> =>
      ipcRenderer.invoke(IpcChannel.SERVERS_ADD, params),
    update: (id: string, patch: Partial<StoredServer>): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IpcChannel.SERVERS_UPDATE, id, patch),
    remove: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IpcChannel.SERVERS_REMOVE_BY_ID, id)
  },

  // Push events — unreachability
  onServerUnreachable: (callback: (data: ServerUnreachableEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: ServerUnreachableEvent) => callback(data)
    ipcRenderer.on(IpcChannel.SERVER_UNREACHABLE, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SERVER_UNREACHABLE, listener)
  },

  onServerRecovered: (callback: (serverId: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, serverId: string) => callback(serverId)
    ipcRenderer.on(IpcChannel.SERVER_RECOVERED, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SERVER_RECOVERED, listener)
  },

  onServerConfigUpdated: (callback: (servers: StoredServer[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, servers: StoredServer[]) => callback(servers)
    ipcRenderer.on(IpcChannel.SERVER_CONFIG_UPDATED, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SERVER_CONFIG_UPDATED, listener)
  },

  // App visibility — window blur / focus
  onAppBackground: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on(IpcChannel.APP_BACKGROUND, listener)
    return () => ipcRenderer.removeListener(IpcChannel.APP_BACKGROUND, listener)
  },

  onAppForeground: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on(IpcChannel.APP_FOREGROUND, listener)
    return () => ipcRenderer.removeListener(IpcChannel.APP_FOREGROUND, listener)
  },

  login: (username: string, password: string): Promise<LoginResult> =>
    ipcRenderer.invoke(IpcChannel.AUTH_LOGIN, username, password),

  logout: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IpcChannel.AUTH_LOGOUT),

  checkAuth: (): Promise<{ authenticated: boolean; session: AuthSession | null }> =>
    ipcRenderer.invoke(IpcChannel.AUTH_CHECK),

  changePassword: (
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<ChangePasswordResult> =>
    ipcRenderer.invoke(IpcChannel.AUTH_CHANGE_PASSWORD, userId, oldPassword, newPassword),
}

// ---------------------------------------------------------------------------
// API mock (VITE_MOCK_MODE=true)
// ---------------------------------------------------------------------------

const mockApi = {
  scanSubnet: (_options: ScanOptions): Promise<IpcResult<DiscoveredServer[]>> =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ ok: true, data: MOCK_SERVERS }), 3000)
    ),

  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    let step = 0
    const total = 254
    const timer = setInterval(() => {
      step = Math.min(step + 30, total)
      callback({ total, completed: step, found: step >= 10 ? 3 : 0 })
      if (step >= total) clearInterval(timer)
    }, 350)
    return () => clearInterval(timer)
  },

  addServerManual: (req: ManualServerRequest): Promise<IpcResult<DiscoveredServer>> =>
    Promise.resolve({
      ok: true,
      data: { ip: req.ip, port: req.port, reachable: true, responseTimeMs: 5, discoveredAt: new Date() },
    }),

  getServers: (): Promise<IpcResult<DiscoveredServer[]>> =>
    Promise.resolve({ ok: true, data: MOCK_SERVERS.slice(0, 2) }),

  removeServer: (_req: RemoveServerRequest): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  detectServerInfo: (req: CollectMetricsRequest): Promise<IpcResult<ServerInfo>> =>
    new Promise((resolve) =>
      setTimeout(() =>
        resolve({ ok: true, data: { machineName: req.ip.replace(/\./g, '-'), instanceName: null } }),
        800
      )
    ),

  collectMetrics: (_req: CollectMetricsRequest): Promise<IpcResult<ServerMetrics>> =>
    Promise.resolve({ ok: true, data: mockMetrics(mockWorkerCpu, mockWorkerMem) }),

  workerStart: (req: WorkerStartRequest): Promise<IpcResult<null>> => {
    if (mockWorkerTimer) clearInterval(mockWorkerTimer)
    mockWorkerTimer = setInterval(() => {
      console.log('[MockWorker] tick', new Date().toISOString(), `listeners: ${mockMetricsListeners.length}`)
      // Valori variabili: CPU ±5%, Memoria ±2% del target
      mockWorkerCpu = vary(mockWorkerCpu, 5, 0, 100)
      mockWorkerMem = vary(mockWorkerMem, MOCK_MEM_TARGET * 0.02, 0, MOCK_MEM_TARGET)
      const metrics = mockMetrics(mockWorkerCpu, mockWorkerMem)
      for (const srv of req.servers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sid = `${(srv as any).host ?? srv.ip}:${srv.port}`
        console.log('[MockWorker] pushing metrics to', sid, `cpu=${metrics.instanceInfo.cpuUsagePercent.toFixed(1)}%`)
        mockMetricsListeners.forEach((cb) => cb({ serverId: sid, metrics }))
      }
    }, req.intervalSeconds * 1000)
    console.log('[MockWorker] started, interval:', req.intervalSeconds, 's')
    return Promise.resolve({ ok: true, data: null })
  },

  workerStop: (): Promise<IpcResult<null>> => {
    if (mockWorkerTimer) {
      clearInterval(mockWorkerTimer)
      mockWorkerTimer = null
    }
    return Promise.resolve({ ok: true, data: null })
  },

  workerSetActive: (_req: WorkerSetActiveRequest): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  workerSyncServers: (_req: WorkerSyncServersRequest): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  onServerHealthUpdate: (_callback: (health: ServerHealthPayload) => void): (() => void) => () => {},

  getAlerts: (): Promise<IpcResult<Alert[]>> => {
    const now = new Date()
    const mockAlerts: Alert[] = [
      {
        id: 'mock-1',
        serverId: '192.168.1.10:1433',
        category: 'database_offline',
        severity: 'CRITICAL',
        message: 'DB offline: OfflineDB',
        detectedAt: new Date(now.getTime() - 300_000),
        acknowledgedAt: null,
      },
      {
        id: 'mock-2',
        serverId: '192.168.1.10:1433',
        category: 'blocking_sessions',
        severity: 'WARNING',
        message: '1 sessione/i bloccata/e',
        detectedAt: new Date(now.getTime() - 120_000),
        acknowledgedAt: null,
      },
      {
        id: 'mock-3',
        serverId: '192.168.1.10:1433',
        category: 'backup_overdue',
        severity: 'WARNING',
        message: 'Backup full scaduto/assente: ReportServer, OfflineDB',
        detectedAt: new Date(now.getTime() - 60_000),
        acknowledgedAt: null,
      },
    ]
    return Promise.resolve({ ok: true, data: mockAlerts })
  },

  acknowledgeAlert: (_req: AcknowledgeAlertRequest): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  getHistory: (_req: HistoryRequest): Promise<IpcResult<ServerMetrics[]>> =>
    Promise.resolve({ ok: true, data: [] }),

  onMetricsUpdated: (
    callback: (data: { serverId: string; metrics: ServerMetrics }) => void
  ): (() => void) => {
    mockMetricsListeners.push(callback)
    return () => {
      const idx = mockMetricsListeners.indexOf(callback)
      if (idx >= 0) mockMetricsListeners.splice(idx, 1)
    }
  },

  onAlertNew: (_callback: (alert: Alert) => void): (() => void) => () => {},

  getSettings: (): Promise<IpcResult<AppSettings>> =>
    Promise.resolve({ ok: true, data: {
      retentionMinutes: 60,
      backgroundEnabled: true,
      backgroundMode: 'light',
      backgroundIntervalMinutes: 30,
      backgroundNotifications: true,
      themeMode: 'system',
    }}),

  saveSettings: (_req: SaveSettingsRequest): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  getEmailSettings: (): Promise<IpcResult<EmailSettings>> =>
    Promise.resolve({
      ok: true,
      data: {
        emailEnabled: false,
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPassword: '',
        smtpTls: true,
        emailRecipients: [],
      },
    }),

  saveEmailSettings: (_req: SaveEmailSettingsRequest): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  sendTestEmail: (): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  getDbCustomFields: (_req: DbCustomFieldsGetRequest): Promise<IpcResult<DbCustomFields>> =>
    Promise.resolve({ ok: true, data: {} }),

  setDbCustomFields: (_req: DbCustomFieldsSetRequest): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  getAllDbCustomFields: (): Promise<IpcResult<Record<string, DbCustomFields>>> =>
    Promise.resolve({ ok: true, data: {} }),

  exportCustomFields: (): Promise<IpcResult<string>> =>
    Promise.resolve({ ok: true, data: 'serverId,dbName,alias,referente\r\n' }),

  exportInventory: (): Promise<IpcResult<string>> =>
    Promise.resolve({ ok: true, data: 'ip,porta,raggiungibile,responseTimeMs,discoveredAt,database\r\n' }),

  exportAlerts: (): Promise<IpcResult<string>> =>
    Promise.resolve({ ok: true, data: 'id,serverId,categoria,severita,messaggio,rilevato_il,acknowledged_il\r\n' }),

  exportInventoryCsv: (_req: ExportInventoryCsvRequest): Promise<IpcResult<string | null>> =>
    Promise.resolve({ ok: true, data: null }),

  saveCsv: (_req: SaveCsvRequest): Promise<IpcResult<string | null>> =>
    Promise.resolve({ ok: true, data: null }),

  db: {
    shrinkEstimate: (_req: ShrinkEstimateParams): Promise<IpcResult<ShrinkEstimate[]>> =>
      Promise.resolve({
        ok: true,
        data: [
          { file_name: 'AdventureWorks', current_mb: 248, used_mb: 181, reclaimable_mb: 67 },
          { file_name: 'AdventureWorks_log', current_mb: 64, used_mb: 12, reclaimable_mb: 52 }
        ]
      }),
    shrink: (_req: ShrinkDatabaseParams): Promise<IpcResult<ShrinkResult>> =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ ok: true, data: { success: true, duration_ms: 3200 } }), 2000)
      ),
    shrinkFile: (_req: ShrinkFileParams): Promise<IpcResult<ShrinkResult>> =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ ok: true, data: { success: true, duration_ms: 1800, newSizeMb: 12, reclaimedMb: 52 } }),
          2000
        )
      )
  },

  ag: {
    getGroups: (_req: AgParams): Promise<IpcResult<AvailabilityGroup[]>> =>
      Promise.resolve({ ok: true, data: MOCK_AG_GROUPS }),
    getReplicas: (_req: AgParams): Promise<IpcResult<AvailabilityReplica[]>> =>
      Promise.resolve({ ok: true, data: MOCK_AG_REPLICAS }),
    getDatabases: (_req: AgParams): Promise<IpcResult<AvailabilityDatabase[]>> =>
      Promise.resolve({ ok: true, data: MOCK_AG_DATABASES })
  },

  servers: {
    getAll: (): Promise<StoredServer[]> =>
      Promise.resolve([...mockStoredServers]),

    add: (params: Omit<StoredServer, 'id' | 'addedAt'>): Promise<ServerAddResult> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addr = params.host ?? (params as any).ip ?? ''
      const dup = mockStoredServers.some((s) => s.host === addr && s.port === params.port)
      if (dup) return Promise.resolve({ success: false, reason: 'duplicate' })
      const server: StoredServer = {
        ...params,
        host: addr,
        id: `mock-${Date.now()}`,
        addedAt: new Date().toISOString()
      }
      mockStoredServers = [...mockStoredServers, server]
      return Promise.resolve({ success: true, server })
    },

    update: (id: string, patch: Partial<StoredServer>): Promise<{ success: boolean }> => {
      mockStoredServers = mockStoredServers.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      )
      return Promise.resolve({ success: true })
    },

    remove: (id: string): Promise<{ success: boolean }> => {
      mockStoredServers = mockStoredServers.filter((s) => s.id !== id)
      return Promise.resolve({ success: true })
    }
  },

  onServerUnreachable: (callback: (data: ServerUnreachableEvent) => void): (() => void) => {
    mockUnreachableListeners.push(callback)
    return () => {
      const idx = mockUnreachableListeners.indexOf(callback)
      if (idx >= 0) mockUnreachableListeners.splice(idx, 1)
    }
  },

  onServerRecovered: (callback: (serverId: string) => void): (() => void) => {
    mockRecoveredListeners.push(callback)
    return () => {
      const idx = mockRecoveredListeners.indexOf(callback)
      if (idx >= 0) mockRecoveredListeners.splice(idx, 1)
    }
  },

  onAppBackground: (_callback: () => void): (() => void) => () => {},
  onAppForeground: (_callback: () => void): (() => void) => () => {},
  onServerConfigUpdated: (_callback: (servers: StoredServer[]) => void): (() => void) => () => {},

  // Auth — mock mode: auto-login as admin, no password required
  login: (_username: string, _password: string): Promise<LoginResult> =>
    Promise.resolve({ success: true, mustChangePassword: false }),
  logout: (): Promise<{ success: boolean }> => Promise.resolve({ success: true }),
  checkAuth: (): Promise<{ authenticated: boolean; session: AuthSession | null }> =>
    Promise.resolve({
      authenticated: true,
      session: { token: 'mock-token', userId: 'mock-admin', username: 'admin', role: 'admin', expiresAt: Date.now() + 8 * 3600 * 1000 },
    }),
  changePassword: (
    _userId: string,
    _oldPassword: string,
    _newPassword: string
  ): Promise<ChangePasswordResult> => Promise.resolve({ success: true }),
}

// ---------------------------------------------------------------------------
// Selezione API in base a VITE_MOCK_MODE
// ---------------------------------------------------------------------------

const isMock = import.meta.env.VITE_MOCK_MODE === 'true'
const api = isMock ? mockApi : realApi

console.info(`[Preload] init — mock=${isMock}`)
if (isMock) {
  console.info('[SQLSentinel] MOCK MODE attivo — nessuna connessione reale al main process')
}

// Explicit wrapper object — every method listed individually so contextBridge
// can proxy each one cleanly (passing a plain variable can silently drop nested
// objects in some Electron/electron-vite build configurations).
const bridgeApi = {
  scanSubnet:          (o: ScanOptions) => api.scanSubnet(o),
  onScanProgress:      (cb: (p: ScanProgress) => void) => api.onScanProgress(cb),
  addServerManual:     (r: ManualServerRequest) => api.addServerManual(r),
  getServers:          () => api.getServers(),
  removeServer:        (r: RemoveServerRequest) => api.removeServer(r),
  detectServerInfo:    (r: CollectMetricsRequest) => api.detectServerInfo(r),
  collectMetrics:      (r: CollectMetricsRequest) => api.collectMetrics(r),
  workerStart:         (r: WorkerStartRequest) => api.workerStart(r),
  workerStop:          () => api.workerStop(),
  workerSetActive:        (r: WorkerSetActiveRequest) => api.workerSetActive(r),
  workerSyncServers:      (r: WorkerSyncServersRequest) => api.workerSyncServers(r),
  onServerHealthUpdate:   (cb: (h: ServerHealthPayload) => void) => api.onServerHealthUpdate(cb),
  getAlerts:           () => api.getAlerts(),
  acknowledgeAlert:    (r: AcknowledgeAlertRequest) => api.acknowledgeAlert(r),
  getHistory:          (r: HistoryRequest) => api.getHistory(r),
  onMetricsUpdated:    (cb: (d: { serverId: string; metrics: ServerMetrics }) => void) => api.onMetricsUpdated(cb),
  onAlertNew:          (cb: (a: Alert) => void) => api.onAlertNew(cb),
  getSettings:         () => api.getSettings(),
  saveSettings:        (r: SaveSettingsRequest) => api.saveSettings(r),
  getEmailSettings:  () => api.getEmailSettings(),
  saveEmailSettings: (r: SaveEmailSettingsRequest) => api.saveEmailSettings(r),
  sendTestEmail:     () => realApi.sendTestEmail(),
  getDbCustomFields:   (r: DbCustomFieldsGetRequest) => api.getDbCustomFields(r),
  setDbCustomFields:   (r: DbCustomFieldsSetRequest) => api.setDbCustomFields(r),
  getAllDbCustomFields: () => api.getAllDbCustomFields(),
  // File/CSV exports: sempre IPC reale — le operazioni dialog+writeFile
  // non funzionano nel mock layer (mockApi restituisce null senza aprire il dialog)
  exportCustomFields:  () => realApi.exportCustomFields(),
  exportInventory:     () => realApi.exportInventory(),
  exportAlerts:        () => realApi.exportAlerts(),
  exportInventoryCsv:  (r: ExportInventoryCsvRequest) => realApi.exportInventoryCsv(r),
  saveCsv:             (r: SaveCsvRequest) => realApi.saveCsv(r),
  db: {
    shrinkEstimate: (r: ShrinkEstimateParams): Promise<IpcResult<ShrinkEstimate[]>> =>
      isMock ? api.db.shrinkEstimate(r) : ipcRenderer.invoke(IpcChannel.DB_SHRINK_ESTIMATE, r),
    shrink: (r: ShrinkDatabaseParams): Promise<IpcResult<ShrinkResult>> =>
      isMock ? api.db.shrink(r) : ipcRenderer.invoke(IpcChannel.DB_SHRINK, r),
    shrinkFile: (r: ShrinkFileParams): Promise<IpcResult<ShrinkResult>> =>
      isMock ? api.db.shrinkFile(r) : ipcRenderer.invoke(IpcChannel.DB_SHRINK_FILE, r),
  },
  ag: {
    getGroups: (r: AgParams): Promise<IpcResult<AvailabilityGroup[]>> =>
      isMock ? api.ag.getGroups(r) : ipcRenderer.invoke(IpcChannel.AG_GET_GROUPS, r),
    getReplicas: (r: AgParams): Promise<IpcResult<AvailabilityReplica[]>> =>
      isMock ? api.ag.getReplicas(r) : ipcRenderer.invoke(IpcChannel.AG_GET_REPLICAS, r),
    getDatabases: (r: AgParams): Promise<IpcResult<AvailabilityDatabase[]>> =>
      isMock ? api.ag.getDatabases(r) : ipcRenderer.invoke(IpcChannel.AG_GET_DATABASES, r),
  },
  // servers: in mock mode usa mockApi (in-memory, nessun IPC → nessun auth check);
  // in real mode usa realApi (IPC → electron-store).
  // La preoccupazione precedente ("record mock-* inquinano electron-store") era per
  // il vecchio schema dove mockApi chiamava IPC sotto. Ora mockApi.servers è puro
  // in-memory, quindi è sicuro usarlo in mock mode.
  servers: {
    getAll:     () => api.servers.getAll(),
    add:        (p: Omit<StoredServer, 'id' | 'addedAt'>) => api.servers.add(p),
    update:     (id: string, patch: Partial<StoredServer>) => api.servers.update(id, patch),
    remove:     (id: string) => api.servers.remove(id),
    clearMocks: (): Promise<{ success: boolean; removed: number; remaining: number }> =>
      ipcRenderer.invoke('servers:clearMocks'),
  },
  onServerUnreachable:    (cb: (d: ServerUnreachableEvent) => void) => api.onServerUnreachable(cb),
  onServerRecovered:      (cb: (id: string) => void) => api.onServerRecovered(cb),
  onServerConfigUpdated:  (cb: (servers: StoredServer[]) => void) => api.onServerConfigUpdated(cb),
  onAppBackground:     (cb: () => void) => api.onAppBackground(cb),
  onAppForeground:     (cb: () => void) => api.onAppForeground(cb),
  login:           (u: string, p: string) => api.login(u, p),
  logout:          () => api.logout(),
  checkAuth:       () => api.checkAuth(),
  changePassword:  (userId: string, oldPwd: string, newPwd: string) =>
    api.changePassword(userId, oldPwd, newPwd),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', {})
    contextBridge.exposeInMainWorld('sqlSentinel', bridgeApi)
  } catch (error) {
    console.error('[Preload] contextBridge error:', error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = {}
  // @ts-ignore (define in dts)
  window.sqlSentinel = bridgeApi
}
