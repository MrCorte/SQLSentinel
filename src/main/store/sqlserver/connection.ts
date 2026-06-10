import * as mssql from 'mssql'
import type { StorageConfig } from '../storageConfig'
import { getDecryptedPassword } from '../storageConfig'
import { createLogger } from '../../utils/logger'

let _pool: mssql.ConnectionPool | null = null
const log = createLogger('storage-connection')

function buildConfig(params: {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt?: boolean
  trustServerCertificate?: boolean
}): mssql.config {
  return {
    server: params.host,
    port: params.port,
    database: params.database,
    requestTimeout: 30000,
    // Storage pool sizing: default mssql max is 10. With multiple dashboard
    // tabs (charts + bulk + alerts) plus the worker save queue and the cleanup
    // job all hitting the same pool, 10 starves quickly. 20 is a comfortable
    // headroom; min=2 keeps two warm connections so first-request latency
    // doesn't pay the full TLS handshake cost.
    pool: { max: 20, min: 2, idleTimeoutMillis: 30000 },
    options: {
      encrypt: params.encrypt ?? false,
      trustServerCertificate: params.trustServerCertificate ?? true,
      connectTimeout: 15000
    },
    authentication: {
      type: 'default',
      options: { userName: params.username, password: params.password }
    }
  }
}

export async function initStoragePool(config: StorageConfig): Promise<void> {
  await initStoragePoolFromParams({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: getDecryptedPassword(config),
    encrypt: config.encrypt,
    trustServerCertificate: config.trustServerCertificate
  })
}

/**
 * Initialise the module-level pool from raw params (plaintext password).
 * Use during the storage setup wizard where credentials haven't been persisted yet.
 */
export async function initStoragePoolFromParams(params: {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt?: boolean
  trustServerCertificate?: boolean
}): Promise<void> {
  if (_pool) {
    await _pool.close().catch((err) => log.warn('[storage] replacing pool close failed:', err))
    _pool = null
  }
  // Dedicated pool — never mssql.connect(): the global pool ignores the config
  // on subsequent calls and any stray close() elsewhere would kill storage.
  _pool = await new mssql.ConnectionPool(buildConfig(params)).connect()
}

export function getPool(): mssql.ConnectionPool {
  if (!_pool) throw new Error('Storage pool not initialized. Call initStoragePool() first.')
  return _pool
}

export async function closeStoragePool(): Promise<void> {
  if (_pool) {
    await _pool.close().catch((err) => log.warn('[storage] closeStoragePool failed:', err))
    _pool = null
  }
}

/** One-shot connection test — does NOT set the module-level pool. */
export async function testConnection(params: {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt?: boolean
  trustServerCertificate?: boolean
}): Promise<void> {
  const cfg = buildConfig(params)
  const TIMEOUT_MS = 10000

  let timeoutHandle: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('Connection timed out after 10s')),
      TIMEOUT_MS
    )
  })

  // Dedicated pool — mssql.connect() would return the already-open storage
  // pool (config ignored) and the close() below would tear it down.
  const connect = new mssql.ConnectionPool({
    ...cfg,
    connectionTimeout: TIMEOUT_MS,
    requestTimeout: TIMEOUT_MS,
    options: { ...cfg.options, connectTimeout: TIMEOUT_MS }
  }).connect()

  // If timeout wins the race, the connect promise is still in flight.
  // When it eventually resolves, close the pool so the TCP connection
  // doesn't leak. If connect rejects later, swallow it.
  let timedOut = false
  connect
    .then((p) => {
      if (timedOut) {
        p.close().catch((err) => log.warn('[storage] timed-out test pool close failed:', err))
      }
    })
    .catch(() => {
      /* connect failed after timeout — already reported via thrown timeout */
    })

  try {
    const pool = await Promise.race([connect, timeout])
    if (timeoutHandle) clearTimeout(timeoutHandle)
    try {
      await pool.close()
    } catch {
      // best-effort close
    }
  } catch (err) {
    timedOut = true
    if (timeoutHandle) clearTimeout(timeoutHandle)
    throw err
  }
}
