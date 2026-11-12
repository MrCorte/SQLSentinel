import { handle, safeError, log } from '../handleWrapper'
import { IpcChannel } from '../types'
import type { IpcResult, RagTrace, RagStats, RagStatsRequest, RagListTracesRequest } from '../types'
import { listTraces } from '../../store/sqlserver/ragTraceRepository'
import { computeRagStats, getRecentTraces } from '../../ai/ragTrace'

const DEFAULT_HOURS = 24
const MAX_HOURS = 720 // 30 days = retention window
const STATS_SAMPLE = 2000

function clampHours(h: unknown): number {
  const n = typeof h === 'number' && Number.isFinite(h) ? Math.floor(h) : DEFAULT_HOURS
  return Math.max(1, Math.min(MAX_HOURS, n))
}

/**
 * Storage first; fall back to the in-memory ring buffer when SQL Server is
 * unavailable so the dashboard keeps working (with a smaller window).
 */
async function loadTraces(sinceHours: number, limit: number): Promise<RagTrace[]> {
  try {
    return await listTraces(sinceHours, limit)
  } catch (err) {
    log.warn('[IPC] RAG traces: storage unavailable, using memory buffer:', safeError(err))
    const cutoff = Date.now() - sinceHours * 3_600_000
    return getRecentTraces(limit).filter((t) => Date.parse(t.createdAt) >= cutoff)
  }
}

export function registerRagObservabilityHandlers(): void {
  handle(
    IpcChannel.AI_RAG_LIST_TRACES,
    async (_event, req?: RagListTracesRequest): Promise<IpcResult<RagTrace[]>> => {
      try {
        const limit = Math.max(1, Math.min(500, Math.floor(req?.limit ?? 100)))
        return { ok: true, data: await loadTraces(clampHours(req?.sinceHours), limit) }
      } catch (err) {
        log.error('[IPC] AI_RAG_LIST_TRACES:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(
    IpcChannel.AI_RAG_STATS,
    async (_event, req?: RagStatsRequest): Promise<IpcResult<RagStats>> => {
      try {
        const traces = await loadTraces(clampHours(req?.sinceHours), STATS_SAMPLE)
        return { ok: true, data: computeRagStats(traces) }
      } catch (err) {
        log.error('[IPC] AI_RAG_STATS:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
