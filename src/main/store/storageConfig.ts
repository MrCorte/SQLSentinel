import Store from 'electron-store'
import { encrypt, decrypt } from '../utils/safeStorageUtil'
import { createLogger } from '../utils/logger'

const log = createLogger('storage-config')

export interface StorageConfig {
  host: string
  port: number
  database: string
  username: string
  encryptedPassword: string
  encrypt: boolean
  trustServerCertificate: boolean
}

interface StorageConfigStore {
  config: StorageConfig | null
}

// Fuori da Electron (service forked / Windows Service) electron-store risolve
// una config-dir diversa da userData e il service moriva al boot con "Storage
// not configured". Il processo host passa la dir giusta via env (vedi il fork
// in src/main/index.ts e l'installer del servizio).
const storeCwd = process.env.SQLSENTINEL_USERDATA
const store = new Store<StorageConfigStore>({
  name: 'sql-sentinel-storage-config',
  defaults: { config: null },
  ...(storeCwd ? { cwd: storeCwd } : {})
})

export function getStorageConfig(): StorageConfig | null {
  return store.get('config', null)
}

export function saveStorageConfig(
  params: Omit<StorageConfig, 'encryptedPassword' | 'encrypt' | 'trustServerCertificate'> & {
    password: string
    encrypt?: boolean
    trustServerCertificate?: boolean
  }
): void {
  const { password, ...rest } = params
  // encrypt() throws SafeStorageUnavailableError when DPAPI/keyring is missing.
  // We do not catch — the IPC handler surfaces the error to the user instead of
  // silently writing the plaintext password to disk.
  const encryptedPassword = encrypt(password)
  log.debug('[storageConfig] saving with encrypted password')
  store.set('config', {
    ...rest,
    encrypt: rest.encrypt ?? false,
    trustServerCertificate: rest.trustServerCertificate ?? true,
    encryptedPassword
  })
}

export function clearStorageConfig(): void {
  store.set('config', null)
}

export function getDecryptedPassword(config: StorageConfig): string {
  return decrypt(config.encryptedPassword)
}
