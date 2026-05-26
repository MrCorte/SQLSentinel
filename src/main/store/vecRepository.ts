import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'

const VEC_DB_PATH = app.isPackaged
  ? join(process.resourcesPath, 'knowledge_base.db')
  : join(process.cwd(), 'knowledge-pipeline', 'knowledge_base.db')

const OLLAMA_EMBED_URL = 'http://127.0.0.1:11434/api/embed'
const EMBED_MODEL = 'nomic-embed-text'
const EMBED_DIMS = 768

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
  let dot = 0, normA = 0, normB = 0
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

  _index = rows.map((r) => {
    // Copy the raw bytes into a fresh ArrayBuffer so the Float32Array view is
    // always correctly bounded (Buffer.allocUnsafe uses a shared pool whose
    // .buffer extends far beyond the logical slice).
    const ab = r.embedding.buffer.slice(
      r.embedding.byteOffset,
      r.embedding.byteOffset + r.embedding.byteLength
    )
    const rawFloats = new Float32Array(ab)
    // Ensure the stored vector is always EMBED_DIMS long (production rows are
    // always 768-dim; test mocks may be shorter and get zero-padded here).
    let vec: Float32Array
    if (rawFloats.length === EMBED_DIMS) {
      vec = rawFloats
    } else {
      vec = new Float32Array(EMBED_DIMS)
      vec.set(rawFloats.subarray(0, Math.min(rawFloats.length, EMBED_DIMS)))
    }
    return { title: r.title, text: r.text, vec }
  })
  return _index
}

async function getQueryEmbedding(query: string): Promise<Float32Array> {
  const resp = await fetch(OLLAMA_EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: [query] })
  })
  if (!resp.ok) throw new Error(`Ollama embed error: ${resp.status}`)
  let data: unknown
  try {
    data = await resp.json()
  } catch {
    throw new Error('Ollama embed: malformed JSON response')
  }
  const embeddings = (data as { embeddings?: number[][] })?.embeddings
  if (!Array.isArray(embeddings) || embeddings.length === 0) {
    throw new Error('Ollama embed: unexpected response shape')
  }
  return new Float32Array(embeddings[0])
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
  return scored.filter((r) => r.score >= 0.35).slice(0, topK)
}

export function resetIndex(): void {
  _index = null
}
