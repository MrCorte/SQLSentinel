import { safeStorage } from 'electron'
import { createLogger } from '../utils/logger'
const log = createLogger('safe-storage')

let warned = false

function warnOnce(): void {
  if (warned) return
  warned = true
  log.error(
    '[safeStorage] ENCRYPTION UNAVAILABLE on this OS/profile — secrets will be stored in plaintext. ' +
      'On Linux ensure libsecret is installed and a keyring is unlocked; on Windows ensure the user profile supports DPAPI.'
  )
}

export function isAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encrypt(plain: string): string {
  if (!isAvailable()) {
    warnOnce()
    return plain
  }
  return safeStorage.encryptString(plain).toString('base64')
}

export function decrypt(stored: string): string {
  if (!isAvailable()) {
    warnOnce()
    return stored
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}

export function isEncrypted(stored: string): boolean {
  if (!stored || !isAvailable()) return false
  try {
    safeStorage.decryptString(Buffer.from(stored, 'base64'))
    return true
  } catch {
    return false
  }
}
