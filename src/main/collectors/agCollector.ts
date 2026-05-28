import { createLogger } from '../utils/logger'
const log = createLogger('ag-collector')
import type { CollectMetricsRequest } from '../ipc/types'
import type {
  AvailabilityGroup,
  AvailabilityReplica,
  AvailabilityDatabase,
  ServerConnection
} from './types'
import * as serverStore from '../store/sqlserver/serverRepository'
import { sanitizeSqlError } from './sqlCollector'
import { getPool, invalidatePool } from './connectionPool'

// Same shape as ServerConnection — reuse the pool cache instead of opening
// fresh tedious sessions every AG poll.
function asServerConnection(conn: CollectMetricsRequest): ServerConnection {
  return {
    ip: conn.ip,
    port: conn.port,
    instanceName: conn.instanceName,
    useWindowsAuth: conn.useWindowsAuth,
    username: conn.username,
    password: conn.password,
    encrypt: conn.encrypt,
    trustServerCertificate: conn.trustServerCertificate
  }
}

// ---------------------------------------------------------------------------
// Connection helper — AG queries always run against master
// ---------------------------------------------------------------------------

// Connection pooling is delegated to connectionPool.getPool — config is built
// there. No local buildConfig needed.

// ---------------------------------------------------------------------------
// getAvailabilityGroups
// ---------------------------------------------------------------------------

export async function getAvailabilityGroups(
  conn: CollectMetricsRequest
): Promise<AvailabilityGroup[]> {
  const sc = asServerConnection(conn)
  try {
    const pool = await getPool(sc)
    const result = await pool.request().query<AvailabilityGroup>(`
      SELECT
        CAST(ag.group_id AS nvarchar(36))       AS group_id,
        ag.name                                  AS ag_name,
        ag.failure_condition_level,
        ag.health_check_timeout,
        ISNULL(ags.primary_replica, '')          AS primary_replica,
        ISNULL(ags.synchronization_health_desc, 'NOT_HEALTHY') AS ag_health
      FROM sys.availability_groups ag
      LEFT JOIN sys.dm_hadr_availability_group_states ags
        ON ag.group_id = ags.group_id
    `)
    return result.recordset
  } catch (err) {
    invalidatePool(sc)
    throw err
  }
}

// ---------------------------------------------------------------------------
// getAvailabilityReplicas
// ---------------------------------------------------------------------------

export async function getAvailabilityReplicas(
  conn: CollectMetricsRequest
): Promise<AvailabilityReplica[]> {
  const sc = asServerConnection(conn)
  try {
    const pool = await getPool(sc)
    const result = await pool.request().query<AvailabilityReplica>(`
      SELECT
        CAST(ar.replica_id AS nvarchar(36))                         AS replica_id,
        ag.name                                                      AS ag_name,
        CAST(ag.group_id AS nvarchar(36))                           AS group_id,
        ar.replica_server_name,
        ar.availability_mode_desc,
        ar.failover_mode_desc,
        ISNULL(ar.endpoint_url, '')                                  AS endpoint_url,
        ISNULL(ars.role_desc, 'RESOLVING')                           AS role_desc,
        ISNULL(ars.synchronization_health_desc, 'NOT_HEALTHY')       AS synchronization_health_desc,
        ISNULL(ars.connected_state_desc, 'DISCONNECTED')             AS connected_state_desc,
        ISNULL(ars.operational_state_desc, '')                       AS operational_state_desc,
        ISNULL(ars.recovery_health_desc, '')                         AS recovery_health_desc
      FROM sys.availability_groups ag
      JOIN sys.availability_replicas ar
        ON ag.group_id = ar.group_id
      LEFT JOIN sys.dm_hadr_availability_replica_states ars
        ON ar.replica_id = ars.replica_id
    `)
    return result.recordset
  } catch (err) {
    invalidatePool(sc)
    throw err
  }
}

// ---------------------------------------------------------------------------
// detectAndSyncReplicaRoles
// ---------------------------------------------------------------------------

/**
 * Called by the worker after each successful poll.
 * Queries sys.availability_replicas on the current server, then for each
 * replica found it looks up the corresponding server in electron-store and updates
 * agGroupId + agName + agRole.
 *
 * Returns the array of StoredServer records that were actually modified (for the push
 * to the renderer via SERVER_CONFIG_UPDATED).
 * Does not throw — a server not in an AG returns [].
 */
export async function detectAndSyncReplicaRoles(
  conn: CollectMetricsRequest
): Promise<serverStore.StoredServer[]> {
  const sc = asServerConnection(conn)
  let replicas: Array<{ agName: string; groupId: string; replicaHost: string; agRole: string }> = []
  try {
    const pool = await getPool(sc)
    const result = await pool.request().query<{
      agName: string
      groupId: string
      replicaHost: string
      agRole: string
    }>(`
      SELECT
        ag.name                        AS agName,
        CAST(ag.group_id AS nvarchar(36)) AS groupId,
        ar.replica_server_name         AS replicaHost,
        ISNULL(ars.role_desc, 'RESOLVING') AS agRole
      FROM sys.availability_groups ag
      JOIN sys.availability_replicas ar
        ON ag.group_id = ar.group_id
      LEFT JOIN sys.dm_hadr_availability_replica_states ars
        ON ar.replica_id = ars.replica_id
    `)
    replicas = result.recordset
  } catch (err) {
    invalidatePool(sc)
    log.warn('[agCollector] detectAndSyncReplicaRoles failed:', sanitizeSqlError(err))
    return []
  }

  if (replicas.length === 0) return []

  // Use the stripped variant — AG sync only needs id/host/agRole, no
  // credentials. The previous getAll() decrypted every server's password via
  // DPAPI: with 50 AG groups × 5 replicas × 200 servers that's 50,000 DPAPI
  // calls per detect cycle. Now: 0.
  const allServers = serverStore.getAllStripped()
  const updated: serverStore.StoredServer[] = []

  // Build a host→server lookup once. Three-tier index:
  //  1. exact host match (lowercased)
  //  2. machineName match — handles Docker/localhost where host='localhost' but
  //     machineName='nodo1' matches the AG replica_server_name
  //  3. substring fallback for legacy entries where host has FQDN suffix
  // Avoids the previous O(N) .find() inside the replica loop.
  const byExactHost = new Map<string, serverStore.StoredServer>()
  const byMachineName = new Map<string, serverStore.StoredServer>()
  for (const s of allServers) {
    byExactHost.set((s.host ?? '').toLowerCase(), s)
    if (s.machineName) byMachineName.set(s.machineName.toLowerCase(), s)
  }

  for (const replica of replicas) {
    // Hostname matching: strip instance suffix, compare case-insensitive
    const replicaBase = replica.replicaHost.split('\\')[0].toLowerCase()
    let match = byExactHost.get(replicaBase)
    if (!match) match = byMachineName.get(replicaBase)
    if (!match) {
      // Substring fallback (rare path) — only walks the array when exact miss.
      match = allServers.find((s) => {
        const addr = (s.host ?? '').toLowerCase()
        return addr.includes(replicaBase) || replicaBase.includes(addr)
      })
    }
    if (!match) continue

    const agRole = replica.agRole as 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
    const patch = {
      agGroupId: replica.groupId,
      agName: replica.agName,
      agRole
    }

    // Only write if something actually changed — avoid useless electron-store writes
    if (
      match.agGroupId !== patch.agGroupId ||
      match.agName !== patch.agName ||
      match.agRole !== patch.agRole
    ) {
      await serverStore.update(match.id, patch)
      updated.push({ ...match, ...patch })
    }
  }

  return updated
}

// ---------------------------------------------------------------------------
// getAvailabilityDatabases
// ---------------------------------------------------------------------------

export async function getAvailabilityDatabases(
  conn: CollectMetricsRequest
): Promise<AvailabilityDatabase[]> {
  const sc = asServerConnection(conn)
  try {
    const pool = await getPool(sc)
    const result = await pool.request().query<{
      ag_name: string
      database_name: string
      synchronization_state_desc: string
      synchronization_health_desc: string
      is_suspended: boolean
      suspend_reason_desc: string | null
      log_send_queue_kb: number
      redo_queue_kb: number
      log_send_rate_kb: number
      redo_rate_kb: number
      last_commit_time: Date | null
    }>(`
      SELECT
        ag.name                                                            AS ag_name,
        db.name                                                            AS database_name,
        ISNULL(drs.synchronization_state_desc, 'NOT_SYNCHRONIZING')       AS synchronization_state_desc,
        ISNULL(drs.synchronization_health_desc, 'NOT_HEALTHY')            AS synchronization_health_desc,
        ISNULL(drs.is_suspended, 0)                                       AS is_suspended,
        drs.suspend_reason_desc,
        ISNULL(drs.log_send_queue_size, 0)                                AS log_send_queue_kb,
        ISNULL(drs.redo_queue_size, 0)                                    AS redo_queue_kb,
        ISNULL(drs.log_send_rate, 0)                                      AS log_send_rate_kb,
        ISNULL(drs.redo_rate, 0)                                          AS redo_rate_kb,
        drs.last_commit_time
      FROM sys.availability_groups ag
      JOIN sys.availability_replicas ar
        ON ag.group_id = ar.group_id
      JOIN sys.dm_hadr_database_replica_states drs
        ON ar.replica_id = drs.replica_id
      JOIN sys.databases db
        ON drs.database_id = db.database_id
      WHERE drs.is_local = 1
    `)
    return result.recordset.map((r) => ({
      ...r,
      is_suspended: Boolean(r.is_suspended),
      last_commit_time: r.last_commit_time ? r.last_commit_time.toISOString() : null
    })) as AvailabilityDatabase[]
  } catch (err) {
    invalidatePool(sc)
    throw err
  }
}
