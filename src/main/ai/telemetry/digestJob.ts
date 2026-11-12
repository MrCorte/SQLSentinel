import { createLogger } from '../../utils/logger'
import { safeError } from '../../utils/safeLog'
import * as serverStore from '../../store/sqlserver/serverRepository'
import {
  findPendingBuckets,
  loadBucketSnapshots,
  loadBucketAlerts,
  loadBucketIncidents,
  loadBaselineHistory,
  insertDigest,
  purgeOldDigests
} from '../../store/sqlserver/telemetryDigestRepository'
import { buildDigest, computeBaseline } from './digest'
import { embedDocument, packEmbedding } from '../embedder'
import { onDigestInserted } from './telemetryRetrieval'

const log = createLogger('telemetryDigest')

const HOUR = 3_600_000
const RUN_EVERY_MS = 10 * 60_000
const BACKFILL_DAYS = 7
// Cap per esecuzione: al primo avvio con 7 giorni × N server di storico il
// backfill si spalma su più giri invece di martellare lo storage in un colpo.
const MAX_BUCKETS_PER_RUN = 120
const PAUSE_BETWEEN_BUCKETS_MS = 25

let _timer: ReturnType<typeof setInterval> | null = null
let _running: Promise<number> | null = null
let _lastPurge = 0

export function serverLabel(s: {
  host: string
  port: number
  machineName?: string
  instanceName?: string
}): string {
  const name =
    s.machineName && s.machineName.toLowerCase() !== s.host.toLowerCase()
      ? ` (${s.machineName})`
      : ''
  return `${s.host}:${s.port}${s.instanceName ? `\\${s.instanceName}` : ''}${name}`
}

/** Costruisce i digest mancanti per le ore complete. Ritorna quanti ne ha creati. */
export async function runDigestJobOnce(now: Date = new Date()): Promise<number> {
  if (_running) return _running
  _running = doRun(now).finally(() => {
    _running = null
  })
  return _running
}

async function doRun(now: Date): Promise<number> {
  // Solo ore COMPLETE: l'ora corrente è ancora in raccolta.
  const to = new Date(Math.floor(now.getTime() / HOUR) * HOUR)
  const from = new Date(to.getTime() - BACKFILL_DAYS * 24 * HOUR)
  let built = 0
  let embedFailures = 0

  for (const srv of serverStore.getAllStripped()) {
    if (built >= MAX_BUCKETS_PER_RUN) break
    let pending
    try {
      pending = await findPendingBuckets(srv.id, from, to)
    } catch (err) {
      log.warn(`findPendingBuckets failed for ${srv.id}:`, safeError(err))
      continue
    }
    for (const b of pending) {
      if (built >= MAX_BUCKETS_PER_RUN) break
      const start = b.bucketStart
      const end = new Date(start.getTime() + HOUR)
      try {
        const alertKeys = Array.from(
          new Set([`${srv.host}:${srv.port}`, srv.ip ? `${srv.ip}:${srv.port}` : ''])
        ).filter(Boolean)
        const [snapshots, alerts, incidents, history] = await Promise.all([
          loadBucketSnapshots(srv.id, start, end),
          loadBucketAlerts(alertKeys, start, end),
          loadBucketIncidents(srv.id, start, end),
          loadBaselineHistory(srv.id, start)
        ])
        if (snapshots.length === 0) continue
        const digest = buildDigest({
          serverId: srv.id,
          serverLabel: serverLabel(srv),
          bucketStart: start,
          bucketEnd: end,
          snapshots,
          aggregates: b,
          alerts,
          incidents,
          baseline: computeBaseline(history, start)
        })

        // Embedding best-effort: senza Ollama il digest resta utile per i filtri
        // strutturati (server + finestra); manca solo la ricerca per similarità.
        let embedding: Buffer | null = null
        let vec: Float32Array | null = null
        if (embedFailures < 3) {
          try {
            vec = await embedDocument(digest.text)
            embedding = packEmbedding(vec)
          } catch {
            embedFailures++
          }
        }

        const id = await insertDigest(digest, embedding)
        if (vec) onDigestInserted({ id, digest, vec })
        built++
        await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_BUCKETS_MS))
      } catch (err) {
        log.warn(`digest build failed for ${srv.id} @ ${start.toISOString()}:`, safeError(err))
      }
    }
  }

  if (built > 0)
    log.info(
      `built ${built} telemetry digest(s)${embedFailures ? ' (embedder unavailable for some)' : ''}`
    )

  if (now.getTime() - _lastPurge > 24 * HOUR) {
    _lastPurge = now.getTime()
    purgeOldDigests()
      .then((n) => n > 0 && log.info(`purged ${n} digest(s) past retention`))
      .catch((err) => log.warn('purgeOldDigests:', safeError(err)))
  }
  return built
}

export function startDigestJob(): void {
  if (_timer) return
  // Primo giro poco dopo il boot (lascia finire migrazioni e warm-up), poi periodico.
  setTimeout(() => {
    runDigestJobOnce().catch((err) => log.warn('initial run failed:', safeError(err)))
  }, 30_000)
  _timer = setInterval(() => {
    runDigestJobOnce().catch((err) => log.warn('run failed:', safeError(err)))
  }, RUN_EVERY_MS)
}

export function stopDigestJob(): void {
  if (_timer) clearInterval(_timer)
  _timer = null
}
