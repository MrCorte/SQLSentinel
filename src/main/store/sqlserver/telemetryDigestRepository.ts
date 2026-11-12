import * as sql from 'mssql'
import { randomUUID } from 'node:crypto'
import { getPool } from './connection'
import type { ServerMetrics } from '../../collectors/types'
import type {
  BucketAggregates,
  DigestAlert,
  DigestIncident,
  TelemetryDigest,
  WaitDelta
} from '../../ai/telemetry/digest'

// Retention dei digest: più lunga dei raw snapshot di proposito — il rollup
// orario costa ~1 KB/server/ora e permette domande su settimane di storico
// anche quando i raw sono già stati purgati.
export const DIGEST_RETENTION_DAYS = 90

// Snapshot JSON letti per costruire un digest: campione uniforme + primo e
// ultimo (servono per il delta delle wait stats). Gli aggregati CPU/mem sono
// invece calcolati in SQL su tutte le righe dell'ora.
const SAMPLE_PER_BUCKET = 12

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) return new Date(value)
  return value
}

export interface PendingBucket extends BucketAggregates {
  bucketStart: Date
}

/**
 * Ore complete (con almeno uno snapshot) nell'intervallo [from, to) che non
 * hanno ancora un digest. Gli aggregati numerici vengono dalle colonne
 * tipizzate cpu_pct/mem_pct (migration 6): nessuna deserializzazione JSON.
 */
export async function findPendingBuckets(
  serverId: string,
  from: Date,
  to: Date
): Promise<PendingBucket[]> {
  const r = await getPool()
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('from', sql.DateTime2, from)
    .input('to', sql.DateTime2, to).query<{
    bucket_start: Date
    snapshot_count: number
    cpu_avg: number | null
    cpu_max: number | null
    mem_avg: number | null
  }>(`
      WITH b AS (
        SELECT DATEADD(HOUR, DATEDIFF(HOUR, 0, s.collected_at), 0) AS bucket_start,
               s.cpu_pct, s.mem_pct
          FROM dbo.metrics_snapshots s
         WHERE s.server_id = @server_id
           AND s.collected_at >= @from AND s.collected_at < @to
      )
      SELECT b.bucket_start,
             COUNT(*)                          AS snapshot_count,
             AVG(CAST(b.cpu_pct AS FLOAT))     AS cpu_avg,
             MAX(CAST(b.cpu_pct AS FLOAT))     AS cpu_max,
             AVG(CAST(b.mem_pct AS FLOAT))     AS mem_avg
        FROM b
       WHERE NOT EXISTS (SELECT 1 FROM dbo.telemetry_digests d
                          WHERE d.server_id = @server_id AND d.bucket_start = b.bucket_start)
       GROUP BY b.bucket_start
       ORDER BY b.bucket_start`)
  return r.recordset.map((row) => ({
    bucketStart: row.bucket_start,
    snapshotCount: row.snapshot_count,
    cpuAvg: row.cpu_avg,
    cpuMax: row.cpu_max,
    memPctAvg: row.mem_avg
  }))
}

/** Campione uniforme di snapshot dell'ora, in ordine cronologico (primo e ultimo inclusi). */
export async function loadBucketSnapshots(
  serverId: string,
  start: Date,
  end: Date
): Promise<ServerMetrics[]> {
  const r = await getPool()
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('start', sql.DateTime2, start)
    .input('end', sql.DateTime2, end)
    .input('k', sql.Int, SAMPLE_PER_BUCKET).query<{ metrics_json: string }>(`
      WITH x AS (
        SELECT metrics_json, collected_at,
               ROW_NUMBER() OVER (ORDER BY collected_at) AS rn,
               COUNT(*)     OVER ()                      AS cnt
          FROM dbo.metrics_snapshots
         WHERE server_id = @server_id AND collected_at >= @start AND collected_at < @end
      )
      SELECT metrics_json FROM x
       WHERE rn = 1 OR rn = cnt OR (rn - 1) % CAST(CEILING(cnt * 1.0 / @k) AS INT) = 0
       ORDER BY collected_at`)
  const out: ServerMetrics[] = []
  for (const row of r.recordset) {
    try {
      out.push(JSON.parse(row.metrics_json, dateReviver) as ServerMetrics)
    } catch {
      /* snapshot corrotto: lo saltiamo */
    }
  }
  return out
}

/** Alert dell'ora. dbo.alerts usa la chiave "host:port" del worker, non l'UUID. */
export async function loadBucketAlerts(
  alertKeys: string[],
  start: Date,
  end: Date
): Promise<DigestAlert[]> {
  const keys = alertKeys.slice(0, 4)
  if (keys.length === 0) return []
  const req = getPool()
    .request()
    .input('start', sql.DateTime2, start)
    .input('end', sql.DateTime2, end)
  keys.forEach((k, i) => req.input(`k${i}`, sql.NVarChar(260), k))
  const r = await req.query<DigestAlert>(`
    SELECT TOP 20 severity, category, message
      FROM dbo.alerts
     WHERE server_id IN (${keys.map((_, i) => `@k${i}`).join(', ')})
       AND detected_at >= @start AND detected_at < @end
     ORDER BY detected_at`)
  return r.recordset
}

export async function loadBucketIncidents(
  serverId: string,
  start: Date,
  end: Date
): Promise<DigestIncident[]> {
  const r = await getPool()
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('start_ms', sql.BigInt, start.getTime())
    .input('end_ms', sql.BigInt, end.getTime()).query<{
    category: string
    severity: string
    summary: string | null
    root_cause_md: string | null
  }>(`
      SELECT TOP 5 category, severity, summary, root_cause_md
        FROM dbo.incidents
       WHERE server_id = @server_id AND opened_at >= @start_ms AND opened_at < @end_ms
       ORDER BY opened_at`)
  return r.recordset.map((x) => ({
    category: x.category,
    severity: x.severity,
    summary: x.summary,
    rootCause: x.root_cause_md
  }))
}

export interface BaselineRow {
  bucketStart: Date
  cpuAvg: number | null
  blockingMax: number
  topWaits: WaitDelta[]
}

/** Digest dei 7 giorni precedenti al bucket, per calcolare la baseline del server. */
export async function loadBaselineHistory(serverId: string, before: Date): Promise<BaselineRow[]> {
  const r = await getPool()
    .request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('before', sql.DateTime2, before).query<{
    bucket_start: Date
    cpu_avg: number | null
    blocking_max: number
    top_waits_json: string
  }>(`
      SELECT bucket_start, cpu_avg, blocking_max, top_waits_json
        FROM dbo.telemetry_digests
       WHERE server_id = @server_id
         AND bucket_start >= DATEADD(DAY, -7, @before) AND bucket_start < @before`)
  return r.recordset.map((x) => ({
    bucketStart: x.bucket_start,
    cpuAvg: x.cpu_avg == null ? null : Number(x.cpu_avg),
    blockingMax: x.blocking_max,
    topWaits: parseJson<WaitDelta[]>(x.top_waits_json, [])
  }))
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function clampPct(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  return Math.max(0, Math.min(999.9, Math.round(v * 10) / 10))
}

export async function insertDigest(d: TelemetryDigest, embedding: Buffer | null): Promise<string> {
  const id = randomUUID()
  const f = d.features
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('server_id', sql.NVarChar(36), d.serverId)
    .input('bucket_start', sql.DateTime2, d.bucketStart)
    .input('bucket_end', sql.DateTime2, d.bucketEnd)
    .input('snapshot_count', sql.Int, f.snapshotCount)
    .input('cpu_avg', sql.Decimal(5, 1), clampPct(f.cpuAvg))
    .input('cpu_max', sql.Decimal(5, 1), clampPct(f.cpuMax))
    .input('mem_pct_avg', sql.Decimal(5, 1), clampPct(f.memPctAvg))
    .input('blocking_max', sql.Int, f.blockingMax)
    .input('longest_block_ms', sql.BigInt, f.longestBlockedWaitMs)
    .input('disk_min_free_pct', sql.Decimal(5, 1), clampPct(f.diskMinFreePct))
    .input('offline_db_count', sql.Int, f.offlineDbs.length)
    .input('alert_count', sql.Int, f.alertCount)
    .input('critical_alerts', sql.Int, f.criticalAlerts)
    .input('incident_count', sql.Int, f.incidentCount)
    .input('restart_detected', sql.Bit, f.restartDetected)
    .input('top_waits_json', sql.NVarChar(sql.MAX), JSON.stringify(f.topWaits))
    .input('anomaly_flags', sql.NVarChar(400), d.anomalyFlags.join(','))
    .input('anomaly_score', sql.Int, d.anomalyScore)
    .input('digest_text', sql.NVarChar(sql.MAX), d.text)
    .input('embedding', sql.VarBinary(sql.MAX), embedding).query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.telemetry_digests WITH (UPDLOCK, HOLDLOCK)
                      WHERE server_id = @server_id AND bucket_start = @bucket_start)
      INSERT INTO dbo.telemetry_digests
        (id, server_id, bucket_start, bucket_end, snapshot_count, cpu_avg, cpu_max, mem_pct_avg,
         blocking_max, longest_block_ms, disk_min_free_pct, offline_db_count, alert_count,
         critical_alerts, incident_count, restart_detected, top_waits_json, anomaly_flags,
         anomaly_score, digest_text, embedding)
      VALUES
        (@id, @server_id, @bucket_start, @bucket_end, @snapshot_count, @cpu_avg, @cpu_max, @mem_pct_avg,
         @blocking_max, @longest_block_ms, @disk_min_free_pct, @offline_db_count, @alert_count,
         @critical_alerts, @incident_count, @restart_detected, @top_waits_json, @anomaly_flags,
         @anomaly_score, @digest_text, @embedding)`)
  return id
}

export interface StoredDigest {
  id: string
  serverId: string
  bucketStart: Date
  bucketEnd: Date
  cpuAvg: number | null
  cpuMax: number | null
  blockingMax: number
  anomalyScore: number
  anomalyFlags: string[]
  text: string
}

interface DigestRow {
  id: string
  server_id: string
  bucket_start: Date
  bucket_end: Date
  cpu_avg: number | null
  cpu_max: number | null
  blocking_max: number
  anomaly_score: number
  anomaly_flags: string
  digest_text: string
}

function rowToDigest(r: DigestRow): StoredDigest {
  return {
    id: r.id,
    serverId: r.server_id,
    bucketStart: r.bucket_start,
    bucketEnd: r.bucket_end,
    cpuAvg: r.cpu_avg == null ? null : Number(r.cpu_avg),
    cpuMax: r.cpu_max == null ? null : Number(r.cpu_max),
    blockingMax: r.blocking_max,
    anomalyScore: r.anomaly_score,
    anomalyFlags: r.anomaly_flags ? r.anomaly_flags.split(',').filter(Boolean) : [],
    text: r.digest_text
  }
}

const DIGEST_COLS = `id, server_id, bucket_start, bucket_end, cpu_avg, cpu_max, blocking_max,
                     anomaly_score, anomaly_flags, digest_text`

/**
 * Digest che si sovrappongono alla finestra. serverId null = tutta la fleet.
 * Ordinati per anomalia (i più rilevanti per primi), poi cronologicamente.
 */
export async function listDigestsInWindow(
  serverId: string | null,
  from: Date,
  to: Date,
  limit: number
): Promise<StoredDigest[]> {
  const req = getPool()
    .request()
    .input('from', sql.DateTime2, from)
    .input('to', sql.DateTime2, to)
    .input('limit', sql.Int, Math.max(1, Math.min(500, limit)))
  if (serverId) req.input('server_id', sql.NVarChar(36), serverId)
  const r = await req.query<DigestRow>(`
    SELECT TOP (@limit) ${DIGEST_COLS}
      FROM dbo.telemetry_digests
     WHERE bucket_end > @from AND bucket_start < @to
       ${serverId ? 'AND server_id = @server_id' : ''}
     ORDER BY anomaly_score DESC, bucket_start DESC`)
  return r.recordset.map(rowToDigest)
}

export interface AnomalousDigestWithEmbedding extends StoredDigest {
  embedding: Buffer
}

/** Episodi anomali con embedding (per la ricerca "è già successo?"). */
export async function listAnomalousWithEmbedding(
  minScore: number,
  limit: number
): Promise<AnomalousDigestWithEmbedding[]> {
  const r = await getPool()
    .request()
    .input('min_score', sql.Int, minScore)
    .input('limit', sql.Int, limit).query<DigestRow & { embedding: Buffer }>(`
      SELECT TOP (@limit) ${DIGEST_COLS}, embedding
        FROM dbo.telemetry_digests
       WHERE anomaly_score >= @min_score AND embedding IS NOT NULL
       ORDER BY bucket_start DESC`)
  return r.recordset.map((row) => ({ ...rowToDigest(row), embedding: row.embedding }))
}

export async function purgeOldDigests(days = DIGEST_RETENTION_DAYS): Promise<number> {
  const r = await getPool().request().input('days', sql.Int, days).query<{ deleted: number }>(`
      DECLARE @deleted INT = 0, @n INT = 1;
      WHILE @n > 0
      BEGIN
        DELETE TOP (5000) FROM dbo.telemetry_digests
         WHERE bucket_start < DATEADD(DAY, -@days, SYSUTCDATETIME());
        SET @n = @@ROWCOUNT;
        SET @deleted += @n;
      END
      SELECT @deleted AS deleted;`)
  return r.recordset[0]?.deleted ?? 0
}
