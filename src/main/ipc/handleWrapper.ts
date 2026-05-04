import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { isAuthenticated, isMustChangePassword } from '../authService'
import { getStorageConfig } from '../store/storageConfig'
import { IpcChannel } from './types'
import { createLogger } from '../utils/logger'

const log = createLogger('ipc')
export { log }

// Auth bypass in dev: only when SQLSENTINEL_DEV_BYPASS_AUTH=1 is set explicitly.
// Previously tied to !app.isPackaged, which left QA/preview builds wide-open.
const DEV_BYPASS_AUTH = process.env.SQLSENTINEL_DEV_BYPASS_AUTH === '1'

// Canali esenti dal check auth: usati prima del login o che implementano il login stesso.
// SETTINGS_GET esente per permettere il caricamento del tema prima del login.
// SETTINGS_SET rimosso: scrivere impostazioni richiede autenticazione.
// STORAGE_GET_CONFIG esente: il renderer la legge prima del login per decidere il flow.
const AUTH_EXEMPT_CHANNELS = new Set<string>([
  IpcChannel.APP_VERSION,
  IpcChannel.AUTH_LOGIN,
  IpcChannel.AUTH_LOGOUT,
  IpcChannel.AUTH_CHECK,
  IpcChannel.SETTINGS_GET,
  IpcChannel.STORAGE_GET_CONFIG
])

// Canali esenti SOLO finché lo storage non è configurato (bootstrap di prima
// installazione). Una volta che getStorageConfig() ritorna un oggetto, queste
// operazioni richiedono auth admin per evitare che chiunque rediriga lo storage.
const STORAGE_BOOTSTRAP_CHANNELS = new Set<string>([
  IpcChannel.STORAGE_TEST_CONNECTION,
  IpcChannel.STORAGE_SAVE_CONFIG
])

// Canali permessi anche quando must_change_password=1 (utente autenticato ma
// con credenziali di default). Blocca ogni altra operazione finché la password
// non viene effettivamente cambiata.
const MUST_CHANGE_PW_ALLOWED = new Set<string>([
  IpcChannel.AUTH_LOGIN,
  IpcChannel.AUTH_LOGOUT,
  IpcChannel.AUTH_CHECK,
  IpcChannel.AUTH_CHANGE_PASSWORD,
  IpcChannel.SETTINGS_GET,
  IpcChannel.STORAGE_GET_CONFIG
])

function isBootstrapAllowed(channel: string): boolean {
  if (!STORAGE_BOOTSTRAP_CHANNELS.has(channel)) return false
  try {
    return getStorageConfig() === null
  } catch {
    return false
  }
}

/**
 * Wrapper esplicito per ipcMain.handle che impone il check auth per
 * tutti i canali non presenti in AUTH_EXEMPT_CHANNELS. Sostituisce il
 * precedente monkey-patch di ipcMain.handle, che era fragile rispetto
 * all'ordine di registrazione.
 */
export function handle<R>(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => R | Promise<R>
): void {
  if (AUTH_EXEMPT_CHANNELS.has(channel)) {
    ipcMain.handle(channel, listener)
    return
  }
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!DEV_BYPASS_AUTH) {
      // Bootstrap channels are exempt only when storage isn't configured yet;
      // once configured they require auth like any admin channel.
      if (!isBootstrapAllowed(channel)) {
        if (!isAuthenticated()) throw new Error('UNAUTHORIZED')
        if (isMustChangePassword() && !MUST_CHANGE_PW_ALLOWED.has(channel)) {
          throw new Error('MUST_CHANGE_PASSWORD')
        }
      }
    }
    return listener(event, ...args)
  })
}

export function safeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
