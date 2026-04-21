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
  { key: 'serverLabel', label: 'SERVER', width: '17%' },
  { key: 'envName', label: 'ENVIRONMENT', width: '8%' },
  { key: 'type', label: 'TYPE', width: '8%' },
  { key: 'machineName', label: 'MACHINE', width: '8%' },
  { key: 'hostingType', label: 'HOSTING', width: '6%' },
  { key: 'dbCount', label: 'DB', width: '4%' },
  { key: 'onlineCount', label: 'ONLINE', width: '5%' },
  { key: 'offlineCount', label: 'OFFLINE', width: '5%' },
  { key: 'totalDataMb', label: 'DATA', width: '7%' },
  { key: 'version', label: 'VERSION', width: '9%' },
  { key: 'logicalCpus', label: 'CPU', width: '5%' },
  { key: 'unreachable', label: 'STATUS', width: '6%' },
  { key: 'notes', label: 'NOTES', width: '12%' },
]

export const GRID_TEMPLATE = COLUMNS.map((c) => c.width).join(' ')

export const DB_COLUMNS = [
  { label: 'DATABASE', width: '13%' },
  { label: 'SERVER', width: '10%' },
  { label: 'ALIAS', width: '8%' },
  { label: 'STATUS', width: '6%' },
  { label: 'RECOVERY', width: '6%' },
  { label: 'COMPAT', width: '7%' },
  { label: 'TDE', width: '5%' },
  { label: 'DATA', width: '6%' },
  { label: 'LOG', width: '5%' },
  { label: 'LAST FULL', width: '9%' },
  { label: 'LAST LOG', width: '9%' },
  { label: 'OWNER', width: '8%' },
  { label: 'CREATED', width: '8%' },
]

export const DB_GRID_TEMPLATE = DB_COLUMNS.map((c) => c.width).join(' ')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}
