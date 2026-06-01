import * as sql from 'mssql'
import { randomUUID } from 'node:crypto'
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import { getPool } from './connection'
import {
  encrypt,
  decrypt,
  isAvailable as safeStorageAvailable,
  isEncrypted
} from '../../utils/safeStorageUtil'
import { createLogger } from '../../utils/logger'
import type { ServerConnection } from '../../collectors/types'

const log = createLogger('server-repo')

// ---------------------------------------------------------------------------
// Public types — mirror the legacy serverStore.ts API
// ---------------------------------------------------------------------------

export type ServerHostingType = 'on-premise' | 'cloud'

export interface StoredServer {
  id: string
  host: string
  /** @deprecated legacy alias kept only for the renderer/IPC payload shape. */
  ip?: string
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  /** Encrypted password (safeStorage base64 blob) — never plaintext on disk. */
  encryptedPassword?: string
  /** @deprecated Do not persist. Populated transiently by getAll/getByIpPort after decryption. */
  password?: string
  addedAt: string
  lastSeen?: string
  unreachable?: boolean
  unreachableSince?: string
  machineName?: string
  agGroupId?: string
  agName?: string
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  logicalCpus?: number
  physicalCpus?: number
  hostingType?: ServerHostingType
  notes?: string
  // ── Elevated "remediation" credential (opt-in, per server) ──────────────
  // Used ONLY to execute approved AI-suggested fixes, so the monitoring
  // credential above can stay least-privilege (read-only).
  remediationUsername?: string
  remediationUseWindowsAuth?: boolean
  /** Encrypted remediation password (safeStorage base64 blob) — never plaintext on disk. */
  remediationEncryptedPassword?: string
  /** @deprecated Do not persist. Populated transiently after decryption. */
  remediationPassword?: string
}

interface ServerRow {
  id: string
  host: string
  port: number
  instance_name: string | null
  use_windows_auth: boolean | number
  username: string | null
  encrypted_password: string | null
  added_at: string
  last_seen: string | null
  unreachable: boolean | number
  unreachable_since: string | null
  machine_name: string | null
  ag_group_id: string | null
  ag_name: string | null
  ag_role: string | null
  logical_cpus: number | null
  physical_cpus: number | null
  hosting_type: string | null
  notes: string | null
  remediation_username: string | null
  remediation_encrypted_password: string | null
  remediation_use_windows_auth: boolean | number | null
}

function rowToServer(row: ServerRow): StoredServer {
  const useWindowsAuth = row.use_windows_auth === true || row.use_windows_auth === 1
  const unreachable = row.unreachable === true || row.unreachable === 1
  const agRole =
    row.ag_role === 'PRIMARY' || row.ag_role === 'SECONDARY' || row.ag_role === 'RESOLVING'
      ? row.ag_role
      : undefined
  const hostingType =
    row.hosting_type === 'on-premise' || row.hosting_type === 'cloud' ? row.hosting_type : undefined
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    ...(row.instance_name != null && { instanceName: row.instance_name }),
    useWindowsAuth,
    ...(row.username != null && { username: row.username }),
    ...(row.encrypted_password != null && { encryptedPassword: row.encrypted_password }),
    addedAt: row.added_at,
    ...(row.last_seen != null && { lastSeen: row.last_seen }),
    unreachable,
    ...(row.unreachable_since != null && { unreachableSince: row.unreachable_since }),
    ...(row.machine_name != null && { machineName: row.machine_name }),
    ...(row.ag_group_id != null && { agGroupId: row.ag_group_id }),
    ...(row.ag_name != null && { agName: row.ag_name }),
    ...(agRole != null && { agRole }),
    ...(row.logical_cpus != null && { logicalCpus: row.logical_cpus }),
    ...(row.physical_cpus != null && { physicalCpus: row.physical_cpus }),
    ...(hostingType != null && { hostingType }),
    ...(row.notes != null && { notes: row.notes }),
    ...(row.remediation_username != null && { remediationUsername: row.remediation_username }),
    ...(row.remediation_encrypted_password != null && {
      remediationEncryptedPassword: row.remediation_encrypted_password
    }),
    ...(row.remediation_use_windows_auth != null && {
      remediationUseWindowsAuth:
        row.remediation_use_windows_auth === true || row.remediation_use_windows_auth === 1
    })
  }
}

// ---------------------------------------------------------------------------
// Validation (host / port / auth)
// ---------------------------------------------------------------------------

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

// Defence-in-depth: only fields in this allow-list are accepted from any
// upsert payload. Renderer-supplied objects with unknown keys (typos, hijacked
// payloads, future schema drift) cannot pollute the row.
const UPSERT_ALLOWED_FIELDS = [
  'host',
  'ip',
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
  'notes',
  'remediationUsername',
  'remediationPassword',
  'remediationEncryptedPassword',
  'remediationUseWindowsAuth'
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

/** Collapse legacy `ip` field into `host`. */
function normalizeServer(s: Partial<StoredServer> & { ip?: string }): StoredServer {
  const host: string = s.host ?? s.ip ?? ''
  const { ip: _ip, ...rest } = s
  return { ...(rest as StoredServer), host }
}

// ---------------------------------------------------------------------------
// Credentials helpers
// ---------------------------------------------------------------------------

function withDecryptedPassword(s: StoredServer): StoredServer {
  const out: StoredServer = { ...s }
  if (out.encryptedPassword) {
    out.password = decrypt(out.encryptedPassword)
  }
  if (out.remediationEncryptedPassword) {
    out.remediationPassword = decrypt(out.remediationEncryptedPassword)
  }
  return out
}

export function stripCredentials(s: StoredServer): StoredServer {
  const {
    password: _pw,
    encryptedPassword: _enc,
    remediationPassword: _rpw,
    remediationEncryptedPassword: _renc,
    ...safe
  } = s
  // Keep remediationUsername / remediationUseWindowsAuth so the UI can show
  // whether an elevated credential is configured, without exposing the secret.
  return safe as StoredServer
}

/**
 * Build a ServerConnection from the server's *elevated remediation* credential,
 * used only to execute approved AI-suggested fixes. Returns null when no
 * remediation credential has been configured — callers must refuse to execute
 * rather than silently falling back to the read-only monitoring credential.
 *
 * Accepts a StoredServer that has already been through withDecryptedPassword
 * (e.g. from getById); decrypts on the fly as a fallback for safety.
 */
export function resolveRemediationConnection(s: StoredServer): ServerConnection | null {
  const useWindowsAuth = s.remediationUseWindowsAuth === true
  const password =
    s.remediationPassword ??
    (s.remediationEncryptedPassword ? decrypt(s.remediationEncryptedPassword) : undefined)

  // SQL auth requires both username and password; Windows auth uses the
  // service process identity, so no explicit credential is needed.
  if (!useWindowsAuth && (!s.remediationUsername || !password)) return null

  return {
    ip: s.host,
    port: s.port,
    instanceName: s.instanceName,
    username: s.remediationUsername,
    password,
    useWindowsAuth,
    encrypt: true,
    trustServerCertificate: true
  }
}

// ---------------------------------------------------------------------------
// In-memory cache — required so the hot-path getters (tray refresh,
// per-tick worker lookups, AG sync) remain synchronous. Mutations refresh
// the cache before returning so callers see a consistent view.
// ---------------------------------------------------------------------------

let _cache: StoredServer[] | null = null
let _cacheById: Map<string, StoredServer> = new Map()
let _cacheByHostPort: Map<string, StoredServer> = new Map()
let _strippedCache: StoredServer[] | null = null

function cacheKey(host: string, port: number): string {
  return `${host}:${port}`
}

function rebuildIndexes(): void {
  _cacheById = new Map()
  _cacheByHostPort = new Map()
  _strippedCache = null
  if (!_cache) return
  for (const s of _cache) {
    _cacheById.set(s.id, s)
    _cacheByHostPort.set(cacheKey(s.host, s.port), s)
  }
}

async function loadCache(): Promise<void> {
  const r = await getPool().request().query<ServerRow>(`SELECT * FROM dbo.servers`)
  _cache = r.recordset.map(rowToServer)
  rebuildIndexes()
}

/**
 * In-place cache update for single-row mutations. Avoids a full
 * SELECT * FROM dbo.servers after every update/insert — at 200 servers
 * that's 200 rows × 19 cols ≈ 4 KB roundtripped per single-field write,
 * burned in a tight loop by the health check and CPU-detection paths.
 *
 * The DB remains the source of truth: callers still await the INSERT/UPDATE
 * before patching the cache, so a failed write never leaks into the cache.
 */
function applyCachePatch(id: string, patch: Partial<StoredServer>): void {
  if (_cache == null) return
  const idx = _cache.findIndex((s) => s.id === id)
  if (idx < 0) return
  const updated: StoredServer = { ..._cache[idx], ...patch }
  // Strip undefined values from the patch so JSON.stringify and getById
  // observe the same shape they would after a full reload.
  const updatedRecord = updated as unknown as Record<string, unknown>
  for (const key of Object.keys(updatedRecord)) {
    if (updatedRecord[key] === undefined) delete updatedRecord[key]
  }
  _cache[idx] = updated
  _cacheById.set(id, updated)
  _cacheByHostPort.set(cacheKey(updated.host, updated.port), updated)
  _strippedCache = null
}

function appendToCache(server: StoredServer): void {
  if (_cache == null) return
  _cache.push(server)
  _cacheById.set(server.id, server)
  _cacheByHostPort.set(cacheKey(server.host, server.port), server)
  _strippedCache = null
}

function removeFromCache(id: string): void {
  if (_cache == null) return
  const idx = _cache.findIndex((s) => s.id === id)
  if (idx < 0) return
  const old = _cache[idx]
  _cache.splice(idx, 1)
  _cacheById.delete(id)
  _cacheByHostPort.delete(cacheKey(old.host, old.port))
  _strippedCache = null
}

/**
 * Initialise the server registry cache. Must be called after the storage pool
 * is connected and the schema is provisioned — typically right after initSchema().
 */
export async function init(): Promise<void> {
  await loadCache()
}

/** Force a cache refresh — exposed for tests and the migration shims. */
export async function reload(): Promise<void> {
  await loadCache()
}

/**
 * Returns the cache when populated; otherwise returns an empty array. This is
 * the "soft" path used by hot-path getters (tray, health check) so the app
 * can still boot before the storage wizard has been run. Mutations and the
 * importer go through `requireCache()` instead, which throws.
 */
function ensureCache(): StoredServer[] {
  return _cache ?? []
}

function requireCache(): StoredServer[] {
  if (_cache == null) {
    throw new Error('serverRepository: cache not initialized. Call init() at startup.')
  }
  return _cache
}

/** Public helper so callers can skip work when the registry isn't ready yet. */
export function isInitialized(): boolean {
  return _cache !== null
}

// ---------------------------------------------------------------------------
// lastSeen write-coalescing buffer — health check writes lastSeen every 60s
// for every reachable server. Each individual UPDATE would generate I/O storm;
// we buffer in memory and flush every 5 minutes (or on shutdown).
// ---------------------------------------------------------------------------

const lastSeenBuffer = new Map<string, string>()
const LAST_SEEN_FLUSH_INTERVAL_MS = 5 * 60 * 1000
let lastSeenFlushTimer: ReturnType<typeof setInterval> | null = null

export function markLastSeen(id: string, isoTimestamp: string): void {
  lastSeenBuffer.set(id, isoTimestamp)
  if (!lastSeenFlushTimer) {
    lastSeenFlushTimer = setInterval(() => {
      void flushLastSeenBuffer()
    }, LAST_SEEN_FLUSH_INTERVAL_MS)
    lastSeenFlushTimer.unref?.()
  }
}

// Maximum rows per batched UPDATE statement. Each row binds 2 params (id,
// last_seen) so the SQL Server 2100-parameter cap maxes out around 1000 —
// the conservative 250 leaves headroom for future column additions.
const LAST_SEEN_BATCH_SIZE = 250

export async function flushLastSeenBuffer(): Promise<void> {
  if (lastSeenBuffer.size === 0) return
  const updates = Array.from(lastSeenBuffer.entries())
  lastSeenBuffer.clear()
  // Filter out no-ops up front: rows whose buffered timestamp equals the
  // cached value, or that no longer exist in the registry. This shrinks the
  // VALUES list we send to the server.
  const dirty: Array<{ id: string; ts: string }> = []
  for (const [id, ts] of updates) {
    const current = _cacheById.get(id)
    if (!current) continue
    if (current.lastSeen === ts) continue
    dirty.push({ id, ts })
  }
  if (dirty.length === 0) return

  const pool = getPool()
  for (let off = 0; off < dirty.length; off += LAST_SEEN_BATCH_SIZE) {
    const chunk = dirty.slice(off, off + LAST_SEEN_BATCH_SIZE)
    const req = pool.request()
    const tuples: string[] = []
    for (let i = 0; i < chunk.length; i++) {
      req.input(`id${i}`, sql.NVarChar(36), chunk[i].id)
      req.input(`ts${i}`, sql.NVarChar(50), chunk[i].ts)
      tuples.push(`(@id${i}, @ts${i})`)
    }
    // UPDATE...FROM (VALUES ...) is the canonical SQL Server way to batch
    // single-column updates without resorting to MERGE or TVP overhead.
    // One round-trip per chunk; with 200 dirty servers we go from 200 to 1.
    await req.query(`
      UPDATE s
        SET s.last_seen = v.ts
      FROM dbo.servers AS s
      INNER JOIN (VALUES ${tuples.join(', ')}) AS v(id, ts) ON s.id = v.id
    `)
  }

  // Apply the same delta to the in-memory cache so callers immediately see
  // the new value without a full SELECT *.
  for (const { id, ts } of dirty) {
    applyCachePatch(id, { lastSeen: ts })
  }
}

export function getBufferedLastSeen(id: string): string | undefined {
  return lastSeenBuffer.get(id)
}

export function stopLastSeenFlushTimer(): void {
  if (lastSeenFlushTimer) {
    clearInterval(lastSeenFlushTimer)
    lastSeenFlushTimer = null
  }
}

// ---------------------------------------------------------------------------
// CRUD — getters are sync (cache-backed); mutations are async (write + refresh)
// ---------------------------------------------------------------------------

export function getAll(): StoredServer[] {
  return ensureCache().map(withDecryptedPassword)
}

export function getAllStripped(): StoredServer[] {
  if (_strippedCache) return _strippedCache
  _strippedCache = ensureCache().map(stripCredentials)
  return _strippedCache
}

export function getById(id: string): StoredServer | undefined {
  const match = _cacheById.get(id)
  return match ? withDecryptedPassword(match) : undefined
}

export function getInstanceAliases(id: string): string[] {
  if (_cache == null) return [id]
  const cache = _cache
  const me = _cacheById.get(id)
  if (!me) return [id]
  const inst = me.instanceName ?? ''
  return cache
    .filter((s) => s.host === me.host && s.port === me.port && (s.instanceName ?? '') === inst)
    .map((s) => s.id)
}

export function getByIpPort(host: string, port: number): StoredServer | undefined {
  const match = _cacheByHostPort.get(cacheKey(host, port))
  return match ? withDecryptedPassword(match) : undefined
}

export function getStrippedByIpPort(host: string, port: number): StoredServer | undefined {
  const match = _cacheByHostPort.get(cacheKey(host, port))
  return match ? stripCredentials(match) : undefined
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function insertRow(s: StoredServer): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), s.id)
    .input('host', sql.NVarChar(253), s.host)
    .input('port', sql.Int, s.port)
    .input('instance_name', sql.NVarChar(200), s.instanceName ?? null)
    .input('use_windows_auth', sql.Bit, s.useWindowsAuth ? 1 : 0)
    .input('username', sql.NVarChar(200), s.username ?? null)
    .input('encrypted_password', sql.NVarChar(sql.MAX), s.encryptedPassword ?? null)
    .input('added_at', sql.NVarChar(50), s.addedAt)
    .input('last_seen', sql.NVarChar(50), s.lastSeen ?? null)
    .input('unreachable', sql.Bit, s.unreachable ? 1 : 0)
    .input('unreachable_since', sql.NVarChar(50), s.unreachableSince ?? null)
    .input('machine_name', sql.NVarChar(200), s.machineName ?? null)
    .input('ag_group_id', sql.NVarChar(36), s.agGroupId ?? null)
    .input('ag_name', sql.NVarChar(200), s.agName ?? null)
    .input('ag_role', sql.NVarChar(20), s.agRole ?? null)
    .input('logical_cpus', sql.Int, s.logicalCpus ?? null)
    .input('physical_cpus', sql.Int, s.physicalCpus ?? null)
    .input('hosting_type', sql.NVarChar(20), s.hostingType ?? null)
    .input('notes', sql.NVarChar(sql.MAX), s.notes ?? null)
    .input('remediation_username', sql.NVarChar(200), s.remediationUsername ?? null)
    .input(
      'remediation_encrypted_password',
      sql.NVarChar(sql.MAX),
      s.remediationEncryptedPassword ?? null
    )
    .input(
      'remediation_use_windows_auth',
      sql.Bit,
      s.remediationUseWindowsAuth == null ? null : s.remediationUseWindowsAuth ? 1 : 0
    )
    .query(`INSERT INTO dbo.servers
      (id, host, port, instance_name, use_windows_auth, username, encrypted_password,
       added_at, last_seen, unreachable, unreachable_since, machine_name,
       ag_group_id, ag_name, ag_role, logical_cpus, physical_cpus, hosting_type, notes,
       remediation_username, remediation_encrypted_password, remediation_use_windows_auth)
      VALUES (@id, @host, @port, @instance_name, @use_windows_auth, @username, @encrypted_password,
              @added_at, @last_seen, @unreachable, @unreachable_since, @machine_name,
              @ag_group_id, @ag_name, @ag_role, @logical_cpus, @physical_cpus, @hosting_type, @notes,
              @remediation_username, @remediation_encrypted_password, @remediation_use_windows_auth)`)
}

export interface AddResult {
  success: boolean
  reason?: string
  server?: StoredServer
}

// SQL Server error number for unique-constraint violation; emitted on the
// dbo.servers UQ_servers_host_port constraint when two concurrent callers
// race past the in-memory cache duplicate check.
const SQL_UNIQUE_VIOLATION = 2627
const SQL_UNIQUE_VIOLATION_ALT = 2601

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { number?: number; code?: string } | null)?.number
  return code === SQL_UNIQUE_VIOLATION || code === SQL_UNIQUE_VIOLATION_ALT
}

export async function add(params: unknown): Promise<AddResult> {
  if (!params || typeof params !== 'object') return { success: false, reason: 'invalid params' }
  const normalized = normalizeServer(params as Partial<StoredServer>)
  const invalidReason = validateNewServer(normalized)
  if (invalidReason) return { success: false, reason: invalidReason }

  const dup = _cacheByHostPort.get(cacheKey(normalized.host, normalized.port))
  if (dup) return { success: false, reason: 'duplicate' }

  const server: StoredServer = {
    ...normalized,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  if (server.password) {
    server.encryptedPassword = encrypt(server.password)
    delete server.password
  }
  if (server.remediationPassword) {
    server.remediationEncryptedPassword = encrypt(server.remediationPassword)
    delete server.remediationPassword
  }
  try {
    await insertRow(server)
  } catch (err) {
    // Two concurrent callers (e.g. Electron + service) can both pass the
    // cache duplicate check; the DB's UNIQUE(host,port) catches the loser.
    // Reload the cache so the loser can observe the winner's row.
    if (isUniqueViolation(err)) {
      await loadCache()
      return { success: false, reason: 'duplicate' }
    }
    throw err
  }
  appendToCache(server)
  return { success: true, server: withDecryptedPassword(server) }
}

// Column whitelist for UPDATE so we never let a renderer-supplied key escape
// into a dynamic SQL fragment. Maps API key (camelCase) → DB column (snake_case).
const UPDATE_COLUMNS: Record<string, { column: string; type: () => sql.ISqlType }> = {
  host: { column: 'host', type: () => sql.NVarChar(253) },
  port: { column: 'port', type: () => sql.Int() },
  instanceName: { column: 'instance_name', type: () => sql.NVarChar(200) },
  useWindowsAuth: { column: 'use_windows_auth', type: () => sql.Bit() },
  username: { column: 'username', type: () => sql.NVarChar(200) },
  encryptedPassword: { column: 'encrypted_password', type: () => sql.NVarChar(sql.MAX) },
  lastSeen: { column: 'last_seen', type: () => sql.NVarChar(50) },
  unreachable: { column: 'unreachable', type: () => sql.Bit() },
  unreachableSince: { column: 'unreachable_since', type: () => sql.NVarChar(50) },
  machineName: { column: 'machine_name', type: () => sql.NVarChar(200) },
  agGroupId: { column: 'ag_group_id', type: () => sql.NVarChar(36) },
  agName: { column: 'ag_name', type: () => sql.NVarChar(200) },
  agRole: { column: 'ag_role', type: () => sql.NVarChar(20) },
  logicalCpus: { column: 'logical_cpus', type: () => sql.Int() },
  physicalCpus: { column: 'physical_cpus', type: () => sql.Int() },
  hostingType: { column: 'hosting_type', type: () => sql.NVarChar(20) },
  notes: { column: 'notes', type: () => sql.NVarChar(sql.MAX) },
  remediationUsername: { column: 'remediation_username', type: () => sql.NVarChar(200) },
  remediationEncryptedPassword: {
    column: 'remediation_encrypted_password',
    type: () => sql.NVarChar(sql.MAX)
  },
  remediationUseWindowsAuth: { column: 'remediation_use_windows_auth', type: () => sql.Bit() }
}

function normalizeUpdateValue(key: string, value: unknown): unknown {
  if (value === undefined) return null
  if (key === 'useWindowsAuth' || key === 'unreachable' || key === 'remediationUseWindowsAuth') {
    return value ? 1 : 0
  }
  return value
}

export async function update(id: string, patch: Partial<StoredServer>): Promise<void> {
  const current = _cacheById.get(id)
  if (!current) return

  const safePatch = pickAllowedFields(patch)
  if (typeof safePatch.password === 'string' && safePatch.password.length > 0) {
    safePatch.encryptedPassword = encrypt(safePatch.password as string)
  }
  delete safePatch.password
  if (
    typeof safePatch.remediationPassword === 'string' &&
    safePatch.remediationPassword.length > 0
  ) {
    safePatch.remediationEncryptedPassword = encrypt(safePatch.remediationPassword as string)
  }
  delete safePatch.remediationPassword
  // Collapse legacy `ip` into `host` if the caller still sends it.
  if (typeof safePatch.ip === 'string' && safePatch.ip && !safePatch.host) {
    safePatch.host = safePatch.ip
  }
  delete safePatch.ip

  // Filter to known columns and skip no-op fields so we don't burn write I/O.
  const setFragments: string[] = []
  const req = getPool().request().input('id', sql.NVarChar(36), id)
  const appliedPatch: Partial<StoredServer> = {}
  let paramIdx = 0
  for (const [key, rawValue] of Object.entries(safePatch)) {
    const meta = UPDATE_COLUMNS[key]
    if (!meta) continue
    const value = normalizeUpdateValue(key, rawValue)
    // No-op short-circuit (avoids the JSON write storm caused by polling-driven
    // CPU/AG-role updates with unchanged values).
    const currentValue = (current as unknown as Record<string, unknown>)[key]
    const isBitKey =
      key === 'useWindowsAuth' || key === 'unreachable' || key === 'remediationUseWindowsAuth'
    const normalizedCurrent = isBitKey ? (currentValue ? 1 : 0) : currentValue
    if (normalizedCurrent === value) continue
    const paramName = `p${paramIdx++}`
    req.input(paramName, meta.type(), value as never)
    setFragments.push(`${meta.column} = @${paramName}`)
    // Translate the DB-bound value back to its StoredServer shape so the
    // in-memory cache stays in sync without a full reload.
    if (isBitKey) {
      ;(appliedPatch as Record<string, unknown>)[key] = !!value
    } else if (value === null) {
      ;(appliedPatch as Record<string, unknown>)[key] = undefined
    } else {
      ;(appliedPatch as Record<string, unknown>)[key] = value
    }
  }
  if (setFragments.length === 0) return
  await req.query(`UPDATE dbo.servers SET ${setFragments.join(', ')} WHERE id = @id`)
  applyCachePatch(id, appliedPatch)
}

export async function remove(id: string): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .query(`DELETE FROM dbo.servers WHERE id = @id`)
  removeFromCache(id)
}

/**
 * Insert-or-update by host:port. Used when ADD_SERVER_MANUAL completes —
 * ensures the server is persisted without creating duplicates.
 */
export async function upsertByIpPort(params: unknown): Promise<StoredServer> {
  const filtered = pickAllowedFields(params)
  const normalized = normalizeServer(filtered as Partial<StoredServer>)
  const invalidReason = validateNewServer(normalized)
  if (invalidReason) throw new Error(invalidReason)

  const existing = _cacheByHostPort.get(cacheKey(normalized.host, normalized.port))
  if (existing) {
    const patch: Partial<StoredServer> = { ...normalized }
    if (patch.password) {
      patch.encryptedPassword = encrypt(patch.password)
      delete patch.password
    }
    await update(existing.id, patch)
    return withDecryptedPassword(_cacheById.get(existing.id)!)
  }

  const server: StoredServer = {
    ...normalized,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  if (server.password) {
    server.encryptedPassword = encrypt(server.password)
    delete server.password
  }
  if (server.remediationPassword) {
    server.remediationEncryptedPassword = encrypt(server.remediationPassword)
    delete server.remediationPassword
  }
  await insertRow(server)
  appendToCache(server)
  return withDecryptedPassword(server)
}

// ---------------------------------------------------------------------------
// Migrations — kept as exports for compat with the old serverStore callers.
// The legacy electron-store JSON file is no longer touched.
// ---------------------------------------------------------------------------

/** Legacy ip→host migration is now a no-op: the schema only has `host`. */
export function migrateHostField(): void {
  // intentionally empty — the SQL Server schema has no `ip` column
}

/**
 * Encrypt any legacy plaintext passwords stored before the safeStorage rollout.
 * Safe to call on every boot — no-op if everything is already encrypted.
 */
export async function migrateEncryptCredentials(): Promise<void> {
  try {
    if (!safeStorageAvailable()) return
    const cache = requireCache()
    // Use the safeStorage round-trip as the truth oracle: if decryption fails
    // the stored value is plaintext (or corrupted) and needs to be re-encrypted.
    // The previous "looks like base64" heuristic gave false negatives on
    // randomly-generated plaintext passwords.
    const toMigrate = cache.filter(
      (s) => s.encryptedPassword && !isEncrypted(s.encryptedPassword)
    )
    if (toMigrate.length === 0) return
    for (const s of toMigrate) {
      const reEncrypted = encrypt(s.encryptedPassword!)
      await getPool()
        .request()
        .input('id', sql.NVarChar(36), s.id)
        .input('enc', sql.NVarChar(sql.MAX), reEncrypted)
        .query(`UPDATE dbo.servers SET encrypted_password = @enc WHERE id = @id`)
    }
    await loadCache()
    log.info('[serverRepo] migrated', toMigrate.length, 'server(s) to encrypted credentials')
  } catch (err) {
    log.error('[serverRepo] migrateEncryptCredentials error:', err)
  }
}

// ---------------------------------------------------------------------------
// Backup / restore — JSON export/import sitting next to the storageConfig file.
// ---------------------------------------------------------------------------

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

function backupPath(): string {
  // Sit *next to* the per-user data dir (parent), matching the legacy
  // electron-store backup layout that operators already grep for. Falls back
  // to cwd when Electron's app helper isn't available (e.g. service process).
  const userData = app?.getPath?.('userData') ?? process.cwd()
  return join(dirname(userData), 'sql-sentinel-backup.json')
}

export function writeAutoBackup(): void {
  try {
    const cache = ensureCache()
    const payload: ServerBackupFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: cache.map(toBackupEntry)
    }
    writeFileSync(backupPath(), JSON.stringify(payload, null, 2), 'utf8')
  } catch (err) {
    log.error('[serverRepo] writeAutoBackup error:', err)
  }
}

export function exportForBackup(): string {
  const cache = ensureCache()
  const payload: ServerBackupFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    servers: cache.map(toBackupEntry)
  }
  return JSON.stringify(payload, null, 2)
}

export async function importFromBackup(json: string): Promise<ImportResult> {
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
      const addResult = await add(entry)
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

export function readAutoBackup(): string | null {
  try {
    return readFileSync(backupPath(), 'utf8')
  } catch {
    return null
  }
}
