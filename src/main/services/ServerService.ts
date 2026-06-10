/**
 * ServerService — business logic for server management and metrics collection.
 *
 * IPC handlers in servers.ipc.ts are thin delegators; all non-trivial logic
 * lives here so it can be tested independently of the Electron IPC layer.
 */
import { scanHost } from '../discovery/tcpScanner'
import { collectMetrics, detectServerInfo } from '../collectors/sqlCollector'
import * as serverStore from '../store/sqlserver/serverRepository'
import type { StoredServer } from '../store/sqlserver/serverRepository'
import { getAllCustomFields } from '../store/sqlserver/dbCustomFieldsRepository'
import { resetAgent } from '../ai/langGraphAgent'
import type { DiscoveredServer } from '../discovery/types'
import type {
  CollectMetricsRequest,
  ManualServerRequest,
  RemoveServerRequest,
  ServerAddResult,
  ServerInfo
} from '../ipc/types'
import type { ServerMetrics } from '../collectors/types'
import { createLogger } from '../utils/logger'

const log = createLogger('server-service')

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the connection used for monitoring/admin flows.
 *
 * H1 hardening: for a server already registered in the store, the credentials,
 * auth mode and target are taken authoritatively from the store and the
 * renderer-supplied password/username/auth-mode are ignored. This prevents a
 * hijacked renderer from (a) re-pointing a known server's auth, or (b) using
 * the main process as a credentialed connection proxy / credential-spraying
 * oracle against arbitrary internal hosts.
 *
 * For an unregistered target (the add-server / test-connection wizard, where the
 * user is explicitly entering credentials for a host they want to register) the
 * renderer-supplied credentials are honoured — but the host/port are still
 * validated to keep the outbound surface narrow (no SSRF to malformed targets).
 */
export function resolveConnection(req: CollectMetricsRequest): CollectMetricsRequest {
  validateHostInput(req.ip, req.port)
  const stored = serverStore.getByIpPort(req.ip, req.port)
  if (stored) {
    return {
      ...req,
      useWindowsAuth: stored.useWindowsAuth,
      username: stored.username,
      password: stored.password
    }
  }
  return req
}

// ---------------------------------------------------------------------------
// Shape conversion
// ---------------------------------------------------------------------------

/** Convert StoredServer → DiscoveredServer shape for legacy callers */
export function toDiscovered(s: StoredServer): DiscoveredServer {
  return {
    ip: s.host,
    port: s.port,
    reachable: !s.unreachable,
    responseTimeMs: 0,
    discoveredAt: new Date(s.addedAt)
  }
}

// ---------------------------------------------------------------------------
// Server CRUD operations
// ---------------------------------------------------------------------------

/** Returns all persisted servers as DiscoveredServer shape (legacy callers). */
export function listServersLegacy(): DiscoveredServer[] {
  return serverStore.getAll().map(toDiscovered)
}

/** Returns all persisted servers stripped of credentials (C2). */
export function listServers(): StoredServer[] {
  return serverStore.getAllStripped()
}

// IPv4 dotted-quad. Hostname: RFC-1123 short-form (alnum + hyphens, 1-63 chars per label).
// We deliberately reject IPv6 and FQDNs with trailing dots to keep the surface narrow.
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function validateHostInput(host: string, port: number): void {
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) {
    throw new Error('Invalid host: must be a non-empty string up to 253 chars')
  }
  if (!IPV4_RE.test(host) && !HOSTNAME_RE.test(host)) {
    throw new Error(`Invalid host "${host}": expected IPv4 or DNS hostname`)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port ${port}: must be an integer 1-65535`)
  }
}

/** TCP-probes the given host:port and persists the server to the store. */
export async function addServerManual(req: ManualServerRequest): Promise<DiscoveredServer> {
  // Defence-in-depth: even with auth on the IPC channel, validate the user-
  // supplied target so we don't TCP-probe arbitrary internal endpoints
  // (cloud metadata, link-local SSRF targets, malformed strings).
  validateHostInput(req.ip, req.port)
  const probed = await scanHost(req.ip, req.port, 2000)
  // Persisti le credenziali del dialog: il precedente `useWindowsAuth: true`
  // fisso scartava utente/password appena testati e la successiva SERVERS_ADD
  // moriva sul duplicate — server registrato ma senza credenziali.
  await serverStore.upsertByIpPort({
    host: probed.ip,
    port: probed.port,
    instanceName: req.instanceName,
    useWindowsAuth: req.useWindowsAuth ?? true,
    username: req.username,
    password: req.password
  })
  return probed
}

/** Removes a server by ip:port (legacy, used by Discovery context menu). */
export async function removeServer(req: RemoveServerRequest): Promise<void> {
  const existing = serverStore.getByIpPort(req.ip, req.port)
  if (existing) await serverStore.remove(existing.id)
}

/** Adds a server by params; strips credentials from returned server (C2). */
export async function addServer(
  params: Omit<StoredServer, 'id' | 'addedAt'>
): Promise<ServerAddResult> {
  const result = await serverStore.add(params)
  if (result.server) result.server = serverStore.stripCredentials(result.server)
  return result
}

/** Updates a server by id and resets the AI agent (agent context may be stale). */
export async function updateServer(
  id: string,
  patch: Partial<StoredServer>
): Promise<{ success: boolean }> {
  await serverStore.update(id, patch)
  resetAgent()
  return { success: true }
}

/** Removes a server by UUID and resets the AI agent. */
export async function removeServerById(id: string): Promise<void> {
  await serverStore.remove(id)
  resetAgent()
}

/**
 * Removes all mock servers (ids starting with 'mock-').
 * Returns counts for diagnostic logging.
 */
export async function clearMockServers(): Promise<{ removed: number; remaining: number }> {
  // No need to decrypt passwords just to inspect ids — use stripped view
  const before = serverStore.getAllStripped()
  const mocks = before.filter((s) => s.id.startsWith('mock-'))
  for (const s of mocks) await serverStore.remove(s.id)
  const after = serverStore.getAllStripped()
  log.info(`[clearMocks] rimossi ${mocks.length} mock, rimasti: ${after.length}`)
  return { removed: mocks.length, remaining: after.length }
}

// ---------------------------------------------------------------------------
// Metrics collection
// ---------------------------------------------------------------------------

/** Detects server info (MachineName / InstanceName) after resolving credentials. */
export async function detectServer(req: CollectMetricsRequest): Promise<ServerInfo> {
  return detectServerInfo(resolveConnection(req))
}

/**
 * Collects metrics for a server and enriches database entries with custom
 * fields (alias, referente, etc.) stored in dbCustomFields.
 */
export async function collectMetricsWithCustomFields(
  req: CollectMetricsRequest
): Promise<ServerMetrics> {
  const metrics = await collectMetrics(resolveConnection(req))
  const sid = `${req.ip}:${req.port}`
  const allCf = await getAllCustomFields()
  return {
    ...metrics,
    databases: metrics.databases.map((db) => ({
      ...db,
      ...(allCf[`${sid}/${db.name}`] ?? {})
    }))
  }
}
