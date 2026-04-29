import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

// vi.hoisted: all vars here are initialized BEFORE vi.mock factories run,
// which matters because serverStore.ts calls `new Store()` at module load time.
const hoisted = vi.hoisted(() => {
  const storeState = { data: {} as Record<string, unknown> }
  return {
    storeState,
    mockStoreGet: vi.fn((key: string, def?: unknown) => storeState.data[key] ?? def),
    mockStoreSet: vi.fn((key: string, value: unknown) => {
      storeState.data[key] = value
    })
  }
})

// electron-store: in-memory singleton — use function() so it can be called with `new`
vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      get: hoisted.mockStoreGet,
      set: hoisted.mockStoreSet,
      path: '/tmp/sql-sentinel-data.json'
    }
  })
}))

// safeStorageUtil: symmetric round-trip with a prefix
vi.mock('../store/safeStorageUtil', () => ({
  encrypt: vi.fn((s: string) => `ENC:${s}`),
  decrypt: vi.fn((s: string) => (s.startsWith('ENC:') ? s.slice(4) : s)),
  isAvailable: vi.fn(() => true)
}))

// node:fs — prevent any disk writes
vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn()
}))

// ── Load module ───────────────────────────────────────────────────────────────

import {
  add,
  getAll,
  getById,
  getByIpPort,
  update,
  remove,
  stripCredentials,
  upsertByIpPort,
  exportForBackup,
  importFromBackup,
  migrateHostField,
  migrateEncryptCredentials,
  writeAutoBackup
} from '../store/serverStore'
import type { StoredServer } from '../../preload/index'
import { writeFileSync } from 'node:fs'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRaw(overrides: Partial<StoredServer> = {}): StoredServer {
  return {
    id: 'test-id',
    host: '10.0.0.1',
    port: 1433,
    useWindowsAuth: true,
    addedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.storeState.data = {}
})

// ── add ───────────────────────────────────────────────────────────────────────

describe('add', () => {
  it('adds a new server successfully', () => {
    hoisted.mockStoreGet.mockImplementation((key, def) => hoisted.storeState.data[key] ?? def ?? [])
    const result = add({ host: '10.0.0.1', port: 1433, useWindowsAuth: true })
    expect(result.success).toBe(true)
    expect(result.server).toBeDefined()
    expect(result.server?.host).toBe('10.0.0.1')
    expect(hoisted.mockStoreSet).toHaveBeenCalledOnce()
  })

  it('fails when host is missing', () => {
    const result = add({ port: 1433, useWindowsAuth: true })
    expect(result.success).toBe(false)
    expect(result.reason).toBe('missing host')
  })

  it('rejects duplicates (same host+port)', () => {
    const existing = makeRaw()
    hoisted.mockStoreGet.mockReturnValue([existing])
    const result = add({ host: '10.0.0.1', port: 1433, useWindowsAuth: true })
    expect(result.success).toBe(false)
    expect(result.reason).toBe('duplicate')
  })

  it('encrypts the password before persisting (no plaintext on disk)', () => {
    hoisted.mockStoreGet.mockImplementation((key, def) => hoisted.storeState.data[key] ?? def ?? [])
    add({ host: '10.0.0.2', port: 1433, useWindowsAuth: false, password: 'secret' })
    const saved = hoisted.storeState.data['servers'] as StoredServer[]
    expect(saved[0].password).toBeUndefined()
    expect(saved[0].encryptedPassword).toBe('ENC:secret')
  })

  it('accepts legacy ip field via normalizeServer', () => {
    hoisted.mockStoreGet.mockImplementation((key, def) => hoisted.storeState.data[key] ?? def ?? [])
    const result = add({ ip: '10.0.0.3', port: 1433, useWindowsAuth: true } as never)
    expect(result.success).toBe(true)
    expect(result.server?.host).toBe('10.0.0.3')
  })
})

// ── getAll / getById / getByIpPort ────────────────────────────────────────────

describe('getAll', () => {
  it('decrypts encryptedPassword when reading', () => {
    const raw = makeRaw({ encryptedPassword: 'ENC:my-password' })
    hoisted.mockStoreGet.mockReturnValue([raw])
    const servers = getAll()
    expect(servers[0].password).toBe('my-password')
  })

  it('normalizes legacy ip → host on read', () => {
    const raw = { id: 'x', ip: '10.0.0.5', port: 1433, useWindowsAuth: true, addedAt: '' }
    hoisted.mockStoreGet.mockReturnValue([raw])
    const servers = getAll()
    expect(servers[0].host).toBe('10.0.0.5')
  })
})

describe('getById', () => {
  it('returns matching server by id', () => {
    hoisted.mockStoreGet.mockReturnValue([makeRaw({ id: 'abc', encryptedPassword: 'ENC:pw' })])
    const s = getById('abc')
    expect(s).toBeDefined()
    expect(s?.id).toBe('abc')
    expect(s?.password).toBe('pw')
  })

  it('returns undefined for unknown id', () => {
    hoisted.mockStoreGet.mockReturnValue([])
    expect(getById('nonexistent')).toBeUndefined()
  })
})

describe('getByIpPort', () => {
  it('finds a server by host and port', () => {
    hoisted.mockStoreGet.mockReturnValue([makeRaw({ host: '10.0.0.1', port: 1433 })])
    const s = getByIpPort('10.0.0.1', 1433)
    expect(s).toBeDefined()
  })

  it('returns undefined for unknown host:port', () => {
    hoisted.mockStoreGet.mockReturnValue([])
    expect(getByIpPort('99.99.99.99', 1433)).toBeUndefined()
  })
})

// ── update ────────────────────────────────────────────────────────────────────

describe('update', () => {
  it('patches the matching server in the store', () => {
    const initial = [makeRaw({ id: 'srv-1', host: '10.0.0.1' })]
    hoisted.mockStoreGet.mockReturnValue(initial)
    update('srv-1', { notes: 'production DB' })
    const saved = hoisted.storeState.data['servers'] as StoredServer[]
    expect(saved[0].notes).toBe('production DB')
  })

  it('encrypts updated password before saving', () => {
    hoisted.mockStoreGet.mockReturnValue([makeRaw({ id: 'srv-1' })])
    update('srv-1', { password: 'new-pass' })
    const saved = hoisted.storeState.data['servers'] as StoredServer[]
    expect(saved[0].password).toBeUndefined()
    expect(saved[0].encryptedPassword).toBe('ENC:new-pass')
  })

  it('is a no-op for unknown id', () => {
    hoisted.mockStoreGet.mockReturnValue([])
    expect(() => update('unknown', { notes: 'x' })).not.toThrow()
  })
})

// ── remove ────────────────────────────────────────────────────────────────────

describe('remove', () => {
  it('removes the server with the given id', () => {
    const initial = [makeRaw({ id: 'del-me' }), makeRaw({ id: 'keep-me', host: '10.0.0.2' })]
    hoisted.mockStoreGet.mockReturnValue(initial)
    remove('del-me')
    const saved = hoisted.storeState.data['servers'] as StoredServer[]
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe('keep-me')
  })
})

// ── stripCredentials ──────────────────────────────────────────────────────────

describe('stripCredentials', () => {
  it('removes both password and encryptedPassword', () => {
    const srv = makeRaw({ password: 'plain', encryptedPassword: 'ENC:plain' })
    const stripped = stripCredentials(srv)
    expect(stripped.password).toBeUndefined()
    expect(stripped.encryptedPassword).toBeUndefined()
  })

  it('preserves all other fields', () => {
    const srv = makeRaw({ notes: 'important', host: '10.0.0.99' })
    const stripped = stripCredentials(srv)
    expect(stripped.notes).toBe('important')
    expect(stripped.host).toBe('10.0.0.99')
  })
})

// ── upsertByIpPort ────────────────────────────────────────────────────────────

describe('upsertByIpPort', () => {
  it('inserts when no existing server matches host:port', () => {
    hoisted.mockStoreGet.mockImplementation((key, def) => hoisted.storeState.data[key] ?? def ?? [])
    const result = upsertByIpPort({ host: '10.0.0.1', port: 1433, useWindowsAuth: true })
    expect(result.host).toBe('10.0.0.1')
    const saved = hoisted.storeState.data['servers'] as StoredServer[]
    expect(saved).toHaveLength(1)
  })

  it('updates when server already exists', () => {
    const existing = makeRaw({ host: '10.0.0.1', port: 1433, notes: 'old' })
    hoisted.mockStoreGet.mockReturnValue([existing])
    upsertByIpPort({ host: '10.0.0.1', port: 1433, useWindowsAuth: true, notes: 'updated' })
    const saved = hoisted.storeState.data['servers'] as StoredServer[]
    expect(saved[0].notes).toBe('updated')
  })
})

// ── exportForBackup / importFromBackup ────────────────────────────────────────

describe('exportForBackup', () => {
  it('returns valid JSON with version=1 and no credentials', () => {
    const srv = makeRaw({ password: 'secret', encryptedPassword: 'ENC:secret', notes: 'prod' })
    hoisted.mockStoreGet.mockReturnValue([srv])
    const json = exportForBackup()
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(1)
    expect(parsed.servers).toHaveLength(1)
    expect(parsed.servers[0].password).toBeUndefined()
    expect(parsed.servers[0].encryptedPassword).toBeUndefined()
    expect(parsed.servers[0].notes).toBe('prod')
  })
})

describe('importFromBackup', () => {
  it('returns error on invalid JSON', () => {
    const result = importFromBackup('not json')
    expect(result.errors).toHaveLength(1)
    expect(result.imported).toBe(0)
  })

  it('returns error on unrecognized format', () => {
    const result = importFromBackup(JSON.stringify({ version: 99 }))
    expect(result.errors).toHaveLength(1)
  })

  it('imports new servers successfully', () => {
    hoisted.mockStoreGet.mockImplementation((key, def) => hoisted.storeState.data[key] ?? def ?? [])
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: [{ host: '10.0.0.50', port: 1433, useWindowsAuth: true }]
    })
    const result = importFromBackup(backup)
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('skips entries that already exist (no duplicate)', () => {
    hoisted.mockStoreGet.mockReturnValue([makeRaw({ host: '10.0.0.1', port: 1433 })])
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: [{ host: '10.0.0.1', port: 1433, useWindowsAuth: true }]
    })
    const result = importFromBackup(backup)
    expect(result.skipped).toBe(1)
    expect(result.imported).toBe(0)
  })

  it('reports error for entries with missing host', () => {
    hoisted.mockStoreGet.mockImplementation((key, def) => hoisted.storeState.data[key] ?? def ?? [])
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: [{ port: 1433 }]
    })
    const result = importFromBackup(backup)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.imported).toBe(0)
  })
})

// ── migrateHostField ──────────────────────────────────────────────────────────

describe('migrateHostField', () => {
  it('converts ip-only records to host field', () => {
    const legacy = [{ id: 'x', ip: '10.0.0.1', port: 1433, useWindowsAuth: true, addedAt: '' }]
    hoisted.mockStoreGet.mockReturnValue(legacy)
    migrateHostField()
    const saved = hoisted.storeState.data['servers'] as StoredServer[]
    expect(saved[0].host).toBe('10.0.0.1')
    expect((saved[0] as Record<string, unknown>)['ip']).toBeUndefined()
  })

  it('is a no-op when all records already have host', () => {
    const current = [makeRaw()]
    hoisted.mockStoreGet.mockReturnValue(current)
    migrateHostField()
    expect(hoisted.mockStoreSet).not.toHaveBeenCalled()
  })
})

// ── migrateEncryptCredentials ─────────────────────────────────────────────────

describe('migrateEncryptCredentials', () => {
  it('encrypts plaintext password and removes the plaintext field', () => {
    const legacy = [
      { id: 'x', host: '10.0.0.1', port: 1433, useWindowsAuth: false, password: 'p@ss', addedAt: '' }
    ]
    hoisted.mockStoreGet.mockReturnValue(legacy)
    migrateEncryptCredentials()
    const saved = hoisted.storeState.data['servers'] as StoredServer[]
    expect(saved[0].password).toBeUndefined()
    expect(saved[0].encryptedPassword).toBe('ENC:p@ss')
  })

  it('skips records that already have encryptedPassword', () => {
    const already = [makeRaw({ encryptedPassword: 'ENC:already' })]
    hoisted.mockStoreGet.mockReturnValue(already)
    migrateEncryptCredentials()
    expect(hoisted.mockStoreSet).not.toHaveBeenCalled()
  })
})

// ── writeAutoBackup ───────────────────────────────────────────────────────────

describe('writeAutoBackup', () => {
  it('writes a JSON file without credentials', () => {
    hoisted.mockStoreGet.mockReturnValue([makeRaw({ password: 'secret' })])
    writeAutoBackup()
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledOnce()
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
    expect(written.version).toBe(1)
    expect(written.servers[0].password).toBeUndefined()
  })

  it('does not throw when writeFileSync fails', () => {
    hoisted.mockStoreGet.mockReturnValue([makeRaw()])
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => writeAutoBackup()).not.toThrow()
  })
})
