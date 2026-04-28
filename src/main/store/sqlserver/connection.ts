import * as mssql from 'mssql'
import type { StorageConfig } from '../storageConfig'
import { getDecryptedPassword } from '../storageConfig'

let _pool: mssql.ConnectionPool | null = null

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
  if (_pool) {
    await _pool.close().catch(() => {})
  }
  _pool = await mssql.connect(
    buildConfig({
      host: config.host,
      port: config.port,
      database: config.database,
      username: config.username,
      password: getDecryptedPassword(config),
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate
    })
  )
}

export function getPool(): mssql.ConnectionPool {
  if (!_pool)
    throw new Error(
      'Storage pool not initialized. Call initStoragePool() first.'
    )
  return _pool
}

export async function closeStoragePool(): Promise<void> {
  if (_pool) {
    await _pool.close().catch(() => {})
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
  const pool = await mssql.connect({
    ...cfg,
    requestTimeout: 10000,
    options: { ...cfg.options, connectTimeout: 10000 }
  })
  await pool.close()
}
