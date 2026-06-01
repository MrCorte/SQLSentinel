import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron safeStorage ─────────────────────────────────────────────────

const mockIsEncryptionAvailable = vi.fn()
const mockEncryptString = vi.fn()
const mockDecryptString = vi.fn()
const mockElectronState = vi.hoisted(() => ({ safeStorageMissing: false }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  get safeStorage() {
    if (mockElectronState.safeStorageMissing) return undefined
    return {
      isEncryptionAvailable: mockIsEncryptionAvailable,
      encryptString: mockEncryptString,
      decryptString: mockDecryptString
    }
  }
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('safeStorageUtil', () => {
  let isAvailable: typeof import('../utils/safeStorageUtil').isAvailable
  let encrypt: typeof import('../utils/safeStorageUtil').encrypt
  let decrypt: typeof import('../utils/safeStorageUtil').decrypt
  let isEncrypted: typeof import('../utils/safeStorageUtil').isEncrypted

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockElectronState.safeStorageMissing = false
    ;({ isAvailable, encrypt, decrypt, isEncrypted } = await import('../utils/safeStorageUtil'))
  })

  // ── isAvailable ─────────────────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('returns true when safeStorage reports encryption available', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      expect(isAvailable()).toBe(true)
    })

    it('returns false when safeStorage reports unavailable', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      expect(isAvailable()).toBe(false)
    })

    it('returns false when Electron does not expose safeStorage in this process', async () => {
      vi.resetModules()
      mockElectronState.safeStorageMissing = true
      ;({ isAvailable } = await import('../utils/safeStorageUtil'))

      expect(isAvailable()).toBe(false)
    })
  })

  // ── encrypt ─────────────────────────────────────────────────────────────────

  describe('encrypt', () => {
    it('returns base64 string when encryption is available', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      const fakeBuffer = Buffer.from('encrypted_bytes')
      mockEncryptString.mockReturnValue(fakeBuffer)
      const result = encrypt('my-secret')
      expect(result).toBe(fakeBuffer.toString('base64'))
      expect(mockEncryptString).toHaveBeenCalledWith('my-secret')
    })

    it('throws SafeStorageUnavailableError when encryption is unavailable', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      expect(() => encrypt('my-secret')).toThrow(/keyring|DPAPI|unavailable/i)
      expect(mockEncryptString).not.toHaveBeenCalled()
    })
  })

  // ── decrypt ─────────────────────────────────────────────────────────────────

  describe('decrypt', () => {
    it('decodes base64 and returns plaintext when available', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockDecryptString.mockReturnValue('decrypted-secret')
      const stored = Buffer.from('some_bytes').toString('base64')
      const result = decrypt(stored)
      expect(result).toBe('decrypted-secret')
      expect(mockDecryptString).toHaveBeenCalled()
    })

    it('returns stored value as-is when unavailable', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      const result = decrypt('plain-stored')
      expect(result).toBe('plain-stored')
      expect(mockDecryptString).not.toHaveBeenCalled()
    })

    it('returns the stored value as-is when decryptString throws (legacy plaintext)', () => {
      // Reads are intentionally forgiving — legacy records may already be
      // plaintext in the store. We must not throw on read or the user can
      // never recover their data after migrating the keyring.
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockDecryptString.mockImplementation(() => {
        throw new Error('keyring error')
      })
      const stored = Buffer.from('legacy-plaintext').toString('base64')
      expect(decrypt(stored)).toBe(stored)
    })
  })

  // ── isEncrypted ─────────────────────────────────────────────────────────────

  describe('isEncrypted', () => {
    it('returns true for a string that can be successfully decrypted', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockDecryptString.mockReturnValue('some-value')
      const stored = Buffer.from('valid_bytes').toString('base64')
      expect(isEncrypted(stored)).toBe(true)
    })

    it('returns false when decryptString throws (corrupted data)', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockDecryptString.mockImplementation(() => {
        throw new Error('cannot decrypt')
      })
      const stored = Buffer.from('corrupt').toString('base64')
      expect(isEncrypted(stored)).toBe(false)
    })

    it('returns false when safeStorage is unavailable', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      expect(isEncrypted('anything')).toBe(false)
    })

    it('returns false for empty string', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      expect(isEncrypted('')).toBe(false)
    })
  })
})
