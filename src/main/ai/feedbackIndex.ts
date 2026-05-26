import { createLogger } from '../utils/logger'
import { cosineSimilarity } from '../store/vecRepository'
import { getQueryEmbedding, unpackEmbedding } from './embedder'
import { listEmbeddable } from '../store/sqlserver/aiFeedbackRepository'

const log = createLogger('feedbackIndex')

// Higher than the knowledge-base threshold (0.5) because few-shot examples
// must be *very* similar to the current question to act as good guidance.
// Vaguely topical examples are worse than no example at all.
const SIMILARITY_THRESHOLD = 0.6

export interface FeedbackHit {
  id: string
  question: string
  response: string
  score: number
}

interface IndexEntry {
  id: string
  question: string
  response: string
  vec: Float32Array
}

let _entries: IndexEntry[] = []
let _loaded = false

export async function preWarm(): Promise<void> {
  if (_loaded) return
  try {
    const rows = await listEmbeddable()
    _entries = rows
      .filter((r) => r.embedding != null)
      .map((r) => ({
        id: r.id,
        question: r.question,
        response: r.response,
        vec: unpackEmbedding(r.embedding as Buffer)
      }))
    _loaded = true
    log.info(`loaded ${_entries.length} positive feedback entries`)
  } catch (err) {
    // Storage may not be configured yet on first boot — try again later
    log.warn('preWarm failed:', err instanceof Error ? err.message : String(err))
  }
}

export async function findSimilar(query: string, topK = 2): Promise<FeedbackHit[]> {
  if (!_loaded) {
    // Lazy retry — preWarm may have failed when called at startup
    await preWarm()
  }
  if (_entries.length === 0) return []

  let queryVec: Float32Array
  try {
    queryVec = await getQueryEmbedding(query)
  } catch {
    return [] // Ollama down — degrade gracefully
  }

  const scored = _entries.map((e) => ({
    id: e.id,
    question: e.question,
    response: e.response,
    score: cosineSimilarity(queryVec, e.vec)
  }))
  scored.sort((a, b) => b.score - a.score)
  const filtered = scored.filter((r) => r.score >= SIMILARITY_THRESHOLD).slice(0, topK)
  log.info(
    `query="${query.slice(0, 60)}" topScore=${scored[0]?.score.toFixed(3) ?? 'n/a'} hits=${filtered.length}/${topK}`
  )
  return filtered
}

// Called after insertFeedback so the new positive example is immediately
// retrievable without restarting the app.
export function addRow(row: {
  id: string
  question: string
  response: string
  vec: Float32Array
}): void {
  _entries.push(row)
}

export function removeRow(id: string): void {
  _entries = _entries.filter((e) => e.id !== id)
}

export function reset(): void {
  _entries = []
  _loaded = false
}

export function size(): number {
  return _entries.length
}
