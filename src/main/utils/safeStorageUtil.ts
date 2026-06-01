import { safeStorage } from 'electron'
import { createLogger } from './logger'
const log = createLogger('safe-storage')

/**
 * Thrown when callers try to encrypt while OS-level safeStorage is unavailable.
 * IPC handlers catch this and surface a "configure your keyring" message to the
 * user instead of silently writing plaintext to disk.
 */
export class SafeStorageUnavailableError extends Error {
  constructor() {
    super(
      'OS keyring/DPAPI is not available — refusing to store credentials in plaintext. ' +
        'On Linux install libsecret and unlock the keyring; on Windows verify DPAPI/profile support.'
    )
    this.name = 'SafeStorageUnavailableError'
  }
}

export function isAvailable(): boolean {
  return safeStorage?.isEncryptionAvailable?.() === true
}

export function encrypt(plain: string): string {
  if (!isAvailable()) {
    log.error(
      '[safeStorage] encrypt() refused: OS keyring/DPAPI unavailable. Caller must surface this to the user.'
    )
    throw new SafeStorageUnavailableError()
  }
  return safeStorage!.encryptString(plain).toString('base64')
}

export function decrypt(stored: string): string {
  // Backward compat: legacy records may already be plaintext. We attempt to
  // decrypt; if the buffer is not a valid ciphertext (or safeStorage is off),
  // we return the value as-is so the caller can still read it. Only writes
  // are hardened — reads must remain forgiving.
  if (!isAvailable()) return stored
  try {
    return safeStorage!.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    // Not a ciphertext (legacy plaintext) or corrupted — return raw.
    return stored
  }
}

export function isEncrypted(stored: string): boolean {
  if (!stored || !isAvailable()) return false
  try {
    safeStorage!.decryptString(Buffer.from(stored, 'base64'))
    return true
  } catch {
    return false
  }
}
