import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))
vi.mock('electron-store', () => {
  let data: Record<string, unknown> = {}
  return {
    default: class {
      get(key: string, def: unknown) {
        return data[key] ?? def
      }
      set(key: string, val: unknown) {
        data[key] = val
      }
      clear() {
        data = {}
      }
    }
  }
})

import { getStorageConfig, saveStorageConfig, clearStorageConfig } from '../storageConfig'

describe('storageConfig', () => {
  beforeEach(() => clearStorageConfig())

  it('returns null when no config saved', () => {
    expect(getStorageConfig()).toBeNull()
  })

  it('saves and retrieves config', () => {
    saveStorageConfig({
      host: 'localhost',
      port: 1437,
      database: 'SQLSentinelDB',
      username: 'sa',
      password: 'test'
    })
    const cfg = getStorageConfig()
    expect(cfg).not.toBeNull()
    expect(cfg!.host).toBe('localhost')
    expect(cfg!.port).toBe(1437)
    expect(cfg!.encryptedPassword).toBeTruthy()
    expect(cfg!.encryptedPassword).not.toBe('test')
  })

  it('clears config', () => {
    saveStorageConfig({
      host: 'localhost',
      port: 1437,
      database: 'SQLSentinelDB',
      username: 'sa',
      password: 'test'
    })
    clearStorageConfig()
    expect(getStorageConfig()).toBeNull()
  })
})
