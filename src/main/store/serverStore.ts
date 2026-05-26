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

/**
 * Shape of a server record as it exists on disk. Pre-migration records may
 * carry `ip` instead of (or alongside) `host`; normalizeServer() collapses
 * them. Using this type for raw store reads avoids `as any[]` casts while
 * being honest about what the JSON may actually contain.
 */
type PersistedServer = Omit<StoredServer, 'host'> & { host?: string; ip?: string }

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
function withDecryptedPassword(s: PersistedServer): StoredServer {
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
function normalizeServer(s: PersistedServer): StoredServer {
  const host: string = s.host ?? s.ip ?? ''
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ip: _ip, ...rest } = s
  return { ...rest, host } as StoredServer
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function validateNewServer(s: StoredServer): string | null {
  if (!s.host) return 'missing host'
  if (!IPV4_RE.test(s.host) && !HOSTNAME_RE.test(s.host)) return 'invalid host'
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) return 'invalid port'
  if (typeof s.useWindowsAuth !== 'boolean') return 'invalid auth mode'
  return null
}

// ---------------------------------------------------------------------------
// electron-store singleton
// ---------------------------------------------------------------------------

type Schema = { servers: PersistedServer[] }

const store = new Store<Schema>({
  name: 'sql-sentinel-data',
  defaults: { servers: [] }
})

// ---------------------------------------------------------------------------
// lastSeen write-coalescing buffer
// ---------------------------------------------------------------------------
// Health check writes lastSeen for every reachable server every 60s. Each
// store.set() rewrites the entire JSON file (~50KB) synchronously — with
// AV-scan on Windows that can be 100-300ms blocked I/O each. At 200 servers,
// the cost was ~33% of every minute spent in disk-write storm.
//
// We now buffer lastSeen updates in memory and flush to disk every 5 minutes
// (or on shutdown). Callers should use markLastSeen() instead of
// update(id, { lastSeen }) for this specific field.
const lastSeenBuffer = new Map<string, string>()
const LAST_SEEN_FLUSH_INTERVAL_MS = 5 * 60 * 1000
let lastSeenFlushTimer: ReturnType<typeof setInterval> | null = null

export function markLastSeen(id: string, isoTimestamp: string): void {
  lastSeenBuffer.set(id, isoTimestamp)
  if (!lastSeenFlushTimer) {
    lastSeenFlushTimer = setInterval(flushLastSeenBuffer, LAST_SEEN_FLUSH_INTERVAL_MS)
    lastSeenFlushTimer.unref?.()
  }
}

export function flushLastSeenBuffer(): void {
  if (lastSeenBuffer.size === 0) return
  const updates = Array.from(lastSeenBuffer.entries())
  lastSeenBuffer.clear()
  const servers = store.get('servers', [])
  let dirty = false
  for (const [id, ts] of updates) {
    const idx = servers.findIndex((s) => s.id === id)
    if (idx < 0) continue
    if (servers[idx].lastSeen === ts) continue
    servers[idx] = { ...servers[idx], lastSeen: ts }
    dirty = true
  }
  if (dirty) {
    store.set('servers', servers)
    invalidateStrippedCache()
  }
}

/** Read the in-memory lastSeen value (overrides on-disk if newer). */
export function getBufferedLastSeen(id: string): string | undefined {
  return lastSeenBuffer.get(id)
}

/** Stop the flush timer — called on shutdown after a final flush. */
export function stopLastSeenFlushTimer(): void {
  if (lastSeenFlushTimer) {
    clearInterval(lastSeenFlushTimer)
    lastSeenFlushTimer = null
  }
}

// ---------------------------------------------------------------------------
// Stripped-snapshot cache
// ---------------------------------------------------------------------------
// getAllStripped() is on a hot path (called by worker save, AG sync, tray menu
// rebuild — ~40+ times/min on a 200-server fleet). electron-store has NO
// in-memory cache: every store.get() re-parses the JSON file from disk. We
// memoize the stripped result and invalidate it from the mutating functions
// below. ~50KB JSON parse × 40/min = 40-80ms/min CPU recovered.
let _strippedCache: StoredServer[] | null = null
function invalidateStrippedCache(): void {
  _strippedCache = null
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export function getAll(): StoredServer[] {
  return store.get('servers', []).map(withDecryptedPassword)
}

/**
 * Returns servers with credentials stripped — never decrypts.
 * Memoized; cache is invalidated on every mutation (add/update/upsert/remove).
 */
export function getAllStripped(): StoredServer[] {
  if (_strippedCache) return _strippedCache
  _strippedCache = store.get('servers', []).map((s) => stripCredentials(normalizeServer(s)))
  return _strippedCache
}

/**
 * Lookup-by-id without decrypting every other server's password.
 * Decrypts only the matching record.
 */
export function getById(id: string): StoredServer | undefined {
  const raw = store.get('servers', [])
  const match = raw.find((s) => s.id === id)
  return match ? withDecryptedPassword(match) : undefined
}

/**
 * Returns every server-store id that resolves to the same SQL Server instance
 * (host + port + instanceName) as the given id. Used by the incident detector
 * to dedupe alerts across duplicate registrations of the same physical instance.
 * The result always contains at least the input id (when found).
 */
export function getInstanceAliases(id: string): string[] {
  const raw = store.get('servers', [])
  const me = raw.find((s) => s.id === id)
  if (!me) return [id]
  const host = me.host ?? me.ip
  const port = me.port
  const inst = me.instanceName ?? ''
  return raw
    .filter(
      (s) =>
        (s.host ?? s.ip) === host && s.port === port && (s.instanceName ?? '') === inst
    )
    .map((s) => s.id)
}

export function getByIpPort(host: string, port: number): StoredServer | undefined {
  const raw = store.get('servers', [])
  const match = raw.find((s) => (s.host ?? s.ip) === host && s.port === port)
  return match ? withDecryptedPassword(match) : undefined
}

/**
 * Lookup-by-host:port that NEVER decrypts the password. Use this in hot paths
 * (worker tick, batch save) where the caller only needs id/host/port/cpu fields.
 * Avoids ~250-1000 synchronous DPAPI calls/min on a 200-server fleet.
 */
export function getStrippedByIpPort(host: string, port: number): StoredServer | undefined {
  const raw = store.get('servers', [])
  const match = raw.find((s) => (s.host ?? s.ip) === host && s.port === port)
  return match ? stripCredentials(normalizeServer(match)) : undefined
}

export function add(
  params: unknown
): { success: boolean; reason?: string; server?: StoredServer } {
  if (!params || typeof params !== 'object') return { success: false, reason: 'invalid params' }
  const normalized = normalizeServer(params as PersistedServer)
  const invalidReason = validateNewServer(normalized)
  if (invalidReason) return { success: false, reason: invalidReason }
  const servers = store.get('servers', [])
  if (
    servers.some((s) => (s.host ?? s.ip) === normalized.host && s.port === normalized.port)
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
  invalidateStrippedCache()
  return { success: true, server: withDecryptedPassword(server) }
}

/**
 * One-shot migration: fix any records that have ip but no host.
 * Safe to call on every boot — no-op if data is already normalized.
 */
export function migrateHostField(): void {
  try {
    const raw = store.get('servers', [])
    const needsMigration = raw.some((s) => !s.host)
    if (!needsMigration) return
    store.set('servers', raw.map(normalizeServer))
    invalidateStrippedCache()
    log.info('[serverStore] migrated', raw.length, 'servers ip→host')
  } catch (err) {
    log.error('[serverStore] migration error:', err)
  }
}

export function update(id: string, patch: Partial<StoredServer>): void {
  const servers = store.get('servers', [])
  const idx = servers.findIndex((s) => s.id === id)
  if (idx < 0) return

  // Defence-in-depth: route the patch through the same whitelist we use for
  // upserts. Without this, a renderer (or a hijacked one) could send
  // { id: 'B', addedAt: '...' } and overwrite the record's identity. id and
  // addedAt are deliberately excluded from UPSERT_ALLOWED_FIELDS.
  const safePatch = pickAllowedFields(patch)
  if (typeof safePatch.password === 'string' && safePatch.password.length > 0) {
    safePatch.encryptedPassword = encryptPwd(safePatch.password as string)
    delete safePatch.password
  }

  // No-op short-circuit: if every field in the patch already matches the
  // current value, skip the write. Prevents the 50KB-JSON sync write storm
  // caused by polling-driven CPU/AG-role updates (AV-scan can take 100-300ms
  // per write on Windows).
  const current = servers[idx] as Record<string, unknown>
  let dirty = false
  for (const key of Object.keys(safePatch)) {
    if (current[key] !== safePatch[key]) {
      dirty = true
      break
    }
  }
  if (!dirty) return

  servers[idx] = { ...servers[idx], ...safePatch }
  store.set('servers', servers)
  invalidateStrippedCache()
}

export function remove(id: string): void {
  store.set(
    'servers',
    store.get('servers', []).filter((s) => s.id !== id)
  )
  invalidateStrippedCache()
}

// Defence-in-depth: only fields in this allow-list are accepted from any
// upsert payload. Renderer-supplied objects with unknown keys (typos, hijacked
// payloads, future schema drift) cannot pollute electron-store.
const UPSERT_ALLOWED_FIELDS = [
  'host',
  'ip', // legacy alias — normalizeServer collapses it into host
  'port',
  'instanceName',
  'machineName',
  'useWindowsAuth',
  'username',
  'password',
  'encryptedPassword',
  'lastSeen',
  'unreachable',
  'unreachableSince',
  'agGroupId',
  'agName',
  'agRole',
  'logicalCpus',
  'physicalCpus',
  'hostingType',
  'notes'
] as const

function pickAllowedFields(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {}
  const obj = params as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of UPSERT_ALLOWED_FIELDS) {
    if (key in obj) out[key] = obj[key]
  }
  return out
}

/**
 * Insert-or-update by host:port.
 * Used when ADD_SERVER_MANUAL completes — ensures the server is persisted
 * without creating duplicates.
 */
export function upsertByIpPort(params: unknown): StoredServer {
  const filtered = pickAllowedFields(params)
  const normalized = normalizeServer(filtered as PersistedServer)
  const invalidReason = validateNewServer(normalized)
  if (invalidReason) throw new Error(invalidReason)
  const servers = store.get('servers', [])
  const idx = servers.findIndex(
    (s) => (s.host ?? s.ip) === normalized.host && s.port === normalized.port
  )
  if (idx >= 0) {
    const safePatch = { ...normalized }
    if (safePatch.password) {
      safePatch.encryptedPassword = encryptPwd(safePatch.password)
      delete safePatch.password
    }
    servers[idx] = { ...servers[idx], ...safePatch }
    store.set('servers', servers)
    invalidateStrippedCache()
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
  invalidateStrippedCache()
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
      servers: servers.map((s) => toBackupEntry(normalizeServer(s)))
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
    servers: servers.map((s) => toBackupEntry(normalizeServer(s)))
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
    const raw = store.get('servers', [])
    const toMigrate = raw.filter((s) => s.password && !s.encryptedPassword)
    if (toMigrate.length === 0) return
    const migrated = raw.map((s) => {
      if (!s.password || s.encryptedPassword) return s
      const { password, ...rest } = s
      return { ...rest, encryptedPassword: encryptPwd(password) }
    })
    store.set('servers', migrated)
    invalidateStrippedCache()
    log.info('[serverStore] migrated', toMigrate.length, 'server(s) to encrypted credentials')
  } catch (err) {
    log.error('[serverStore] migrateEncryptCredentials error:', err)
  }
}
