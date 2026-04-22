export interface ServerGroup {
  id: string
  name: string
  color: string
  collapsed: boolean
  order: number
}

/**
 * Returns the display name for a server.
 * If an alias is set, returns it; otherwise falls back to "ip:port".
 */
export function getServerDisplayName(server: { ip: string; port: number; alias?: string }): string {
  if (server.alias?.trim()) return server.alias.trim()
  return server.port !== 1433 ? `${server.ip}:${server.port}` : server.ip
}

// ---------------------------------------------------------------------------
// Inventory types
// ---------------------------------------------------------------------------

export interface ServerSummary {
  serverId: string
  displayName: string
  ip: string
  port: number
  instanceName?: string
  machineName?: string
  version: string
  edition: string
  uptimeDays: number
  dbCount: number
  onlineCount: number
  offlineCount: number
  totalDataMb: number
  totalLogMb: number
  unreachable: boolean
  isAg: boolean
  agName?: string
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  hostingType?: 'on-premise' | 'cloud'
  logicalCpus?: number
  physicalCpus?: number
  notes?: string
}

export interface AgClusterSummary {
  agName: string
  health: 'HEALTHY' | 'PARTIALLY_HEALTHY' | 'NOT_HEALTHY'
  primaryReplica: string
  replicas: ServerSummary[]
  dbCount: number
  onlineCount: number
  offlineCount: number
  totalDataMb: number
  totalLogMb: number
}

export interface GroupInventory {
  groupId: string | null
  groupName: string
  groupColor: string
  standaloneServers: ServerSummary[]
  standaloneDbCount: number
  standaloneOnline: number
  standaloneOffline: number
  standaloneDataMb: number
  standaloneLogMb: number
  agClusters: AgClusterSummary[]
  agDbCount: number
  agOnline: number
  agOffline: number
  agDataMb: number
  agLogMb: number
}

export interface InventoryStats {
  groups: GroupInventory[]
  totals: {
    servers: number
    standaloneServers: number
    agServers: number
    agClusters: number
    databases: number
    onlineDbs: number
    offlineDbs: number
    totalDataMb: number
    totalLogMb: number
  }
}
