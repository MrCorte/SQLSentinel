import type { ServerMetrics } from '../collectors/types'
import type { StoredServer } from '../store/sqlserver/serverRepository'
import * as metricsRepository from '../store/sqlserver/metricsRepository'
import { getHistoryAll } from '../metricsWorker'

// ---------------------------------------------------------------------------
// Stato "live" dei server per il contesto dell'assistente — UNA lettura per
// richiesta, condivisa da get_server_metrics e get_slow_queries (prima ognuno
// rileggeva da SQL Server lo stesso ultimo snapshot, JSON completo incluso).
//
// Sorgente preferita: la history in memoria del metricsWorker (zero I/O).
// Fallback su SQL per i server senza uno snapshot in memoria abbastanza
// recente — es. quando a raccogliere è il Windows Service: il worker dell'app
// viene solo pre-caricato da SQL al boot e poi non si aggiorna più.
// ---------------------------------------------------------------------------

/** Oltre questa età lo snapshot in memoria è considerato stantio. */
export const MEMORY_FRESH_MS = 10 * 60_000

export interface LatestSnapshots {
  byId: Map<string, ServerMetrics>
  fromMemory: number
  fromStorage: number
}

export async function loadLatestSnapshots(
  servers: StoredServer[],
  now: number = Date.now()
): Promise<LatestSnapshots> {
  const byId = new Map<string, ServerMetrics>()
  let memory: Record<string, ServerMetrics[]> = {}
  try {
    memory = getHistoryAll()
  } catch {
    /* worker non avviato (es. test, o app in modalità service-only) */
  }

  const missing: string[] = []
  for (const s of servers) {
    const keys = [`${s.host}:${s.port}`, s.ip ? `${s.ip}:${s.port}` : null].filter(
      (k): k is string => !!k
    )
    let snap: ServerMetrics | undefined
    for (const k of keys) {
      const last = memory[k]?.at(-1)
      if (last) {
        snap = last
        break
      }
    }
    const age = snap ? now - new Date(snap.collectedAt).getTime() : Infinity
    if (snap && age <= MEMORY_FRESH_MS) byId.set(s.id, snap)
    else missing.push(s.id)
  }

  const fromMemory = byId.size
  if (missing.length > 0) {
    const bulk = await metricsRepository.findLastNBulk(missing, 1)
    for (const id of missing) {
      const snap = bulk[id]?.at(-1)
      if (snap) byId.set(id, snap)
    }
  }
  return { byId, fromMemory, fromStorage: byId.size - fromMemory }
}
