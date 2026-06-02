import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { IpcChannel } from '../types'
import type {
  StorageConnectionParams,
  StorageConfigInfo,
  IpcResult,
  SchemaInitResult
} from '../types'
import { getStorageConfig, saveStorageConfig } from '../../store/storageConfig'
import { isAvailable as safeStorageAvailable } from '../../utils/safeStorageUtil'
import {
  testConnection,
  initStoragePoolFromParams,
  closeStoragePool
} from '../../store/sqlserver/connection'
import { initSchema } from '../../store/sqlserver/database'
import { initDefaultAdmin } from '../../authService'
import { sanitizeSqlError } from '../../collectors/sqlCollector'

function validateConnectionParams(params: unknown): asserts params is StorageConnectionParams {
  if (!params || typeof params !== 'object') {
    throw new Error('Invalid request: connection params required')
  }
  const p = params as Record<string, unknown>
  if (typeof p.host !== 'string' || p.host.length === 0 || p.host.length > 253) {
    throw new Error('Invalid host')
  }
  if (typeof p.port !== 'number' || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535) {
    throw new Error('Invalid port')
  }
  if (typeof p.database !== 'string' || p.database.length === 0 || p.database.length > 128) {
    throw new Error('Invalid database name')
  }
  if (typeof p.username !== 'string' || p.username.length > 128) {
    throw new Error('Invalid username')
  }
  if (typeof p.password !== 'string' || p.password.length > 256) {
    throw new Error('Invalid password')
  }
  if (p.encrypt !== undefined && typeof p.encrypt !== 'boolean') {
    throw new Error('Invalid encrypt flag')
  }
  if (p.trustServerCertificate !== undefined && typeof p.trustServerCertificate !== 'boolean') {
    throw new Error('Invalid trustServerCertificate flag')
  }
}

export function registerStorageHandlers(): void {
  handle(IpcChannel.STORAGE_GET_CONFIG, async (): Promise<IpcResult<StorageConfigInfo | null>> => {
    const cfg = getStorageConfig()
    if (!cfg) return { ok: true, data: null }
    // backward compat: older config may not have encrypt/trustServerCertificate
    const encrypt = cfg.encrypt ?? false
    const trustServerCertificate = cfg.trustServerCertificate ?? true
    return {
      ok: true,
      data: {
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        username: cfg.username,
        encrypt,
        trustServerCertificate
      }
    }
  })

  handle(
    IpcChannel.STORAGE_SAFE_STORAGE_STATUS,
    async (): Promise<IpcResult<{ available: boolean }>> => {
      return { ok: true, data: { available: safeStorageAvailable() } }
    }
  )

  handle(
    IpcChannel.STORAGE_TEST_CONNECTION,
    async (_e: IpcMainInvokeEvent, params: unknown): Promise<IpcResult<null>> => {
      try {
        validateConnectionParams(params)
        await testConnection(params)
        return { ok: true, data: null }
      } catch (err) {
        // Use sanitizeSqlError instead of safeError: tedious errors can include
        // the password in the connection-string echo on certain failures.
        const sanitized = sanitizeSqlError(err)
        log.error('[IPC] STORAGE_TEST_CONNECTION:', sanitized)
        return { ok: false, error: sanitized }
      }
    }
  )

  handle(
    IpcChannel.STORAGE_SAVE_CONFIG,
    async (_e: IpcMainInvokeEvent, params: unknown): Promise<IpcResult<SchemaInitResult>> => {
      try {
        validateConnectionParams(params)
        // No explicit testConnection here: initStoragePoolFromParams opens
        // the pool with the same credentials and would surface the same auth
        // / network failures. The wizard's separate STORAGE_TEST_CONNECTION
        // already validated the connection from the UI side, so this
        // pre-flight check was a duplicate TLS+TDS handshake (~500ms-1.5s on
        // remote SQL Servers) burnt for no extra safety.
        await initStoragePoolFromParams(params)

        // Persistence ordering: save the config BEFORE running schema +
        // bootstrap admin. Reasoning: every step below is idempotent and the
        // boot path in main/index.ts re-runs initSchema()/initDefaultAdmin()
        // every launch. So if we crash after saveStorageConfig but before
        // initSchema/initDefaultAdmin completes, the next launch finds a valid
        // config, reconnects, and finishes the bootstrap automatically.
        // The previous order saved the config LAST — a DPAPI write failure
        // there left an unreachable schema + bootstrap admin on the target
        // SQL Server with no way to resume.
        saveStorageConfig(params)
        const schemaResult = await initSchema()
        await initDefaultAdmin()
        return { ok: true, data: schemaResult }
      } catch (err) {
        // Rollback the live pool so subsequent retries get a fresh attempt.
        await closeStoragePool().catch((closeErr) => {
          log.warn('[IPC] STORAGE_SAVE_CONFIG rollback closeStoragePool:', safeError(closeErr))
        })
        const sanitized = sanitizeSqlError(err)
        log.error('[IPC] STORAGE_SAVE_CONFIG:', sanitized)
        return { ok: false, error: sanitized }
      }
    }
  )
}
// safeError export retained for compatibility with sibling handlers
void safeError
