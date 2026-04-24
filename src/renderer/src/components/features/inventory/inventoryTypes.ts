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
  defaultWidth: number // pixels
}

export const COLUMNS: ColDef[] = [
  { key: 'serverLabel',  label: 'SERVER',      defaultWidth: 220 },
  { key: 'envName',      label: 'ENVIRONMENT', defaultWidth: 100 },
  { key: 'type',         label: 'TYPE',        defaultWidth: 100 },
  { key: 'machineName',  label: 'MACHINE',     defaultWidth: 110 },
  { key: 'hostingType',  label: 'HOSTING',     defaultWidth: 76 },
  { key: 'dbCount',      label: 'DB',          defaultWidth: 44 },
  { key: 'onlineCount',  label: 'ONLINE',      defaultWidth: 62 },
  { key: 'offlineCount', label: 'OFFLINE',     defaultWidth: 64 },
  { key: 'totalDataMb',  label: 'DATA',        defaultWidth: 76 },
  { key: 'version',      label: 'VERSION',     defaultWidth: 120 },
  { key: 'logicalCpus',  label: 'CPU',         defaultWidth: 76 },
  { key: 'unreachable',  label: 'STATUS',      defaultWidth: 76 },
  { key: 'notes',        label: 'NOTES',       defaultWidth: 160 },
]

export interface DbColDef {
  label: string
  defaultWidth: number // pixels
}

export const DB_COLUMNS: DbColDef[] = [
  { label: 'DATABASE',  defaultWidth: 170 },
  { label: 'SERVER',    defaultWidth: 130 },
  { label: 'ALIAS',     defaultWidth: 110 },
  { label: 'STATUS',    defaultWidth: 130 },
  { label: 'RECOVERY',  defaultWidth: 96 },
  { label: 'COMPAT',    defaultWidth: 84 },
  { label: 'TDE',       defaultWidth: 50 },
  { label: 'DATA',      defaultWidth: 76 },
  { label: 'LOG',       defaultWidth: 76 },
  { label: 'LAST FULL', defaultWidth: 104 },
  { label: 'LAST LOG',  defaultWidth: 104 },
  { label: 'OWNER',     defaultWidth: 110 },
  { label: 'CREATED',   defaultWidth: 104 },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}
