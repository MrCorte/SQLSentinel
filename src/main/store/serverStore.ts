import Store from 'electron-store'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Type — must stay JSON-serialisable (strings for dates, no Date objects)
// ---------------------------------------------------------------------------

export type ServerHostingType = 'on-premise' | 'cloud'

export interface StoredServer {
  id: string
  host: string              // canonical address — obbligatorio
  ip?: string               // legacy alias kept for migration; normalizeServer() strips it
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  /** Plaintext password — encrypt in a future iteration */
  password?: string
  addedAt: string           // ISO 8601
  lastSeen?: string         // ISO 8601 — last successful connection
  unreachable?: boolean     // true while health-check reports failure
  unreachableSince?: string // ISO 8601 — timestamp of first failure
  machineName?: string      // SERVERPROPERTY('MachineName') — usato per raggruppare istanze multiple sulla stessa macchina fisica
  // Always On AG membership — populated at runtime, refreshed on startup
  agGroupId?: string        // group_id UUID if this server belongs to an AG
  agName?: string           // AG name, e.g. "AG-PROD-01" — used for sidebar grouping
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  logicalCpus?: number      // cpu_count from sys.dm_os_sys_info (persisted, rarely changes)
  physicalCpus?: number     // cpu_count / hyperthread_ratio
  hostingType?: ServerHostingType
}

/**
 * Normalize a raw stored record: resolves host from either 'host' or legacy 'ip' field.
 * Strips 'ip' from output so new records are stored with 'host' only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeServer(s: any): StoredServer {
  const host: string = s.host ?? s.ip ?? ''
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ip: _ip, ...rest } = s
  return { ...rest, host }
}

// ---------------------------------------------------------------------------
// electron-store singleton
// ---------------------------------------------------------------------------

type Schema = { servers: StoredServer[] }

const store = new Store<Schema>({
  name: 'sql-sentinel-data',
  defaults: { servers: [] }
})

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export function getAll(): StoredServer[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (store.get('servers', []) as any[]).map(normalizeServer)
}

export function getById(id: string): StoredServer | undefined {
  return getAll().find((s) => s.id === id)
}

export function getByIpPort(host: string, port: number): StoredServer | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getAll().find((s) => ((s as any).host ?? (s as any).ip) === host && s.port === port)
}

export function add(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any
): { success: boolean; reason?: string; server?: StoredServer } {
  const normalized = normalizeServer(params)
  if (!normalized.host) return { success: false, reason: 'missing host' }
  const servers = store.get('servers', [])
  // Duplicate check: accept both host and legacy ip from stored records
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (servers.some((s: any) => (s.host ?? s.ip) === normalized.host && s.port === normalized.port)) {
    return { success: false, reason: 'duplicate' }
  }
  const server: StoredServer = {
    ...normalized,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  store.set('servers', [...servers, server])
  return { success: true, server }
}

/**
 * One-shot migration: fix any records that have ip but no host.
 * Safe to call on every boot — no-op if data is already normalized.
 */
export function migrateHostField(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = store.get('servers', []) as any[]
    const needsMigration = raw.some((s) => !s.host)
    if (!needsMigration) return
    store.set('servers', raw.map(normalizeServer))
    console.log('[serverStore] migrated', raw.length, 'servers ip→host')
  } catch (err) {
    console.error('[serverStore] migration error:', err)
  }
}

export function update(id: string, patch: Partial<StoredServer>): void {
  const servers = store.get('servers', [])
  const idx = servers.findIndex((s) => s.id === id)
  if (idx >= 0) {
    servers[idx] = { ...servers[idx], ...patch }
    store.set('servers', servers)
  }
}

export function remove(id: string): void {
  store.set(
    'servers',
    store.get('servers', []).filter((s) => s.id !== id)
  )
}

/**
 * Insert-or-update by host:port.
 * Used when ADD_SERVER_MANUAL completes — ensures the server is persisted
 * without creating duplicates.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function upsertByIpPort(params: any): StoredServer {
  const normalized = normalizeServer(params)
  const servers = store.get('servers', [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idx = servers.findIndex((s: any) => (s.host ?? s.ip) === normalized.host && s.port === normalized.port)
  if (idx >= 0) {
    servers[idx] = { ...servers[idx], ...normalized }
    store.set('servers', servers)
    return normalizeServer(servers[idx])
  }
  const server: StoredServer = {
    ...normalized,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  store.set('servers', [...servers, server])
  return server
}
