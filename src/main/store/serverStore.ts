import Store from 'electron-store'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Type — must stay JSON-serialisable (strings for dates, no Date objects)
// ---------------------------------------------------------------------------

export interface StoredServer {
  id: string
  ip: string
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
  return store.get('servers', [])
}

export function getById(id: string): StoredServer | undefined {
  return store.get('servers', []).find((s) => s.id === id)
}

export function getByIpPort(ip: string, port: number): StoredServer | undefined {
  return store.get('servers', []).find((s) => s.ip === ip && s.port === port)
}

export function add(
  params: Omit<StoredServer, 'id' | 'addedAt'>
): { success: boolean; reason?: string; server?: StoredServer } {
  const servers = store.get('servers', [])
  if (servers.some((s) => s.ip === params.ip && s.port === params.port)) {
    return { success: false, reason: 'duplicate' }
  }
  const server: StoredServer = {
    ...params,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  store.set('servers', [...servers, server])
  return { success: true, server }
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
 * Insert-or-update by ip:port.
 * Used when ADD_SERVER_MANUAL completes — ensures the server is persisted
 * without creating duplicates.
 */
export function upsertByIpPort(params: Omit<StoredServer, 'id' | 'addedAt'>): StoredServer {
  const servers = store.get('servers', [])
  const idx = servers.findIndex((s) => s.ip === params.ip && s.port === params.port)
  if (idx >= 0) {
    servers[idx] = { ...servers[idx], ...params }
    store.set('servers', servers)
    return servers[idx]
  }
  const server: StoredServer = {
    ...params,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  store.set('servers', [...servers, server])
  return server
}
