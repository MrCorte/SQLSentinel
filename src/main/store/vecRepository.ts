import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { createLogger } from '../utils/logger'
import { getQueryEmbedding, clearQueryCache, unpackEmbedding } from '../ai/embedder'

const log = createLogger('vec')

const VEC_DB_PATH = app.isPackaged
  ? join(process.resourcesPath, 'knowledge_base.db')
  : join(process.cwd(), 'knowledge-pipeline', 'knowledge_base.db')

// Cosine threshold below which results are dropped. nomic-embed-text on DBA
// wiki content clusters relevant matches at 0.5+ — 0.5 is conservative enough
// to keep noise out of the LLM prompt without dropping legitimate hits.
const SCORE_THRESHOLD = 0.5

interface EmbeddingRow {
  id: number
  title: string
  chunk_idx: number
  text: string
  embedding: Buffer
}

export interface VecResult {
  title: string
  text: string
  score: number
}

let _index: { title: string; text: string; vec: Float32Array }[] | null = null

export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function loadIndex(): { title: string; text: string; vec: Float32Array }[] {
  if (_index !== null) return _index
  if (!existsSync(VEC_DB_PATH)) {
    log.warn('knowledge_base.db not found at', VEC_DB_PATH)
    _index = []
    return _index
  }

  const db = new Database(VEC_DB_PATH, { readonly: true })
  let rows: EmbeddingRow[]
  try {
    rows = db.prepare<[], EmbeddingRow>(
      'SELECT id, title, chunk_idx, text, embedding FROM knowledge_embeddings'
    ).all()
  } finally {
    db.close()
  }

  _index = rows.map((r) => ({
    title: r.title,
    text: r.text,
    vec: unpackEmbedding(r.embedding)
  }))
  log.info(`loaded ${_index.length} embedding chunks`)
  return _index
}

export async function semanticSearch(query: string, topK = 3): Promise<VecResult[]> {
  const index = loadIndex()
  if (index.length === 0) return []

  const queryVec = await getQueryEmbedding(query)

  const scored = index.map((entry) => ({
    title: entry.title,
    text: entry.text,
    score: cosineSimilarity(queryVec, entry.vec)
  }))

  scored.sort((a, b) => b.score - a.score)
  const filtered = scored.filter((r) => r.score >= SCORE_THRESHOLD).slice(0, topK)
  log.info(
    `query="${query.slice(0, 60)}" topScore=${scored[0]?.score.toFixed(3) ?? 'n/a'} hits=${filtered.length}/${topK}`
  )
  return filtered
}

export function resetIndex(): void {
  _index = null
  clearQueryCache()
}

// Eagerly populate the in-memory index off the hot path so the first AI query
// doesn't pay the ~8k-row SQLite read + 25 MB allocation on the main thread.
export function preWarmIndex(): void {
  setImmediate(() => {
    try {
      loadIndex()
    } catch {
      // best-effort — semanticSearch will retry on demand
    }
  })
}

// Backward-compatible re-export — existing call sites already import from here.
export { warmupEmbedder } from '../ai/embedder'
