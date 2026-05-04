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
}

const cache = new Map<string, CachedPool>()
let sweepTimer: ReturnType<typeof setInterval> | null = null

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
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now - entry.lastUsedAt > IDLE_TTL_MS) {
        cache.delete(key)
        entry.pool.close().catch((err) => log.warn('[pool] close idle failed:', err))
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

/**
 * Returns a cached, connected mssql ConnectionPool for the given connection.
 * The pool is reused across calls until it is invalidated by an error or the
 * idle TTL expires. Callers must NOT call pool.close() — call invalidatePool()
 * instead if a connection error occurs.
 */
export async function getPool(conn: ServerConnection): Promise<mssql.ConnectionPool> {
  const key = buildKey(conn)
  const existing = cache.get(key)
  if (existing && existing.pool.connected) {
    existing.lastUsedAt = Date.now()
    return existing.pool
  }

  const pool = new mssql.ConnectionPool(buildConfig(conn))
  // If the pool emits an error, drop it from the cache so the next call retries.
  pool.on('error', (err) => {
    log.warn('[pool] error event, invalidating:', err?.message ?? err)
    cache.delete(key)
    pool.close().catch(() => {})
  })

  try {
    await pool.connect()
  } catch (err) {
    cache.delete(key)
    throw err
  }

  cache.set(key, { pool, lastUsedAt: Date.now(), key })
  ensureSweep()
  return pool
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
  entry.pool.close().catch(() => {})
}

/**
 * Close every cached pool. Called from the main process shutdown handler.
 */
export async function closeAllPools(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  const pools = Array.from(cache.values())
  cache.clear()
  await Promise.allSettled(pools.map((entry) => entry.pool.close()))
}

/** For diagnostics / tests. */
export function getCacheSize(): number {
  return cache.size
}
