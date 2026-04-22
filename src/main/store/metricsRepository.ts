import { randomUUID } from 'node:crypto'
import { getDb } from './database'
import type { MetricsSnapshot } from './types'
import type { ServerMetrics } from '../collectors/types'
import type Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'

// --- Batch save item ---

export interface SaveItem {
  serverId: string
  metrics: ServerMetrics
}

// --- Reviver to deserialize dates from JSON ---

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
    return new Date(value)
  }
  return value
}

// --- Mapping riga SQLite ---

interface SnapshotRow {
  id: string
  server_id: string
  collected_at: string
  metrics_json: string
}

function rowToSnapshot(row: SnapshotRow): MetricsSnapshot {
  return {
    id: row.id,
    serverId: row.server_id,
    collectedAt: new Date(row.collected_at),
    metricsJson: row.metrics_json
  }
}

// --- Cached prepared statements ---

let _db: Database.Database | null = null
let _stmts: {
  insert: Statement<[string, string, string, string]>
  findLatest: Statement<[string], SnapshotRow>
  findHistoryAll: Statement<[string], SnapshotRow>
  findHistoryDays: Statement<[string, number], SnapshotRow>
  cleanup: Statement<[number]>
  findLastN: Statement<[string, number], SnapshotRow>
} | null = null

function stmts() {
  const db = getDb()
  if (_stmts && _db === db) return _stmts
  _db = db
  _stmts = {
    insert: db.prepare<[string, string, string, string]>(`
      INSERT INTO metrics_snapshots (id, server_id, collected_at, metrics_json)
      VALUES (?, ?, ?, ?)
    `),
    findLatest: db.prepare<[string], SnapshotRow>(`
      SELECT * FROM metrics_snapshots
      WHERE server_id = ?
      ORDER BY collected_at DESC
      LIMIT 1
    `),
    findHistoryAll: db.prepare<[string], SnapshotRow>(
      `SELECT * FROM metrics_snapshots WHERE server_id = ? ORDER BY collected_at DESC`
    ),
    findHistoryDays: db.prepare<[string, number], SnapshotRow>(`
      SELECT * FROM metrics_snapshots
      WHERE server_id = ?
        AND collected_at >= datetime('now', ? || ' days')
      ORDER BY collected_at DESC
    `),
    cleanup: db.prepare<[number]>(`
      DELETE FROM metrics_snapshots
      WHERE collected_at < datetime('now', ? || ' days')
    `),
    findLastN: db.prepare<[string, number], SnapshotRow>(`
      SELECT * FROM metrics_snapshots
      WHERE server_id = ?
      ORDER BY collected_at DESC
      LIMIT ?
    `)
  }
  return _stmts
}

// --- Repository ---

/**
 * Saves a new metrics snapshot for the specified server.
 */
export function save(serverId: string, metrics: ServerMetrics): void {
  stmts().insert.run(
    randomUUID(),
    serverId,
    metrics.collectedAt.toISOString(),
    JSON.stringify(metrics)
  )
}

/**
 * Returns the most recent ServerMetrics collected for the server, or null if absent.
 */
export function findLatest(serverId: string): ServerMetrics | null {
  const row = stmts().findLatest.get(serverId)

  if (!row) return null

  return JSON.parse(row.metrics_json, dateReviver) as ServerMetrics
}

/**
 * Returns all snapshots for the server within the last N days,
 * ordered from most recent to oldest.
 */
export function findHistory(serverId: string, limitDays: number): MetricsSnapshot[] {
  const days = Math.abs(limitDays)
  if (days === 0) {
    const rows = stmts().findHistoryAll.all(serverId)
    return rows.map(rowToSnapshot)
  }
  const rows = stmts().findHistoryDays.all(serverId, -days)

  return rows.map(rowToSnapshot)
}

/**
 * Deletes all snapshots older than retentionDays days.
 */
export function cleanup(retentionDays: number): void {
  stmts().cleanup.run(-retentionDays)
}

/**
 * Returns the last N snapshots for the server, ordered from oldest to most recent.
 */
export function findLastN(serverId: string, n: number): ServerMetrics[] {
  const rows = stmts().findLastN.all(serverId, n)
  return rows.reverse().map((row) => JSON.parse(row.metrics_json, dateReviver) as ServerMetrics)
}

/**
 * Returns the last N snapshots for each server in the list, in a single SQLite query.
 * Uses ROW_NUMBER() OVER (PARTITION BY server_id) — requires SQLite ≥ 3.25 (available
 * with better-sqlite3 on Node 18+).
 * More efficient than N separate findLastN() calls on startup with many servers.
 */
export function findLastNBulk(serverIds: string[], n: number): Record<string, ServerMetrics[]> {
  if (serverIds.length === 0) return {}
  const placeholders = serverIds.map(() => '?').join(',')
  const rows = getDb()
    .prepare<unknown[], SnapshotRow>(
      `
      SELECT id, server_id, collected_at, metrics_json
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY collected_at DESC) AS rn
        FROM metrics_snapshots
        WHERE server_id IN (${placeholders})
      ) AS ranked
      WHERE ranked.rn <= ?
      ORDER BY server_id, collected_at ASC
    `
    )
    .all(...serverIds, n)

  const result: Record<string, ServerMetrics[]> = {}
  for (const row of rows) {
    if (!result[row.server_id]) result[row.server_id] = []
    result[row.server_id].push(JSON.parse(row.metrics_json, dateReviver) as ServerMetrics)
  }
  return result
}

/**
 * Inserts multiple snapshots in a single SQLite transaction.
 */
export function batchSave(items: SaveItem[]): void {
  if (items.length === 0) return
  const db = getDb()
  const stmt = stmts().insert
  const insertAll = db.transaction((list: SaveItem[]) => {
    for (const item of list) {
      stmt.run(
        randomUUID(),
        item.serverId,
        item.metrics.collectedAt.toISOString(),
        JSON.stringify(item.metrics)
      )
    }
  })
  insertAll(items)
}
