import * as sql from 'mssql'
import { randomUUID } from 'node:crypto'
import { getPool } from './connection'
import type { ServerMetrics } from '../../collectors/types'
import type { MetricsSnapshot } from '../types'

export interface SaveItem {
  serverId: string
  metrics: ServerMetrics
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) return new Date(value)
  return value
}

interface SnapshotRow {
  id: string
  server_id: string
  collected_at: Date
  metrics_json: string
}

function rowToSnapshot(row: SnapshotRow): MetricsSnapshot {
  return {
    id: row.id,
    serverId: row.server_id,
    collectedAt: row.collected_at,
    metricsJson: row.metrics_json
  }
}

export async function save(serverId: string, metrics: ServerMetrics): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(36), randomUUID())
    .input('server_id', sql.NVarChar(36), serverId)
    .input('collected_at', sql.DateTime2, metrics.collectedAt)
    .input('metrics_json', sql.NVarChar(sql.MAX), JSON.stringify(metrics))
    .query(
      `INSERT INTO dbo.metrics_snapshots (id, server_id, collected_at, metrics_json) VALUES (@id, @server_id, @collected_at, @metrics_json)`
    )
}

export async function findLatest(serverId: string): Promise<ServerMetrics | null> {
  const pool = getPool()
  const r = await pool
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .query<SnapshotRow>(
      `SELECT TOP 1 id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id ORDER BY collected_at DESC`
    )
  if (!r.recordset[0]) return null
  return JSON.parse(r.recordset[0].metrics_json, dateReviver) as ServerMetrics
}

export async function findHistory(serverId: string, limitDays: number): Promise<MetricsSnapshot[]> {
  const pool = getPool()
  if (limitDays === 0) {
    const r = await pool
      .request()
      .input('server_id', sql.NVarChar(36), serverId)
      .query<SnapshotRow>(
        `SELECT id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id ORDER BY collected_at DESC`
      )
    return r.recordset.map(rowToSnapshot)
  }
  const r = await pool
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('days', sql.Int, Math.abs(limitDays))
    .query<SnapshotRow>(
      `SELECT id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id AND collected_at >= DATEADD(DAY, -@days, GETUTCDATE()) ORDER BY collected_at DESC`
    )
  return r.recordset.map(rowToSnapshot)
}

export async function cleanup(retentionDays: number): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('days', sql.Int, Math.abs(retentionDays))
    .query(
      `DELETE FROM dbo.metrics_snapshots WHERE collected_at < DATEADD(DAY, -@days, GETUTCDATE())`
    )
}

export async function findLastN(serverId: string, n: number): Promise<ServerMetrics[]> {
  const pool = getPool()
  const r = await pool
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('n', sql.Int, n)
    .query<SnapshotRow>(
      `SELECT TOP (@n) id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id ORDER BY collected_at DESC`
    )
  return r.recordset
    .reverse()
    .map((row) => JSON.parse(row.metrics_json, dateReviver) as ServerMetrics)
}

export async function findLastNBulk(
  serverIds: string[],
  n: number
): Promise<Record<string, ServerMetrics[]>> {
  if (serverIds.length === 0) return {}
  const pool = getPool()
  const r = await pool
    .request()
    .input('serverIds', sql.NVarChar(sql.MAX), serverIds.join(','))
    .input('n', sql.Int, n)
    .query<SnapshotRow>(`
      SELECT id, server_id, collected_at, metrics_json
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY collected_at DESC) AS rn
        FROM dbo.metrics_snapshots
        WHERE server_id IN (SELECT value FROM STRING_SPLIT(@serverIds, ','))
      ) ranked
      WHERE rn <= @n
      ORDER BY server_id, collected_at ASC`)
  const result: Record<string, ServerMetrics[]> = {}
  for (const row of r.recordset) {
    if (!result[row.server_id]) result[row.server_id] = []
    result[row.server_id].push(JSON.parse(row.metrics_json, dateReviver) as ServerMetrics)
  }
  return result
}

export async function batchSave(items: SaveItem[]): Promise<void> {
  if (items.length === 0) return
  const pool = getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    for (const item of items) {
      await new sql.Request(tx)
        .input('id', sql.NVarChar(36), randomUUID())
        .input('server_id', sql.NVarChar(36), item.serverId)
        .input('collected_at', sql.DateTime2, item.metrics.collectedAt)
        .input('metrics_json', sql.NVarChar(sql.MAX), JSON.stringify(item.metrics))
        .query(
          `INSERT INTO dbo.metrics_snapshots (id, server_id, collected_at, metrics_json) VALUES (@id, @server_id, @collected_at, @metrics_json)`
        )
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
