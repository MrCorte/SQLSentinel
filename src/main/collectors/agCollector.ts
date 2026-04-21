import * as mssql from 'mssql'
import { createLogger } from '../utils/logger'
const log = createLogger('ag-collector')
import type { CollectMetricsRequest } from '../ipc/types'
import type { AvailabilityGroup, AvailabilityReplica, AvailabilityDatabase } from './types'
import * as serverStore from '../store/serverStore'
import { sanitizeSqlError } from './sqlCollector'

// ---------------------------------------------------------------------------
// Connection helper — AG queries always run against master
// ---------------------------------------------------------------------------

function buildConfig(conn: CollectMetricsRequest): mssql.config {
  const base: mssql.config = {
    server: conn.ip,
    port: conn.port,
    database: 'master',
    requestTimeout: 15_000,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 10_000
    }
  }

  if (conn.useWindowsAuth) {
    return {
      ...base,
      authentication: {
        type: 'ntlm',
        options: { domain: '', userName: '', password: '' }
      }
    }
  }

  return {
    ...base,
    authentication: {
      type: 'default',
      options: {
        userName: conn.username ?? '',
        password: conn.password ?? ''
      }
    }
  }
}

// ---------------------------------------------------------------------------
// getAvailabilityGroups
// ---------------------------------------------------------------------------

export async function getAvailabilityGroups(
  conn: CollectMetricsRequest
): Promise<AvailabilityGroup[]> {
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(buildConfig(conn))
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
  } finally {
    await pool?.close().catch((err: Error) => log.error('[agCollector] pool close:', sanitizeSqlError(err)))
  }
}

// ---------------------------------------------------------------------------
// getAvailabilityReplicas
// ---------------------------------------------------------------------------

export async function getAvailabilityReplicas(
  conn: CollectMetricsRequest
): Promise<AvailabilityReplica[]> {
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(buildConfig(conn))
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
  } finally {
    await pool?.close().catch((err: Error) => log.error('[agCollector] pool close:', sanitizeSqlError(err)))
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
  let pool: mssql.ConnectionPool | null = null
  let replicas: Array<{ agName: string; groupId: string; replicaHost: string; agRole: string }> = []
  try {
    pool = await mssql.connect(buildConfig(conn))
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
  } finally {
    await pool?.close().catch((err: Error) => log.error('[agCollector] pool close:', sanitizeSqlError(err)))
  }

  if (replicas.length === 0) return []

  const allServers = serverStore.getAll()
  const updated: serverStore.StoredServer[] = []

  for (const replica of replicas) {
    // Hostname matching: strip instance suffix, compare case-insensitive
    const replicaBase = replica.replicaHost.split('\\')[0].toLowerCase()
    const match = allServers.find((s) => {
      const addr = (s.host ?? '').toLowerCase()
      return addr === replicaBase || addr.includes(replicaBase)
    })
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
      match.agName    !== patch.agName    ||
      match.agRole    !== patch.agRole
    ) {
      serverStore.update(match.id, patch)
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
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(buildConfig(conn))
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
  } finally {
    await pool?.close().catch((err: Error) => log.error('[agCollector] pool close:', sanitizeSqlError(err)))
  }
}
