import * as sql from 'mssql'
import { getPool } from './connection'
import type { Alert } from '../../ipc/types'
import { createLogger } from '../../utils/logger'

const log = createLogger('alerts-repo')

/**
 * Persistenza degli alert del worker in-process. Prima vivevano solo in
 * memoria: un riavvio dell'app perdeva gli alert aperti (badge azzerati,
 * dedup ricominciata, ricorrenze ri-notificate da zero).
 *
 * Scritture fire-and-forget dal worker (il polling non deve mai bloccarsi
 * sullo storage); lettura una volta al boot per ricostruire lo stato.
 */

interface AlertRow {
  id: string
  server_id: string
  category: string
  severity: string
  message: string
  suggestion: string | null
  dedup_tag: string | null
  detected_at: Date
  acknowledged_at: Date | null
}

function rowToAlert(r: AlertRow): Alert {
  return {
    id: r.id,
    serverId: r.server_id,
    category: r.category as Alert['category'],
    severity: r.severity as Alert['severity'],
    message: r.message,
    suggestion: r.suggestion ?? undefined,
    dedupTag: r.dedup_tag ?? undefined,
    detectedAt: r.detected_at,
    acknowledgedAt: r.acknowledged_at
  }
}

/** Alert recenti (aperti + acknowledged nelle ultime 24h, come la finestra di prune del worker). */
export async function loadRecent(): Promise<Alert[]> {
  const r = await getPool().request().query<AlertRow>(`
    SELECT id, server_id, category, severity, message, suggestion, dedup_tag, detected_at, acknowledged_at
    FROM dbo.alerts
    WHERE acknowledged_at IS NULL
       OR acknowledged_at >= DATEADD(HOUR, -24, GETUTCDATE())
    ORDER BY detected_at ASC`)
  return r.recordset.map(rowToAlert)
}

export async function insert(a: Alert): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(80), a.id)
    .input('server_id', sql.NVarChar(260), a.serverId)
    .input('category', sql.NVarChar(50), a.category)
    .input('severity', sql.NVarChar(20), a.severity)
    .input('message', sql.NVarChar(2000), a.message)
    .input('suggestion', sql.NVarChar(sql.MAX), a.suggestion ?? null)
    .input('dedup_tag', sql.NVarChar(100), a.dedupTag ?? null)
    .input('detected_at', sql.DateTime2, a.detectedAt)
    .input('acknowledged_at', sql.DateTime2, a.acknowledgedAt).query(`
      INSERT INTO dbo.alerts (id, server_id, category, severity, message, suggestion, dedup_tag, detected_at, acknowledged_at)
      VALUES (@id, @server_id, @category, @severity, @message, @suggestion, @dedup_tag, @detected_at, @acknowledged_at)`)
}

export async function acknowledge(ids: string[], when: Date): Promise<void> {
  if (ids.length === 0) return
  // Gli id alert sono generati dal worker ("alert-<ts>-<n>") — parametrizzati uno a uno.
  const req = getPool().request().input('when', sql.DateTime2, when)
  const params = ids.map((id, i) => {
    req.input(`id${i}`, sql.NVarChar(80), id)
    return `@id${i}`
  })
  await req.query(
    `UPDATE dbo.alerts SET acknowledged_at = @when
     WHERE acknowledged_at IS NULL AND id IN (${params.join(', ')})`
  )
}

/** Allineato al prune del worker: via gli acknowledged più vecchi di 24h. */
export async function pruneAcknowledged(): Promise<void> {
  await getPool().request().query(
    `DELETE FROM dbo.alerts WHERE acknowledged_at IS NOT NULL AND acknowledged_at < DATEADD(HOUR, -24, GETUTCDATE())`
  )
}

/** Wrapper fire-and-forget: il polling non deve mai attendere o fallire per lo storage. */
export function tryInsert(a: Alert): void {
  void insert(a).catch((err) => log.warn('[alerts] insert failed:', err))
}

export function tryAcknowledge(ids: string[], when: Date): void {
  void acknowledge(ids, when).catch((err) => log.warn('[alerts] acknowledge failed:', err))
}

export function tryPrune(): void {
  void pruneAcknowledged().catch((err) => log.warn('[alerts] prune failed:', err))
}
