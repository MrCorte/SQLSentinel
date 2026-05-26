import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import { getCached, putCached, invalidate, clearCache, cacheSize } from '../responseCache'

beforeEach(() => {
  clearCache()
  vi.useRealTimers()
})

describe('responseCache', () => {
  it('returns null on miss', () => {
    expect(getCached('whatever')).toBeNull()
  })

  it('round-trips a response', () => {
    putCached('show blocking sessions', 'SELECT * FROM sys.dm_exec_requests WHERE blocking_session_id <> 0')
    const got = getCached('show blocking sessions')
    expect(got).toMatch(/blocking_session_id/)
  })

  it('returns the same value for case-insensitive variants', () => {
    putCached('Show Blocking Sessions', 'A valid response with enough chars to pass the guard')
    expect(getCached('show blocking sessions')).not.toBeNull()
    expect(getCached('SHOW BLOCKING SESSIONS!')).not.toBeNull()
  })

  it('does not cache empty or trivially short responses', () => {
    putCached('q', '')
    putCached('q', '   ')
    putCached('q', 'tiny')
    expect(getCached('q')).toBeNull()
    expect(cacheSize()).toBe(0)
  })

  it('isolates responses by targetServerId', () => {
    putCached('show blocking', 'response for SERVER A with enough chars to pass guard', 'server-A')
    putCached('show blocking', 'response for SERVER B with enough chars to pass guard', 'server-B')
    expect(getCached('show blocking', 'server-A')).toMatch(/SERVER A/)
    expect(getCached('show blocking', 'server-B')).toMatch(/SERVER B/)
    expect(getCached('show blocking', 'server-C')).toBeNull()
    // No-server cache is its own bucket
    expect(getCached('show blocking')).toBeNull()
  })

  it('expires entries after TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    putCached('q', 'long-enough response body to pass the 20-char guard')
    expect(getCached('q')).not.toBeNull()
    vi.setSystemTime(new Date('2026-01-01T00:11:00Z')) // 11 min later
    expect(getCached('q')).toBeNull()
  })

  it('evicts oldest entry when over CACHE_MAX (50)', () => {
    for (let i = 0; i < 55; i++) {
      putCached(`question number ${i}`, `a response long enough to be cached: ${i}`)
    }
    expect(cacheSize()).toBe(50)
    // First 5 inserts should have been evicted
    expect(getCached('question number 0')).toBeNull()
    expect(getCached('question number 4')).toBeNull()
    expect(getCached('question number 5')).not.toBeNull()
  })

  it('invalidate clears every server-variant of a question', () => {
    putCached('show blocking', 'response for SERVER A long enough to pass guard', 'server-A')
    putCached('show blocking', 'response for SERVER B long enough to pass guard', 'server-B')
    putCached('show blocking', 'global response long enough to pass guard')
    invalidate('show blocking')
    expect(getCached('show blocking', 'server-A')).toBeNull()
    expect(getCached('show blocking', 'server-B')).toBeNull()
    expect(getCached('show blocking')).toBeNull()
  })

  it('invalidate does not touch unrelated questions', () => {
    putCached('show blocking', 'a response long enough to be cached and useful')
    putCached('show slow queries', 'another response long enough to be cached')
    invalidate('show blocking')
    expect(getCached('show slow queries')).not.toBeNull()
  })

  it('LRU refresh: re-reading a cached entry promotes it to most-recent', () => {
    for (let i = 0; i < 50; i++) {
      putCached(`q${i}`, `response number ${i} long enough to cache`)
    }
    // Touch the oldest entry → now it's most recent
    expect(getCached('q0')).not.toBeNull()
    // Insert a new entry → evicts the new "oldest" which is q1, not q0
    putCached('q-new', 'a brand new response long enough to cache')
    expect(getCached('q0')).not.toBeNull()
    expect(getCached('q1')).toBeNull()
  })
})
