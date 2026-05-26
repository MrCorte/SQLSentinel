import type { ServerMetrics } from '../main/collectors/types'
import type { StoredServer } from '../main/store/sqlserver/serverRepository'
import type { AppSettings } from '../main/store/sqlserver/settingsRepository'

// ── HTTP response wrapper (mirrors IpcResult) ────────────────────────────────

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ── Alert (duplicated here to avoid importing from metricsWorker) ─────────────

export type AlertSeverity = 'WARNING' | 'CRITICAL'
export type AlertCategory =
  | 'cpu_high'
  | 'blocking_sessions'
  | 'database_offline'
  | 'backup_overdue'
  | 'disk_space_low'

export interface ServiceAlert {
  id: string
  serverId: string
  category: AlertCategory
  severity: AlertSeverity
  message: string
  detectedAt: string       // ISO 8601
  acknowledgedAt: string | null
}

// ── REST request bodies ───────────────────────────────────────────────────────

export interface AddServerBody {
  host: string
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  password?: string
  hostingType?: 'on-premise' | 'cloud'
  notes?: string
}

export interface UpdateServerBody extends Partial<AddServerBody> {
  unreachable?: boolean
  unreachableSince?: string
  lastSeen?: string
  agGroupId?: string
  agName?: string
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  logicalCpus?: number
  physicalCpus?: number
  machineName?: string
}

export interface MigrateServersBody {
  servers: Array<AddServerBody & { id?: string; addedAt?: string }>
}

// ── WebSocket messages (service → client) ────────────────────────────────────

export type WsPushMessage =
  | { type: 'metrics:batchUpdated'; data: Array<{ serverId: string; metrics: ServerMetrics }> }
  | { type: 'metrics:alert-new'; data: ServiceAlert }
  | { type: 'server:healthUpdate'; data: { serverId: string; failCount: number; nextRetry: number; lastSuccess: number | null } }
  | { type: 'server:configUpdated'; data: StoredServer[] }
  | { type: 'service:ready' }

// ── WebSocket messages (client → service) ────────────────────────────────────

export type WsClientMessage =
  | { type: 'worker:setActive'; serverId: string }
  | { type: 'worker:syncServers' }   // service re-reads its own DB, no payload needed

// ── Service health ────────────────────────────────────────────────────────────

export interface ServiceHealth {
  ok: true
  version: string
  uptime: number           // process.uptime() seconds
  serversMonitored: number
}

// ── Re-exports for convenience ────────────────────────────────────────────────

export type { StoredServer, AppSettings, ServerMetrics }
