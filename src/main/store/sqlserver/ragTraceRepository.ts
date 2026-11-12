import * as sql from 'mssql'
import { getPool } from './connection'
import { hashQuestion } from './aiFeedbackRepository'
import type { RagTrace, RagTraceStatus } from '../../ipc/types'

export const RAG_TRACE_RETENTION_DAYS = 30
const MAX_LIST = 2000

export async function insertTrace(t: RagTrace): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), t.id)
    .input('created_at', sql.DateTime2(3), new Date(t.createdAt))
    .input('question', sql.NVarChar(2000), t.question.slice(0, 2000))
    .input('question_hash', sql.Char(64), hashQuestion(t.question))
    .input('target_server_id', sql.NVarChar(36), t.targetServerId)
    .input('history_length', sql.Int, t.historyLength)
    .input('provider', sql.NVarChar(20), t.provider)
    .input('model', sql.NVarChar(100), t.model)
    .input('status', sql.NVarChar(20), t.status)
    .input('total_ms', sql.Int, t.totalMs)
    .input('ttft_ms', sql.Int, t.ttftMs)
    .input('retrieval_ms', sql.Int, t.retrievalMs)
    .input('tokens_in', sql.Int, t.tokensIn)
    .input('tokens_out', sql.Int, t.tokensOut)
    .input('context_chars', sql.Int, t.contextChars)
    .input('context_budget', sql.Int, t.contextBudget)
    .input('response_chars', sql.Int, t.responseChars)
    .input('fts_hits', sql.Int, t.ftsHits)
    .input('semantic_hits', sql.Int, t.semanticHits)
    .input('semantic_top_score', sql.Float, t.semanticTopScore)
    .input('kb_hits', sql.Int, t.kbHits)
    .input('example_hits', sql.Int, t.exampleHits)
    .input('example_top_score', sql.Float, t.exampleTopScore)
    .input('predefined_hit', sql.Bit, t.predefinedHit)
    .input('spans_json', sql.NVarChar(sql.MAX), JSON.stringify(t.spans))
    .input('hits_json', sql.NVarChar(sql.MAX), JSON.stringify(t.hits))
    .input('blocks_json', sql.NVarChar(sql.MAX), JSON.stringify(t.blocks))
    .input('error', sql.NVarChar(1000), t.error).query(`INSERT INTO dbo.ai_rag_traces
      (id, created_at, question, question_hash, target_server_id, history_length, provider, model,
       status, total_ms, ttft_ms, retrieval_ms, tokens_in, tokens_out, context_chars, context_budget,
       response_chars, fts_hits, semantic_hits, semantic_top_score, kb_hits, example_hits,
       example_top_score, predefined_hit, spans_json, hits_json, blocks_json, error)
      VALUES
      (@id, @created_at, @question, @question_hash, @target_server_id, @history_length, @provider, @model,
       @status, @total_ms, @ttft_ms, @retrieval_ms, @tokens_in, @tokens_out, @context_chars, @context_budget,
       @response_chars, @fts_hits, @semantic_hits, @semantic_top_score, @kb_hits, @example_hits,
       @example_top_score, @predefined_hit, @spans_json, @hits_json, @blocks_json, @error)`)
}

export async function setTraceFeedback(traceId: string, rating: 1 | -1): Promise<void> {
  await getPool()
    .request()
    .input('id', sql.NVarChar(36), traceId)
    .input('rating', sql.SmallInt, rating)
    .query(`UPDATE dbo.ai_rag_traces SET feedback_rating = @rating WHERE id = @id`)
}

interface RawTraceRow {
  id: string
  created_at: Date | string
  question: string
  target_server_id: string | null
  history_length: number
  provider: string | null
  model: string | null
  status: string
  total_ms: number
  ttft_ms: number | null
  retrieval_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
  context_chars: number
  context_budget: number
  response_chars: number
  fts_hits: number
  semantic_hits: number
  semantic_top_score: number | null
  kb_hits: number
  example_hits: number
  example_top_score: number | null
  predefined_hit: boolean
  spans_json: string
  hits_json: string
  blocks_json: string
  error: string | null
  feedback_rating: number | null
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

export function rowToTrace(r: RawTraceRow): RagTrace {
  return {
    id: r.id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    question: r.question,
    targetServerId: r.target_server_id,
    historyLength: r.history_length,
    provider: r.provider,
    model: r.model,
    status: r.status as RagTraceStatus,
    totalMs: r.total_ms,
    ttftMs: r.ttft_ms,
    retrievalMs: r.retrieval_ms,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    contextChars: r.context_chars,
    contextBudget: r.context_budget,
    responseChars: r.response_chars,
    ftsHits: r.fts_hits,
    semanticHits: r.semantic_hits,
    semanticTopScore: r.semantic_top_score,
    kbHits: r.kb_hits,
    exampleHits: r.example_hits,
    exampleTopScore: r.example_top_score,
    predefinedHit: Boolean(r.predefined_hit),
    spans: parseJsonArray(r.spans_json),
    hits: parseJsonArray(r.hits_json),
    blocks: parseJsonArray(r.blocks_json),
    error: r.error,
    feedbackRating: r.feedback_rating == null ? null : r.feedback_rating > 0 ? 1 : -1
  }
}

/** Most recent traces in the window, newest first. */
export async function listTraces(sinceHours: number, limit: number): Promise<RagTrace[]> {
  const r = await getPool()
    .request()
    .input('limit', sql.Int, Math.max(1, Math.min(MAX_LIST, Math.floor(limit))))
    .input('since_hours', sql.Int, Math.max(1, Math.floor(sinceHours))).query<RawTraceRow>(`
      SELECT TOP (@limit)
             id, created_at, question, target_server_id, history_length, provider, model,
             status, total_ms, ttft_ms, retrieval_ms, tokens_in, tokens_out, context_chars,
             context_budget, response_chars, fts_hits, semantic_hits, semantic_top_score,
             kb_hits, example_hits, example_top_score, predefined_hit, spans_json, hits_json,
             blocks_json, error, feedback_rating
        FROM dbo.ai_rag_traces
       WHERE created_at >= DATEADD(HOUR, -@since_hours, SYSUTCDATETIME())
       ORDER BY created_at DESC`)
  return r.recordset.map(rowToTrace)
}

/** Retention: batched delete so a large backlog never holds a long lock. */
export async function purgeOlderThan(days = RAG_TRACE_RETENTION_DAYS): Promise<number> {
  const r = await getPool().request().input('days', sql.Int, days).query<{ deleted: number }>(`
      DECLARE @deleted INT = 0, @n INT = 1;
      WHILE @n > 0
      BEGIN
        DELETE TOP (5000) FROM dbo.ai_rag_traces
         WHERE created_at < DATEADD(DAY, -@days, SYSUTCDATETIME());
        SET @n = @@ROWCOUNT;
        SET @deleted += @n;
      END
      SELECT @deleted AS deleted;`)
  return r.recordset[0]?.deleted ?? 0
}
