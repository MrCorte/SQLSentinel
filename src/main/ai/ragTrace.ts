import { createLogger } from '../utils/logger'
import { safeError } from '../utils/safeLog'
import type {
  RagTrace,
  RagTraceStatus,
  RagSpan,
  RagRetrievalHit,
  RagBlockStat,
  RagStats
} from '../ipc/types'

const log = createLogger('ragTrace')

// ---------------------------------------------------------------------------
// RAG observability — one trace per assistant request.
//
// A trace captures the full lifecycle of a RAG turn:
//   cache lookup → parallel retrieval (KB hybrid search, few-shot examples,
//   live telemetry) → context assembly under a char budget → LLM generation.
//
// Each stage is a span (name + start offset + duration + ok flag). On top of
// the spans the trace records *what* was retrieved (titles + scores), which
// context blocks survived the budget, token usage, time-to-first-token and —
// later, when the user clicks 👍/👎 — the feedback rating. That last link is
// what turns raw telemetry into a quality signal: "do answers with weak
// retrieval get thumbs-down more often?"
//
// Persistence is best-effort (SQL Server via ragTraceRepository); an
// in-memory ring buffer keeps the latest traces available even when storage
// is down, so the dashboard never goes blank.
// ---------------------------------------------------------------------------

const RING_MAX = 200
let _recent: RagTrace[] = []

type Persister = {
  insert: (t: RagTrace) => Promise<void>
  setFeedback: (traceId: string, rating: 1 | -1) => Promise<void>
}
let _persister: Persister | null = null

/** Injected at startup (and in tests) so this module stays storage-agnostic. */
export function setTracePersister(p: Persister | null): void {
  _persister = p
}

export function getRecentTraces(limit = 50): RagTrace[] {
  return _recent.slice(-limit).reverse()
}

export function resetTraces(): void {
  _recent = []
}

function newId(): string {
  return crypto.randomUUID()
}

export interface TraceInit {
  question: string
  targetServerId?: string | null
  historyLength: number
}

export class RagTraceRecorder {
  readonly id = newId()
  get isFinished(): boolean {
    return this.finished
  }
  private readonly t0 = performance.now()
  private readonly createdAt = new Date().toISOString()
  private readonly spans: RagSpan[] = []
  private readonly hits: RagRetrievalHit[] = []
  private blocks: RagBlockStat[] = []
  private firstTokenMs: number | null = null
  private retrievalMs: number | null = null
  private provider: string | null = null
  private model: string | null = null
  private tokensIn: number | null = null
  private tokensOut: number | null = null
  private contextChars = 0
  private contextBudget = 0
  private ftsHits = 0
  private semanticHits = 0
  private semanticTopScore: number | null = null
  private exampleTopScore: number | null = null
  private predefinedHit = false
  private finished = false

  constructor(private readonly init: TraceInit) {}

  private now(): number {
    return performance.now() - this.t0
  }

  /** Time an async stage. Errors are recorded on the span and re-thrown. */
  async span<T>(name: string, fn: () => Promise<T>, describe?: (r: T) => string): Promise<T> {
    if (this.finished) return fn()
    const start = this.now()
    try {
      const result = await fn()
      this.spans.push({
        name,
        startMs: Math.round(start),
        durationMs: Math.round(this.now() - start),
        ok: true,
        detail: describe ? describe(result).slice(0, 200) : undefined
      })
      return result
    } catch (err) {
      this.spans.push({
        name,
        startMs: Math.round(start),
        durationMs: Math.round(this.now() - start),
        ok: false,
        detail: safeError(err).slice(0, 200)
      })
      throw err
    }
  }

  /** Record a synchronous/instant stage whose timing was measured externally. */
  addSpan(name: string, startMs: number, durationMs: number, ok = true, detail?: string): void {
    if (this.finished) return
    this.spans.push({
      name,
      startMs: Math.round(startMs),
      durationMs: Math.round(durationMs),
      ok,
      detail
    })
  }

  elapsed(): number {
    return this.now()
  }

  setProvider(provider: string, model: string): void {
    this.provider = provider
    this.model = model
  }

  markRetrievalDone(): void {
    this.retrievalMs = Math.round(this.now())
  }

  recordKnowledge(info: {
    ftsCount: number
    semanticCount: number
    semanticTopScore: number | null
    fused: { title: string; rrf: number; via: 'fts' | 'semantic' | 'both' }[]
  }): void {
    this.ftsHits = info.ftsCount
    this.semanticHits = info.semanticCount
    this.semanticTopScore = info.semanticTopScore
    for (const h of info.fused) {
      this.hits.push({ source: 'kb', title: h.title.slice(0, 200), score: h.rrf, via: h.via })
    }
  }

  recordExamples(examples: { question: string; score: number }[]): void {
    for (const e of examples) {
      this.hits.push({ source: 'example', title: e.question.slice(0, 200), score: e.score })
    }
    this.exampleTopScore = examples.length > 0 ? Math.max(...examples.map((e) => e.score)) : null
  }

  /** Observability RAG: digest della finestra + precedenti simili recuperati. */
  recordTelemetry(
    windowDigests: number,
    anomalous: number,
    precedents: { title: string; score: number }[]
  ): void {
    if (windowDigests > 0) {
      this.hits.push({
        source: 'telemetry',
        title: `${windowDigests} hourly digest(s), ${anomalous} anomalous`,
        score: anomalous
      })
    }
    for (const p of precedents) {
      this.hits.push({ source: 'telemetry', title: `precedent: ${p.title}`, score: p.score })
    }
  }

    recordPredefined(hit: boolean): void {
    this.predefinedHit = hit
  }

  recordContext(blocks: RagBlockStat[], keptChars: number, budget: number): void {
    this.blocks = blocks
    this.contextChars = keptChars
    this.contextBudget = budget
  }

  markFirstToken(): void {
    if (this.firstTokenMs == null) this.firstTokenMs = Math.round(this.now())
  }

  addUsage(tokensIn: number, tokensOut: number): void {
    this.tokensIn = (this.tokensIn ?? 0) + tokensIn
    this.tokensOut = (this.tokensOut ?? 0) + tokensOut
  }

  /** Finalize, buffer in memory and persist (fire-and-forget). Idempotent. */
  finish(
    status: RagTraceStatus,
    opts: { responseChars?: number; error?: string } = {}
  ): RagTrace | null {
    if (this.finished) return null
    this.finished = true
    const kbHits = this.hits.filter((h) => h.source === 'kb')
    const exHits = this.hits.filter((h) => h.source === 'example')
    const trace: RagTrace = {
      id: this.id,
      createdAt: this.createdAt,
      question: this.init.question.slice(0, 2000),
      targetServerId: this.init.targetServerId ?? null,
      historyLength: this.init.historyLength,
      provider: this.provider,
      model: this.model,
      status,
      totalMs: Math.round(this.now()),
      ttftMs: this.firstTokenMs,
      retrievalMs: this.retrievalMs,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      contextChars: this.contextChars,
      contextBudget: this.contextBudget,
      responseChars: opts.responseChars ?? 0,
      ftsHits: this.ftsHits,
      semanticHits: this.semanticHits,
      semanticTopScore: this.semanticTopScore,
      kbHits: kbHits.length,
      exampleHits: exHits.length,
      exampleTopScore: this.exampleTopScore,
      predefinedHit: this.predefinedHit,
      spans: this.spans,
      hits: this.hits,
      blocks: this.blocks,
      error: opts.error ? opts.error.slice(0, 1000) : null,
      feedbackRating: null
    }

    _recent.push(trace)
    if (_recent.length > RING_MAX) _recent = _recent.slice(-RING_MAX)

    log.info(
      `trace=${trace.id.slice(0, 8)} status=${status} total=${trace.totalMs}ms ttft=${trace.ttftMs ?? '-'}ms ` +
        `kb=${trace.kbHits} ex=${trace.exampleHits} predefined=${trace.predefinedHit} ` +
        `ctx=${trace.contextChars}/${trace.contextBudget} dropped=${trace.blocks.filter((b) => !b.kept).length}`
    )

    if (_persister) {
      _persister.insert(trace).catch((err) => log.warn('persist failed:', safeError(err)))
    }
    return trace
  }
}

export function startTrace(init: TraceInit): RagTraceRecorder {
  return new RagTraceRecorder(init)
}

/** Attach a 👍/👎 to a trace (memory + storage). */
export async function attachFeedback(traceId: string, rating: 1 | -1): Promise<void> {
  const t = _recent.find((r) => r.id === traceId)
  if (t) t.feedbackRating = rating
  if (_persister) await _persister.setFeedback(traceId, rating)
}

// ---------------------------------------------------------------------------
// Aggregation — pure function so it works on SQL rows or the memory ring.
// ---------------------------------------------------------------------------

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  // Nearest-rank method — simple and good enough for dashboard KPIs.
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** A turn is "ungrounded" when no knowledge, example, predefined query or telemetry history backed it. */
export function isUngrounded(t: RagTrace): boolean {
  return (
    t.status !== 'cache_hit' &&
    t.kbHits === 0 &&
    t.exampleHits === 0 &&
    !t.predefinedHit &&
    !t.hits.some((h) => h.source === 'telemetry')
  )
}

export function computeRagStats(traces: RagTrace[]): RagStats {
  const total = traces.length
  const generated = traces.filter((t) => t.status !== 'cache_hit')
  const ok = traces.filter((t) => t.status === 'ok')
  const errors = traces.filter((t) => t.status === 'error').length
  const cacheHits = traces.filter((t) => t.status === 'cache_hit').length
  const ungrounded = generated.filter(isUngrounded)
  const rated = traces.filter((t) => t.feedbackRating != null)
  const up = rated.filter((t) => t.feedbackRating === 1)
  const down = rated.filter((t) => t.feedbackRating === -1)

  const stageMap = new Map<string, { durations: number[]; errors: number }>()
  for (const t of generated) {
    for (const s of t.spans) {
      const e = stageMap.get(s.name) ?? { durations: [], errors: 0 }
      e.durations.push(s.durationMs)
      if (!s.ok) e.errors++
      stageMap.set(s.name, e)
    }
  }
  const stages = Array.from(stageMap.entries())
    .map(([name, e]) => ({
      name,
      count: e.durations.length,
      avgMs: Math.round(avg(e.durations) ?? 0),
      p95Ms: percentile(e.durations, 95) ?? 0,
      errors: e.errors
    }))
    .sort((a, b) => b.avgMs - a.avgMs)

  const dropMap = new Map<string, number>()
  for (const t of generated) {
    for (const b of t.blocks) if (!b.kept) dropMap.set(b.tag, (dropMap.get(b.tag) ?? 0) + 1)
  }

  const semUp = up.map((t) => t.semanticTopScore).filter((v): v is number => v != null)
  const semDown = down.map((t) => t.semanticTopScore).filter((v): v is number => v != null)
  const groundedUp = up.filter((t) => !isUngrounded(t)).length
  const groundedDown = down.filter((t) => !isUngrounded(t)).length

  // Knowledge gaps: distinct recent questions with zero retrieval support —
  // the actionable list of what to add to the knowledge base next.
  const seen = new Set<string>()
  const knowledgeGaps: RagStats['knowledgeGaps'] = []
  for (const t of [...ungrounded].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const key = t.question.toLowerCase().trim()
    if (seen.has(key)) continue
    seen.add(key)
    knowledgeGaps.push({ traceId: t.id, question: t.question, createdAt: t.createdAt })
    if (knowledgeGaps.length >= 10) break
  }

  return {
    totalTraces: total,
    errorRate: total ? errors / total : 0,
    cacheHitRate: total ? cacheHits / total : 0,
    p50TotalMs: percentile(
      ok.map((t) => t.totalMs),
      50
    ),
    p95TotalMs: percentile(
      ok.map((t) => t.totalMs),
      95
    ),
    p50TtftMs: percentile(
      ok.map((t) => t.ttftMs).filter((v): v is number => v != null),
      50
    ),
    avgRetrievalMs: avg(generated.map((t) => t.retrievalMs).filter((v): v is number => v != null)),
    ungroundedRate: generated.length ? ungrounded.length / generated.length : 0,
    avgSemanticTopScore: avg(
      generated.map((t) => t.semanticTopScore).filter((v): v is number => v != null)
    ),
    predefinedHitRate: generated.length
      ? generated.filter((t) => t.predefinedHit).length / generated.length
      : 0,
    tokensIn: traces.reduce((s, t) => s + (t.tokensIn ?? 0), 0),
    tokensOut: traces.reduce((s, t) => s + (t.tokensOut ?? 0), 0),
    feedback: {
      rated: rated.length,
      up: up.length,
      down: down.length,
      satisfaction: rated.length ? up.length / rated.length : null,
      avgSemanticScoreUp: avg(semUp),
      avgSemanticScoreDown: avg(semDown),
      groundedRateUp: up.length ? groundedUp / up.length : null,
      groundedRateDown: down.length ? groundedDown / down.length : null
    },
    stages,
    blockDrops: Array.from(dropMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
    knowledgeGaps
  }
}
