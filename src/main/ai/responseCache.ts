import { createLogger } from '../utils/logger'
import { hashQuestion } from '../store/sqlserver/aiFeedbackRepository'

const log = createLogger('responseCache')

// FAQ questions ("show blocking", "current connections", "tempdb usage") come
// in 5-20 times per session. Caching the final answer for 10 minutes turns the
// 2nd-Nth hit from a ~5s LLM call into <1ms.
const CACHE_MAX = 50
const TTL_MS = 10 * 60 * 1000

interface Entry {
  response: string
  storedAt: number
}

const _cache = new Map<string, Entry>()

export function getCached(question: string): string | null {
  const key = hashQuestion(question)
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.storedAt > TTL_MS) {
    _cache.delete(key)
    return null
  }
  // Refresh LRU position
  _cache.delete(key)
  _cache.set(key, entry)
  log.info(`cache hit key=${key.slice(0, 8)} age=${((Date.now() - entry.storedAt) / 1000).toFixed(1)}s`)
  return entry.response
}

export function putCached(question: string, response: string): void {
  if (!response || response.trim().length < 20) return // don't cache empty / error blurbs
  const key = hashQuestion(question)
  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value
    if (oldest !== undefined) _cache.delete(oldest)
  }
  _cache.set(key, { response, storedAt: Date.now() })
}

// Invalidate when the user thumbs-up/down a response — they want the model
// to potentially re-evaluate similar questions.
export function invalidate(question: string): void {
  _cache.delete(hashQuestion(question))
}

export function clearCache(): void {
  _cache.clear()
}

export function cacheSize(): number {
  return _cache.size
}
