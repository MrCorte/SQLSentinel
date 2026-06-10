import * as sql from 'mssql'
import { randomUUID } from 'node:crypto'
import { getPool } from './connection'
import type { ServerMetrics } from '../../collectors/types'
import type { MetricsSnapshot } from '../types'

export interface SaveItem {
  serverId: string
  metrics: ServerMetrics
}

// Strict ISO 8601 with timezone: required to be a full timestamp ending in Z or
// ±HH:MM. Prevents user data resembling a partial timestamp from being silently
// coerced into a Date object.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
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

// Hard cap on rows returned by a single history read. Each row carries a full
// metrics_json blob (several KB), so an uncapped pull on a long retention window
// (e.g. 90 days × 288 snapshots/day ≈ 26k rows) could transfer 100+ MB. Charts
// can't render that many points anyway, so we always return the most recent N.
const MAX_HISTORY_ROWS = 10000

/** Returns snapshots in CHRONOLOGICAL order (oldest first), like findLastN.
 * The query selects DESC only to apply TOP to the most recent rows. */
export async function findHistory(serverId: string, limitDays: number): Promise<MetricsSnapshot[]> {
  const pool = getPool()
  if (limitDays === 0) {
    const r = await pool
      .request()
      .input('server_id', sql.NVarChar(36), serverId)
      .query<SnapshotRow>(
        `SELECT TOP ${MAX_HISTORY_ROWS} id, server_id, collected_at, metrics_json
       FROM dbo.metrics_snapshots
       WHERE server_id = @server_id
       ORDER BY collected_at DESC`
      )
    return r.recordset.reverse().map(rowToSnapshot)
  }
  const r = await pool
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('days', sql.Int, Math.abs(limitDays))
    .query<SnapshotRow>(
      `SELECT TOP ${MAX_HISTORY_ROWS} id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id AND collected_at >= DATEADD(DAY, -@days, GETUTCDATE()) ORDER BY collected_at DESC`
    )
  return r.recordset.reverse().map(rowToSnapshot)
}

// Batched purge: a single DELETE on millions of rows can lock the table for
// 5-30s and pile up log writes. We loop in batches of 5000 with a tiny pause
// between batches so concurrent metric inserts can interleave.
const PURGE_BATCH_SIZE = 5000
const PURGE_BATCH_PAUSE_MS = 50
const PURGE_MAX_BATCHES = 200 // safety cap = up to 1M rows per cleanup run

export async function cleanup(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return
  const pool = getPool()
  let batches = 0
  while (batches < PURGE_MAX_BATCHES) {
    const r = await pool
      .request()
      .input('days', sql.Int, retentionDays)
      .input('batch', sql.Int, PURGE_BATCH_SIZE)
      .query<{ rows: number }>(
        `DELETE TOP (@batch) FROM dbo.metrics_snapshots
         WHERE collected_at < DATEADD(DAY, -@days, GETUTCDATE());
         SELECT @@ROWCOUNT AS rows;`
      )
    const rows = r.recordset?.[0]?.rows ?? 0
    batches++
    if (rows < PURGE_BATCH_SIZE) break
    await new Promise<void>((resolve) => setTimeout(resolve, PURGE_BATCH_PAUSE_MS))
  }
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function findLastNBulk(
  serverIds: string[],
  n: number
): Promise<Record<string, ServerMetrics[]>> {
  if (serverIds.length === 0) return {}
  const safe = serverIds.filter((id) => UUID_RE.test(id))
  if (safe.length === 0) return {}
  const pool = getPool()
  const r = await pool
    .request()
    .input('serverIds', sql.NVarChar(sql.MAX), safe.join(','))
    .input('n', sql.Int, n).query<SnapshotRow>(`
      SELECT id, server_id, collected_at, metrics_json
      FROM (
        SELECT id, server_id, collected_at, metrics_json,
               ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY collected_at DESC) AS rn
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

// Single multi-row INSERT — chunked to stay under SQL Server's 2100-param cap.
// At 4 params/row, 500 rows/chunk leaves headroom for any future column additions.
const BATCH_CHUNK_SIZE = 500

async function insertChunk(chunk: SaveItem[]): Promise<void> {
  const pool = getPool()
  const rows = chunk.map((_, i) => `(@id${i}, @sid${i}, @cat${i}, @json${i})`).join(', ')
  const req = pool.request()
  for (let i = 0; i < chunk.length; i++) {
    req
      .input(`id${i}`, sql.NVarChar(36), randomUUID())
      .input(`sid${i}`, sql.NVarChar(36), chunk[i].serverId)
      .input(`cat${i}`, sql.DateTime2, chunk[i].metrics.collectedAt)
      .input(`json${i}`, sql.NVarChar(sql.MAX), JSON.stringify(chunk[i].metrics))
  }
  await req.query(
    `INSERT INTO dbo.metrics_snapshots (id, server_id, collected_at, metrics_json) VALUES ${rows}`
  )
}

export async function batchSave(items: SaveItem[]): Promise<void> {
  if (items.length === 0) return
  for (let i = 0; i < items.length; i += BATCH_CHUNK_SIZE) {
    await insertChunk(items.slice(i, i + BATCH_CHUNK_SIZE))
  }
}
