import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { encrypt, decrypt, isAvailable as safeStorageAvailable } from './safeStorageUtil'
import { createLogger } from '../utils/logger'
const log = createLogger('server-store')

// ---------------------------------------------------------------------------
// Type — must stay JSON-serialisable (strings for dates, no Date objects)
// ---------------------------------------------------------------------------

export type ServerHostingType = 'on-premise' | 'cloud'

export interface StoredServer {
  id: string
  host: string // canonical address — required
  ip?: string // legacy alias kept for migration; normalizeServer() strips it
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  /** Encrypted password (base64-encoded DPAPI/Keychain blob via safeStorage) — never plaintext on disk */
  encryptedPassword?: string
  /** @deprecated Do not persist. Populated transiently by getAll/getByIpPort after decryption. */
  password?: string
  addedAt: string // ISO 8601
  lastSeen?: string // ISO 8601 — last successful connection
  unreachable?: boolean // true while health-check reports failure
  unreachableSince?: string // ISO 8601 — timestamp of first failure
  machineName?: string // SERVERPROPERTY('MachineName') — used to group multiple instances on the same physical machine
  // Always On AG membership — populated at runtime, refreshed on startup
  agGroupId?: string // group_id UUID if this server belongs to an AG
  agName?: string // AG name, e.g. "AG-PROD-01" — used for sidebar grouping
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  logicalCpus?: number // cpu_count from sys.dm_os_sys_info (persisted, rarely changes)
  physicalCpus?: number // cpu_count / hyperthread_ratio
  hostingType?: ServerHostingType
  notes?: string // free-text notes; persisted in electron-store
}

// ---------------------------------------------------------------------------
// Encryption helpers (safeStorage — Windows DPAPI, macOS Keychain, Linux Secret Service)
// ---------------------------------------------------------------------------

function encryptPwd(plain: string): string {
  return encrypt(plain)
}

function decryptPwd(stored: string): string {
  return decrypt(stored)
}

/** Inject decrypted password into a stored server before returning to callers */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withDecryptedPassword(s: any): StoredServer {
  const srv: StoredServer = normalizeServer(s)
  if (srv.encryptedPassword) {
    srv.password = decryptPwd(srv.encryptedPassword)
  }
  return srv
}

/**
 * C2 hardening: returns a copy of a StoredServer with password and
 * encryptedPassword fields stripped. Use before sending a StoredServer across
 * the IPC boundary to the renderer — credentials must never leave the main
 * process in plaintext, and the encrypted blob is also useless (and tempting)
 * to the renderer.
 */
export function stripCredentials(s: StoredServer): StoredServer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _pw, encryptedPassword: _enc, ...safe } = s
  return safe as StoredServer
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
  return (store.get('servers', []) as any[]).map(withDecryptedPassword)
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
  if (
    servers.some((s: any) => (s.host ?? s.ip) === normalized.host && s.port === normalized.port)
  ) {
    return { success: false, reason: 'duplicate' }
  }
  const server: StoredServer = {
    ...normalized,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  // Encrypt password before persisting; never write plaintext to disk
  if (server.password) {
    server.encryptedPassword = encryptPwd(server.password)
    delete server.password
  }
  store.set('servers', [...servers, server])
  return { success: true, server: withDecryptedPassword(server) }
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
    log.info('[serverStore] migrated', raw.length, 'servers ip→host')
  } catch (err) {
    log.error('[serverStore] migration error:', err)
  }
}

export function update(id: string, patch: Partial<StoredServer>): void {
  const servers = store.get('servers', [])
  const idx = servers.findIndex((s) => s.id === id)
  if (idx >= 0) {
    const safePatch = { ...patch }
    if (safePatch.password) {
      safePatch.encryptedPassword = encryptPwd(safePatch.password)
      delete safePatch.password
    }
    servers[idx] = { ...servers[idx], ...safePatch }
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
  const idx = servers.findIndex(
    (s: any) => (s.host ?? s.ip) === normalized.host && s.port === normalized.port
  )
  if (idx >= 0) {
    const safePatch = { ...normalized }
    if (safePatch.password) {
      safePatch.encryptedPassword = encryptPwd(safePatch.password)
      delete safePatch.password
    }
    servers[idx] = { ...servers[idx], ...safePatch }
    store.set('servers', servers)
    return withDecryptedPassword(servers[idx])
  }
  const server: StoredServer = {
    ...normalized,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  if (server.password) {
    server.encryptedPassword = encryptPwd(server.password)
    delete server.password
  }
  store.set('servers', [...servers, server])
  return withDecryptedPassword(server)
}

// ---------------------------------------------------------------------------
// Backup / restore helpers
// ---------------------------------------------------------------------------

/** Safe export shape — no credentials, used for backup files */
export interface ServerBackupEntry {
  host: string
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  machineName?: string
  hostingType?: ServerHostingType
  notes?: string
  alias?: string
}

export interface ServerBackupFile {
  version: 1
  exportedAt: string
  servers: ServerBackupEntry[]
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

/** Strips credentials and runtime-only fields for safe export */
function toBackupEntry(s: StoredServer): ServerBackupEntry {
  return {
    host: s.host,
    port: s.port,
    ...(s.instanceName !== undefined && { instanceName: s.instanceName }),
    useWindowsAuth: s.useWindowsAuth,
    ...(s.username !== undefined && { username: s.username }),
    ...(s.machineName !== undefined && { machineName: s.machineName }),
    ...(s.hostingType !== undefined && { hostingType: s.hostingType }),
    ...(s.notes !== undefined && { notes: s.notes })
  }
}

/**
 * Writes a password-free JSON backup next to the electron-store file.
 * Called automatically after each mutation so the backup is always current.
 */
export function writeAutoBackup(): void {
  try {
    const servers = store.get('servers', [])
    const payload: ServerBackupFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: servers.map(toBackupEntry)
    }
    const backupPath = join(dirname(store.path), 'sql-sentinel-backup.json')
    writeFileSync(backupPath, JSON.stringify(payload, null, 2), 'utf8')
  } catch (err) {
    log.error('[serverStore] writeAutoBackup error:', err)
  }
}

/** Returns a JSON string suitable for a user-triggered backup export */
export function exportForBackup(): string {
  const servers = store.get('servers', [])
  const payload: ServerBackupFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    servers: servers.map(toBackupEntry)
  }
  return JSON.stringify(payload, null, 2)
}

/** Parses a backup JSON file and imports missing servers. Returns counts. */
export function importFromBackup(json: string): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] }
  let parsed: ServerBackupFile
  try {
    parsed = JSON.parse(json) as ServerBackupFile
  } catch {
    result.errors.push('Invalid JSON file')
    return result
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.servers)) {
    result.errors.push('Unrecognized backup format')
    return result
  }
  for (const entry of parsed.servers) {
    try {
      if (!entry.host || !entry.port) {
        result.errors.push(`Skipped invalid entry: ${JSON.stringify(entry)}`)
        continue
      }
      const existing = getByIpPort(entry.host, entry.port)
      if (existing) {
        result.skipped++
        continue
      }
      const addResult = add(entry)
      if (addResult.success) {
        result.imported++
      } else {
        result.skipped++
      }
    } catch (err) {
      result.errors.push(`Error importing ${entry.host}:${entry.port}: ${String(err)}`)
    }
  }
  return result
}

/**
 * Reads the auto-backup file and returns its content, or null if it doesn't exist.
 * Used for disaster recovery when the main store is lost.
 */
export function readAutoBackup(): string | null {
  try {
    const backupPath = join(dirname(store.path), 'sql-sentinel-backup.json')
    return readFileSync(backupPath, 'utf8')
  } catch {
    return null
  }
}

/**
 * One-shot migration: encrypt any plaintext passwords left in the store from
 * previous app versions. Safe to call on every boot — no-op if already migrated.
 */
export function migrateEncryptCredentials(): void {
  try {
    if (!safeStorageAvailable()) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = store.get('servers', []) as any[]
    const toMigrate = raw.filter((s) => s.password && !s.encryptedPassword)
    if (toMigrate.length === 0) return
    const migrated = raw.map((s) => {
      if (!s.password || s.encryptedPassword) return s
      const { password, ...rest } = s
      return { ...rest, encryptedPassword: encryptPwd(password) }
    })
    store.set('servers', migrated)
    log.info('[serverStore] migrated', toMigrate.length, 'server(s) to encrypted credentials')
  } catch (err) {
    log.error('[serverStore] migrateEncryptCredentials error:', err)
  }
}
