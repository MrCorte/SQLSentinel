import { ipcMain, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { isAuthenticated, isMustChangePassword } from '../authService'
import { IpcChannel } from './types'
import { createLogger } from '../utils/logger'

const log = createLogger('ipc')
export { log }

// In dev mode the renderer typically runs with VITE_MOCK_MODE=true, which means
// the UI bypasses the login flow — no real session is ever created in the main
// process. Skip auth checks so real IPC calls (e.g., AI) still work locally.
const DEV_BYPASS_AUTH = !app.isPackaged

// Canali esenti dal check auth: usati prima del login o che implementano il login stesso.
// SETTINGS_GET esente per permettere il caricamento del tema prima del login.
// SETTINGS_SET rimosso: scrivere impostazioni richiede autenticazione.
const AUTH_EXEMPT_CHANNELS = new Set<string>([
  IpcChannel.AUTH_LOGIN,
  IpcChannel.AUTH_LOGOUT,
  IpcChannel.AUTH_CHECK,
  IpcChannel.SETTINGS_GET
])

// Canali permessi anche quando must_change_password=1 (utente autenticato ma
// con credenziali di default). Blocca ogni altra operazione finché la password
// non viene effettivamente cambiata.
const MUST_CHANGE_PW_ALLOWED = new Set<string>([
  IpcChannel.AUTH_LOGIN,
  IpcChannel.AUTH_LOGOUT,
  IpcChannel.AUTH_CHECK,
  IpcChannel.AUTH_CHANGE_PASSWORD,
  IpcChannel.SETTINGS_GET
])

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
      if (!isAuthenticated()) throw new Error('UNAUTHORIZED')
      if (isMustChangePassword() && !MUST_CHANGE_PW_ALLOWED.has(channel)) {
        throw new Error('MUST_CHANGE_PASSWORD')
      }
    }
    return listener(event, ...args)
  })
}

export function safeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
