import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { IpcChannel } from '../types'
import type { StorageConnectionParams, StorageConfigInfo, IpcResult } from '../types'
import { getStorageConfig, saveStorageConfig } from '../../store/storageConfig'
import { testConnection, initStoragePool } from '../../store/sqlserver/connection'
import { initSchema } from '../../store/sqlserver/database'
import { initDefaultAdmin } from '../../authService'

export function registerStorageHandlers(): void {
  handle(
    IpcChannel.STORAGE_GET_CONFIG,
    async (): Promise<IpcResult<StorageConfigInfo | null>> => {
      const cfg = getStorageConfig()
      if (!cfg) return { ok: true, data: null }
      return {
        ok: true,
        data: { host: cfg.host, port: cfg.port, database: cfg.database, username: cfg.username }
      }
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
    async (_e: IpcMainInvokeEvent, params: StorageConnectionParams): Promise<IpcResult<null>> => {
      try {
        await testConnection(params)
        saveStorageConfig(params)
        await initStoragePool(getStorageConfig()!)
        await initSchema()
        await initDefaultAdmin()
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] STORAGE_SAVE_CONFIG:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
