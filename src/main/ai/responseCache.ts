import { createLogger } from '../utils/logger'
import { hashQuestion } from '../store/sqlserver/aiFeedbackRepository'

const log = createLogger('responseCache')

// FAQ questions ("show blocking", "current connections", "tempdb usage") come
// in 5-20 times per session. Caching the final answer for 10 minutes turns the
// 2nd-Nth hit from a ~5s LLM call into <1ms.
const CACHE_MAX = 50
const TTL_MS = 10 * 60 * 1000
// Answers the user explicitly approved (thumbs-up) are cached longer because
// they are known-good. A fresh re-ask will re-populate the cache with the
// approved answer at this TTL, so the user sees the same quality response.
const TTL_APPROVED_MS = 60 * 60 * 1000

interface Entry {
  response: string
  storedAt: number
  ttlMs: number
}

const _cache = new Map<string, Entry>()

// Cache keys include the target server id (when present) so the cached
// response — which embeds server-specific metrics/schema/alerts — is never
// replayed for a different server.
function makeKey(question: string, targetServerId?: string | null): string {
  const qHash = hashQuestion(question)
  return targetServerId ? `${targetServerId}::${qHash}` : `*::${qHash}`
}

export function getCached(question: string, targetServerId?: string | null): string | null {
  const key = makeKey(question, targetServerId)
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.storedAt > entry.ttlMs) {
    _cache.delete(key)
    return null
  }
  // Refresh LRU position
  _cache.delete(key)
  _cache.set(key, entry)
  log.info(`cache hit key=${key.slice(0, 16)} age=${((Date.now() - entry.storedAt) / 1000).toFixed(1)}s`)
  return entry.response
}

export function putCached(question: string, response: string, targetServerId?: string | null): void {
  if (!response || response.trim().length < 20) return // don't cache empty / error blurbs
  const key = makeKey(question, targetServerId)
  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value
    if (oldest !== undefined) _cache.delete(oldest)
  }
  _cache.set(key, { response, storedAt: Date.now(), ttlMs: TTL_MS })
}

// Cache an approved (thumbs-up) answer with a 1-hour TTL so frequently asked
// questions whose answers the user has validated don't expire after 10 minutes.
export function putCachedApproved(
  question: string,
  response: string,
  targetServerId?: string | null
): void {
  if (!response || response.trim().length < 20) return
  const key = makeKey(question, targetServerId)
  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value
    if (oldest !== undefined) _cache.delete(oldest)
  }
  _cache.set(key, { response, storedAt: Date.now(), ttlMs: TTL_APPROVED_MS })
  log.info(`approved cache key=${key.slice(0, 16)} ttl=60min`)
}

// Invalidate every cached variant of the question (any server) — the user's
// thumbs-up/down means the answer needs to be re-evaluated everywhere.
export function invalidate(question: string): void {
  const qHash = hashQuestion(question)
  for (const key of _cache.keys()) {
    if (key.endsWith(`::${qHash}`)) _cache.delete(key)
  }
}

export function clearCache(): void {
  _cache.clear()
}

export function cacheSize(): number {
  return _cache.size
}
