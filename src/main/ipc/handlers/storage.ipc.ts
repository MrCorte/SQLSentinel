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
    async (_e: IpcMainInvokeEvent, params: StorageConnectionParams): Promise<IpcResult<null>> => {
      try {
        await testConnection(params)
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] STORAGE_TEST_CONNECTION:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(
    IpcChannel.STORAGE_SAVE_CONFIG,
    async (
      _e: IpcMainInvokeEvent,
      params: StorageConnectionParams
    ): Promise<IpcResult<SchemaInitResult>> => {
      try {
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
        log.error('[IPC] STORAGE_SAVE_CONFIG:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
