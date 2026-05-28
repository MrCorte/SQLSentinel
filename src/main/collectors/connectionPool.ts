import * as mssql from 'mssql'
import { createHash } from 'node:crypto'
import type { ServerConnection } from './types'
import { createLogger } from '../utils/logger'

const log = createLogger('conn-pool')

// Idle TTL: pools unused for 10 min are closed in the next sweep.
const IDLE_TTL_MS = 10 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

interface CachedPool {
  pool: mssql.ConnectionPool
  lastUsedAt: number
  key: string
  /** Set while close() is in flight. New getPool() callers await this before opening a fresh pool. */
  closing: Promise<void> | null
}

const cache = new Map<string, CachedPool>()
// In-flight connect promises — prevents two concurrent getPool() calls from
// each opening a separate pool for the same connection key. The first wins;
// the second awaits its result.
const inflight = new Map<string, Promise<mssql.ConnectionPool>>()
let sweepTimer: ReturnType<typeof setInterval> | null = null
let shuttingDown = false

function passwordFingerprint(s: string | undefined): string {
  if (!s) return ''
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function buildKey(conn: ServerConnection): string {
  return [
    conn.ip,
    conn.port,
    conn.useWindowsAuth ? 'win' : 'sql',
    conn.username ?? '',
    passwordFingerprint(conn.password),
    conn.encrypt === false ? 'noenc' : 'enc',
    conn.trustServerCertificate === false ? 'verify' : 'trust'
  ].join('|')
}

function buildConfig(conn: ServerConnection): mssql.config {
  const base: mssql.config = {
    server: conn.ip,
    port: conn.port,
    database: 'master',
    requestTimeout: 30_000,
    pool: {
      // Per-server pool: small but non-zero idle so quick reuse hits the same socket.
      max: 4,
      min: 0,
      idleTimeoutMillis: IDLE_TTL_MS
    },
    options: {
      encrypt: conn.encrypt ?? true,
      trustServerCertificate: conn.trustServerCertificate ?? true,
      connectTimeout: 15_000
    }
  }

  if (conn.useWindowsAuth) {
    return {
      ...base,
      authentication: {
        type: 'ntlm',
        options: { domain: '', userName: '', password: '' }
      }
    }
  }

  return {
    ...base,
    authentication: {
      type: 'default',
      options: {
        userName: conn.username ?? '',
        password: conn.password ?? ''
      }
    }
  }
}

function ensureSweep(): void {
  if (sweepTimer || shuttingDown) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (entry.closing) continue // already being closed by another path
      if (now - entry.lastUsedAt > IDLE_TTL_MS) {
        // Mark as closing BEFORE delete + close, so a concurrent getPool can
        // observe `closing` and serialise against this teardown.
        entry.closing = entry.pool.close().catch((err) => {
          log.warn('[pool] close idle failed:', err)
        })
        entry.closing.finally(() => {
          // Only delete if no one re-claimed the slot during the close window.
          if (cache.get(key) === entry) cache.delete(key)
        })
      }
    }
    if (cache.size === 0 && sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }, SWEEP_INTERVAL_MS)
  // Don't keep the event loop alive just for sweeps.
  sweepTimer.unref?.()
}

async function openPool(key: string, conn: ServerConnection): Promise<mssql.ConnectionPool> {
  if (shuttingDown) throw new Error('connectionPool is shutting down')
  const pool = new mssql.ConnectionPool(buildConfig(conn))
  const entry: CachedPool = { pool, lastUsedAt: Date.now(), key, closing: null }

  // The error listener must only invalidate the cache slot it OWNS — otherwise
  // a transient 'error' event during connect (before we cache the entry) could
  // delete a slot that a later concurrent call has just populated.
  pool.on('error', (err) => {
    log.warn('[pool] error event, invalidating:', err?.message ?? err)
    if (cache.get(key) === entry) cache.delete(key)
    if (!entry.closing) {
      entry.closing = pool.close().catch(() => {})
    }
  })

  await pool.connect()

  // Race guard: if we were beaten to the punch by another openPool that set
  // a different entry, close ours and return theirs. Cheap because both
  // pools are warm — but only ours leaks a TLS handshake worth of work.
  const winner = cache.get(key)
  if (winner && winner !== entry) {
    pool.close().catch(() => {})
    return winner.pool
  }

  cache.set(key, entry)
  ensureSweep()
  return pool
}

/**
 * Returns a cached, connected mssql ConnectionPool for the given connection.
 * Multiple concurrent callers for the same key share a single connect attempt.
 * Callers must NOT call pool.close() — call invalidatePool() if a connection
 * error occurs.
 */
export async function getPool(conn: ServerConnection): Promise<mssql.ConnectionPool> {
  if (shuttingDown) throw new Error('connectionPool is shutting down')
  const key = buildKey(conn)

  // Fast path: warm pool exists and is connected.
  const existing = cache.get(key)
  if (existing) {
    // If a close is in flight for this key, wait for it before deciding to
    // reuse vs reopen — otherwise the caller could get a half-closed pool.
    if (existing.closing) {
      await existing.closing.catch(() => {})
      // After the close completes, fall through to the re-open path below.
    } else if (existing.pool.connected) {
      existing.lastUsedAt = Date.now()
      return existing.pool
    } else {
      // Stale (disconnected) entry — drop it before reopening.
      if (cache.get(key) === existing) cache.delete(key)
    }
  }

  // Slow path: deduplicate concurrent connects on the same key.
  const pending = inflight.get(key)
  if (pending) return pending

  const promise = openPool(key, conn).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, promise)
  return promise
}

/**
 * Drop a pool from the cache (e.g. on credential rotation, on hard error).
 * The underlying pool is closed asynchronously.
 */
export function invalidatePool(conn: ServerConnection): void {
  const key = buildKey(conn)
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  if (!entry.closing) {
    entry.closing = entry.pool.close().catch(() => {})
  }
}

/**
 * Close every cached pool.
 * @param permanent - true when the process is quitting (keeps shuttingDown=true);
 *                    false (default) for resume-from-sleep, where new pools must
 *                    be allowed afterwards.
 */
export async function closeAllPools(permanent = false): Promise<void> {
  shuttingDown = true
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  const pools = Array.from(cache.values())
  cache.clear()
  // Wait for any currently-connecting pools so they don't escape.
  const pendingConnects = Array.from(inflight.values()).map((p) => p.catch(() => null))
  inflight.clear()
  await Promise.allSettled([
    ...pools.map((entry) => entry.closing ?? entry.pool.close()),
    ...pendingConnects
  ])
  if (!permanent) shuttingDown = false
}

/** For diagnostics / tests. */
export function getCacheSize(): number {
  return cache.size
}

/** For tests only — reset shutdown flag and internal state. */
export function __resetForTests(): void {
  shuttingDown = false
  cache.clear()
  inflight.clear()
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}
