import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../credentialCrypto'

const SECRET = 'a'.repeat(64) // 32-byte hex key

describe('credentialCrypto', () => {
  it('round-trips a password', () => {
    const plain = 'MyP@ssw0rd!'
    expect(decrypt(encrypt(plain, SECRET), SECRET)).toBe(plain)
  })

  it('produces different ciphertext each call (random IV)', () => {
    const plain = 'same-password'
    expect(encrypt(plain, SECRET)).not.toBe(encrypt(plain, SECRET))
  })

  it('throws on tampered ciphertext', () => {
    const cipher = encrypt('secret', SECRET)
    const tampered = cipher.slice(0, -4) + 'AAAA'
    expect(() => decrypt(tampered, SECRET)).toThrow()
  })

  it('throws when decrypting with wrong secret', () => {
    const cipher = encrypt('secret', SECRET)
    const wrongSecret = 'b'.repeat(64)
    expect(() => decrypt(cipher, wrongSecret)).toThrow()
  })
})
