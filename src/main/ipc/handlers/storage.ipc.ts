import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { IpcChannel } from '../types'
import type { StorageConnectionParams, StorageConfigInfo, IpcResult, SchemaInitResult } from '../types'
import { getStorageConfig, saveStorageConfig } from '../../store/storageConfig'
import { isAvailable as safeStorageAvailable } from '../../store/safeStorageUtil'
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
  handle(
    IpcChannel.STORAGE_GET_CONFIG,
    async (): Promise<IpcResult<StorageConfigInfo | null>> => {
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
    }
  )

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
    async (
      _e: IpcMainInvokeEvent,
      params: unknown
    ): Promise<IpcResult<SchemaInitResult>> => {
      try {
        validateConnectionParams(params)
        // Verify the connection before doing anything else.
        await testConnection(params)
        // Build the live pool from raw params — we'll only persist the config
        // once schema init + admin bootstrap fully succeed. This prevents a
        // half-broken setup from being read back on the next app launch.
        await initStoragePoolFromParams(params)
        const schemaResult = await initSchema()
        await initDefaultAdmin()
        saveStorageConfig(params)
        return { ok: true, data: schemaResult }
      } catch (err) {
        // Rollback the live pool so subsequent retries get a fresh attempt.
        await closeStoragePool().catch(() => {})
        const sanitized = sanitizeSqlError(err)
        log.error('[IPC] STORAGE_SAVE_CONFIG:', sanitized)
        return { ok: false, error: sanitized }
      }
    }
  )
}
// safeError export retained for compatibility with sibling handlers
void safeError
