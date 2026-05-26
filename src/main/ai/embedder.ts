import { OLLAMA_HOST } from './ollama'
import { createLogger } from '../utils/logger'

const log = createLogger('embedder')

const OLLAMA_EMBED_URL = `${OLLAMA_HOST}/api/embed`
const EMBED_MODEL = 'nomic-embed-text'
const EMBED_TIMEOUT_MS = 5000
const QUERY_CACHE_MAX = 100

// LRU cache shared across all consumers of the embedder (vector knowledge base,
// feedback index, future RAG features). Same query embedded twice in close
// succession hits memory instead of Ollama.
const _queryCache = new Map<string, Float32Array>()

export function clearQueryCache(): void {
  _queryCache.clear()
}

export async function getQueryEmbedding(query: string): Promise<Float32Array> {
  const cached = _queryCache.get(query)
  if (cached) {
    // Refresh LRU position
    _queryCache.delete(query)
    _queryCache.set(query, cached)
    return cached
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(OLLAMA_EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: [query] }),
      signal: controller.signal
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error(`Ollama embed timeout after ${EMBED_TIMEOUT_MS}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
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
  const vec = new Float32Array(embeddings[0])

  // LRU eviction — drop oldest when over capacity
  if (_queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = _queryCache.keys().next().value
    if (oldest !== undefined) _queryCache.delete(oldest)
  }
  _queryCache.set(query, vec)
  return vec
}

// Warm the embedder so the first real query doesn't pay the model load
// (nomic-embed-text is ~274 MB and otherwise loads on first request).
export async function warmupEmbedder(): Promise<void> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      await fetch(OLLAMA_EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, input: ['warmup'] }),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
    log.info('embedder warm-up complete')
  } catch {
    // best-effort — Ollama may not be running yet
  }
}

// Pack a Float32Array as VARBINARY-friendly Buffer (little-endian) for
// persistence in SQL Server. Symmetric with unpackEmbedding below.
export function packEmbedding(vec: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(vec.byteLength)
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4)
  }
  return buf
}

export function unpackEmbedding(buf: Buffer): Float32Array {
  // Copy into a fresh ArrayBuffer to avoid the Buffer.allocUnsafe shared-pool trap
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}
