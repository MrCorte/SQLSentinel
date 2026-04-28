import Store from 'electron-store'
import { encrypt, decrypt } from './safeStorageUtil'

export interface StorageConfig {
  host: string
  port: number
  database: string
  username: string
  encryptedPassword: string
}

interface StorageConfigStore {
  config: StorageConfig | null
}

const store = new Store<StorageConfigStore>({
  name: 'sql-sentinel-storage-config',
  defaults: { config: null }
})

export function getStorageConfig(): StorageConfig | null {
  return store.get('config', null)
}

export function saveStorageConfig(
  params: Omit<StorageConfig, 'encryptedPassword'> & { password: string }
): void {
  const { password, ...rest } = params
  store.set('config', { ...rest, encryptedPassword: encrypt(password) })
}

export function clearStorageConfig(): void {
  store.set('config', null)
}

export function getDecryptedPassword(config: StorageConfig): string {
  return decrypt(config.encryptedPassword)
}
