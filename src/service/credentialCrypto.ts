import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const SALT = 'sqlsentinel-credential-v1'
const KEY_LEN = 32

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_LEN)
}

/** Encrypts plaintext. Output format: base64(iv[12] + authTag[16] + ciphertext) */
export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/** Decrypts ciphertext produced by encrypt(). Throws on auth failure or wrong key. */
export function decrypt(ciphertext: string, secret: string): string {
  const key = deriveKey(secret)
  const buf = Buffer.from(ciphertext, 'base64')
  if (buf.length < 28) throw new Error('Invalid ciphertext length')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
