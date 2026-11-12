import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import {
  startTrace,
  getRecentTraces,
  resetTraces,
  setTracePersister,
  attachFeedback,
  computeRagStats,
  isUngrounded
} from '../ragTrace'
import type { RagTrace } from '../../ipc/types'

function makeTrace(over: Partial<RagTrace> = {}): RagTrace {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    question: 'q',
    targetServerId: null,
    historyLength: 0,
    provider: 'ollama',
    model: 'm',
    status: 'ok',
    totalMs: 1000,
    ttftMs: 800,
    retrievalMs: 200,
    tokensIn: 100,
    tokensOut: 50,
    contextChars: 1000,
    contextBudget: 12000,
    responseChars: 300,
    ftsHits: 1,
    semanticHits: 1,
    semanticTopScore: 0.7,
    kbHits: 1,
    exampleHits: 0,
    exampleTopScore: null,
    predefinedHit: false,
    spans: [],
    hits: [],
    blocks: [],
    error: null,
    feedbackRating: null,
    ...over
  }
}

beforeEach(() => {
  resetTraces()
  setTracePersister(null)
})

describe('RagTraceRecorder', () => {
  it('records spans, retrieval, context and usage into a finished trace', async () => {
    const t = startTrace({ question: 'why is tempdb full', targetServerId: 's1', historyLength: 2 })
    t.setProvider('claude', 'claude-x')
    await t.span('knowledge_retrieval', async () => 'ok')
    t.markRetrievalDone()
    t.recordKnowledge({
      ftsCount: 3,
      semanticCount: 2,
      semanticTopScore: 0.81,
      fused: [{ title: 'tempdb', rrf: 0.03, via: 'both' }]
    })
    t.recordExamples([{ question: 'tempdb full?', score: 0.9 }])
    t.recordPredefined(true)
    t.recordContext(
      [
        { tag: 'SERVER_METRICS', chars: 500, kept: false },
        { tag: 'KNOWLEDGE', chars: 900, kept: true }
      ],
      900,
      12000
    )
    t.markFirstToken()
    t.addUsage(100, 20)
    t.addUsage(50, 10)
    const trace = t.finish('ok', { responseChars: 42 })!

    expect(trace.status).toBe('ok')
    expect(trace.provider).toBe('claude')
    expect(trace.targetServerId).toBe('s1')
    expect(trace.historyLength).toBe(2)
    expect(trace.spans.map((s) => s.name)).toEqual(['knowledge_retrieval'])
    expect(trace.kbHits).toBe(1)
    expect(trace.exampleHits).toBe(1)
    expect(trace.exampleTopScore).toBe(0.9)
    expect(trace.semanticTopScore).toBe(0.81)
    expect(trace.predefinedHit).toBe(true)
    expect(trace.tokensIn).toBe(150)
    expect(trace.tokensOut).toBe(30)
    expect(trace.ttftMs).not.toBeNull()
    expect(trace.blocks.filter((b) => !b.kept)).toHaveLength(1)
    expect(trace.responseChars).toBe(42)
  })

  it('records failed spans and re-throws', async () => {
    const t = startTrace({ question: 'q', historyLength: 0 })
    await expect(
      t.span('get_server_metrics', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    const trace = t.finish('error', { error: 'boom' })!
    expect(trace.spans[0]).toMatchObject({ name: 'get_server_metrics', ok: false })
    expect(trace.error).toBe('boom')
  })

  it('finish is idempotent and freezes spans', () => {
    const t = startTrace({ question: 'q', historyLength: 0 })
    expect(t.finish('ok')).not.toBeNull()
    t.addSpan('late', 0, 10)
    expect(t.finish('error')).toBeNull()
    const [only] = getRecentTraces()
    expect(only.status).toBe('ok')
    expect(only.spans).toHaveLength(0)
    expect(getRecentTraces()).toHaveLength(1)
  })

  it('persists via the injected persister and links feedback', async () => {
    const insert = vi.fn().mockResolvedValue(undefined)
    const setFeedback = vi.fn().mockResolvedValue(undefined)
    setTracePersister({ insert, setFeedback })
    const t = startTrace({ question: 'q', historyLength: 0 })
    t.finish('ok')
    expect(insert).toHaveBeenCalledTimes(1)
    await attachFeedback(t.id, -1)
    expect(setFeedback).toHaveBeenCalledWith(t.id, -1)
    expect(getRecentTraces()[0].feedbackRating).toBe(-1)
  })

  it('swallows persistence failures', async () => {
    setTracePersister({
      insert: vi.fn().mockRejectedValue(new Error('storage down')),
      setFeedback: vi.fn()
    })
    const t = startTrace({ question: 'q', historyLength: 0 })
    expect(() => t.finish('ok')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(getRecentTraces()).toHaveLength(1)
  })
})

describe('computeRagStats', () => {
  it('handles an empty window', () => {
    const s = computeRagStats([])
    expect(s.totalTraces).toBe(0)
    expect(s.p50TotalMs).toBeNull()
    expect(s.feedback.satisfaction).toBeNull()
  })

  it('classifies ungrounded answers (cache hits excluded)', () => {
    expect(isUngrounded(makeTrace({ kbHits: 0, exampleHits: 0 }))).toBe(true)
    expect(isUngrounded(makeTrace({ kbHits: 0, exampleHits: 0, predefinedHit: true }))).toBe(false)
    expect(isUngrounded(makeTrace({ kbHits: 0, exampleHits: 0, status: 'cache_hit' }))).toBe(false)
  })

  it('aggregates latency, rates, feedback correlation, drops and gaps', () => {
    const traces = [
      makeTrace({ totalMs: 1000, feedbackRating: 1, semanticTopScore: 0.8 }),
      makeTrace({ totalMs: 2000, feedbackRating: 1, semanticTopScore: 0.6 }),
      makeTrace({
        totalMs: 3000,
        kbHits: 0,
        exampleHits: 0,
        semanticTopScore: 0.3,
        feedbackRating: -1,
        question: 'distributed AG?',
        blocks: [{ tag: 'SERVER_METRICS', chars: 10, kept: false }],
        spans: [{ name: 'llm_generation', startMs: 0, durationMs: 2500, ok: true }]
      }),
      makeTrace({ status: 'cache_hit', totalMs: 1 }),
      makeTrace({ status: 'error', totalMs: 50 })
    ]
    const s = computeRagStats(traces)
    expect(s.totalTraces).toBe(5)
    expect(s.cacheHitRate).toBeCloseTo(0.2)
    expect(s.errorRate).toBeCloseTo(0.2)
    expect(s.p50TotalMs).toBe(2000)
    expect(s.p95TotalMs).toBe(3000)
    // 1 of 4 generated (non-cache) answers ungrounded
    expect(s.ungroundedRate).toBeCloseTo(0.25)
    expect(s.feedback.up).toBe(2)
    expect(s.feedback.down).toBe(1)
    expect(s.feedback.satisfaction).toBeCloseTo(2 / 3)
    expect(s.feedback.avgSemanticScoreUp).toBeCloseTo(0.7)
    expect(s.feedback.avgSemanticScoreDown).toBeCloseTo(0.3)
    expect(s.feedback.groundedRateUp).toBe(1)
    expect(s.feedback.groundedRateDown).toBe(0)
    expect(s.blockDrops).toEqual([{ tag: 'SERVER_METRICS', count: 1 }])
    expect(s.knowledgeGaps.map((g) => g.question)).toEqual(['distributed AG?'])
    expect(s.stages[0]).toMatchObject({ name: 'llm_generation', avgMs: 2500 })
    expect(s.tokensIn).toBe(500)
  })

  it('dedupes knowledge gaps by question text', () => {
    const s = computeRagStats([
      makeTrace({ kbHits: 0, exampleHits: 0, question: 'Same Q' }),
      makeTrace({ kbHits: 0, exampleHits: 0, question: 'same q ' })
    ])
    expect(s.knowledgeGaps).toHaveLength(1)
  })
})
