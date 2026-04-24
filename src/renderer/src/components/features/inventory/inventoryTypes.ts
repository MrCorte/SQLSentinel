// Shared types for the Inventory feature

import type { ServerHostingType } from '../../../constants/hosting'

// ---------------------------------------------------------------------------
// Server View row types
// ---------------------------------------------------------------------------

export type InventoryRowType = 'standalone' | 'ag-cluster' | 'ag-replica' | 'machine-header'

export interface InventoryRow {
  id: string
  type: InventoryRowType
  depth: number
  serverLabel: string
  host: string
  port: number
  envId: string
  envName: string
  envColor: string
  hostingType: ServerHostingType
  version: string
  unreachable: boolean
  dbCount: number
  onlineCount: number
  offlineCount: number
  totalDataMb: number
  totalLogMb: number
  machineName?: string
  instanceName?: string
  // ag-cluster + machine-header
  agName?: string
  agHealthy?: boolean
  replicaCount?: number
  instanceCount?: number
  clusterKey?: string
  // standalone + ag-replica
  serverId?: string
  agRole?: 'PRIMARY' | 'SECONDARY'
  uptimeDays?: number
  logicalCpus?: number
  physicalCpus?: number
  notes?: string
}

// ---------------------------------------------------------------------------
// DB View row types
// ---------------------------------------------------------------------------

export type DbViewRowType = 'server-header' | 'db-row'

export interface DbViewRow {
  id: string
  type: DbViewRowType
  serverId: string
  serverKey: string // "ip:port"
  serverLabel: string
  envName: string
  envColor: string
  unreachable: boolean
  serverVersion: string
  clusterKey: string // = serverKey, used for expand/collapse
  // server-header only
  dbCount?: number
  agRole?: 'PRIMARY' | 'SECONDARY'
  // db-row only
  dbName?: string
  stateDesc?: string
  recoveryModel?: string
  compatibilityLevel?: number
  isEncrypted?: boolean
  isReadOnly?: boolean
  owner?: string
  createDate?: string
  sizeMb?: number
  logSizeMb?: number
  lastFullBackup?: Date | null
  lastLogBackup?: Date | null
  alias?: string
  referente?: string
}

// ---------------------------------------------------------------------------
// Column definitions — stable, defined at module level
// ---------------------------------------------------------------------------

export interface ColDef {
  key: keyof InventoryRow
  label: string
  width: string
}

export const COLUMNS: ColDef[] = [
  { key: 'serverLabel', label: 'SERVER', width: 'minmax(min-content, 17fr)' },
  { key: 'envName', label: 'ENVIRONMENT', width: 'minmax(min-content, 8fr)' },
  { key: 'type', label: 'TYPE', width: 'minmax(min-content, 8fr)' },
  { key: 'machineName', label: 'MACHINE', width: 'minmax(min-content, 8fr)' },
  { key: 'hostingType', label: 'HOSTING', width: 'minmax(min-content, 6fr)' },
  { key: 'dbCount', label: 'DB', width: 'minmax(min-content, 4fr)' },
  { key: 'onlineCount', label: 'ONLINE', width: 'minmax(min-content, 5fr)' },
  { key: 'offlineCount', label: 'OFFLINE', width: 'minmax(min-content, 5fr)' },
  { key: 'totalDataMb', label: 'DATA', width: 'minmax(min-content, 7fr)' },
  { key: 'version', label: 'VERSION', width: 'minmax(min-content, 9fr)' },
  { key: 'logicalCpus', label: 'CPU', width: 'minmax(min-content, 5fr)' },
  { key: 'unreachable', label: 'STATUS', width: 'minmax(min-content, 6fr)' },
  { key: 'notes', label: 'NOTES', width: 'minmax(min-content, 12fr)' }
]

export const GRID_TEMPLATE = COLUMNS.map((c) => c.width).join(' ')

export const DB_COLUMNS = [
  { label: 'DATABASE', width: 'minmax(min-content, 13fr)' },
  { label: 'SERVER', width: 'minmax(min-content, 10fr)' },
  { label: 'ALIAS', width: 'minmax(min-content, 8fr)' },
  { label: 'STATUS', width: 'minmax(min-content, 6fr)' },
  { label: 'RECOVERY', width: 'minmax(min-content, 6fr)' },
  { label: 'COMPAT', width: 'minmax(min-content, 7fr)' },
  { label: 'TDE', width: 'minmax(min-content, 5fr)' },
  { label: 'DATA', width: 'minmax(min-content, 6fr)' },
  { label: 'LOG', width: 'minmax(min-content, 5fr)' },
  { label: 'LAST FULL', width: 'minmax(min-content, 9fr)' },
  { label: 'LAST LOG', width: 'minmax(min-content, 9fr)' },
  { label: 'OWNER', width: 'minmax(min-content, 8fr)' },
  { label: 'CREATED', width: 'minmax(min-content, 8fr)' }
]

export const DB_GRID_TEMPLATE = DB_COLUMNS.map((c) => c.width).join(' ')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}
