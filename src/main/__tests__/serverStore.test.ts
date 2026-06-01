/**
 * Tests for store/sqlserver/serverRepository.ts
 *
 * The mssql pool is replaced with an in-memory fake whose Request builder
 * records inputs and dispatches on the SQL text. We only need to support the
 * queries actually issued by the repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

let storedRows: Row[] = []

class FakeRequest {
  private inputs = new Map<string, unknown>()
  input(name: string, typeOrValue: unknown, maybeValue?: unknown): this {
    const value = arguments.length >= 3 ? maybeValue : typeOrValue
    this.inputs.set(name, value)
    return this
  }
  async query<T = unknown>(sqlText: string): Promise<{ recordset: T[] }> {
    const norm = sqlText.replace(/\s+/g, ' ').toLowerCase()
    if (norm.startsWith('select * from dbo.servers')) {
      return { recordset: storedRows.map(toCanonicalRow) as T[] }
    }
    if (norm.startsWith('insert into dbo.servers')) {
      const row: Row = {}
      for (const [k, v] of this.inputs) row[k] = v
      storedRows.push(row)
      return { recordset: [] as T[] }
    }
    if (norm.startsWith('update dbo.servers')) {
      const id = this.inputs.get('id') as string
      const target = storedRows.find((r) => r['id'] === id)
      if (target) {
        // Parse the SET clause: "column = @param, column2 = @param2 WHERE ..."
        const setMatch = /set\s+(.+?)\s+where/i.exec(sqlText)
        if (setMatch) {
          for (const assignment of setMatch[1].split(',')) {
            const m = /\s*(\w+)\s*=\s*@(\w+)/.exec(assignment)
            if (!m) continue
            const [, col, param] = m
            target[col] = this.inputs.get(param) as unknown
          }
        }
      }
      return { recordset: [] as T[] }
    }
    if (norm.startsWith('delete from dbo.servers')) {
      const id = this.inputs.get('id') as string
      storedRows = storedRows.filter((r) => r['id'] !== id)
      return { recordset: [] as T[] }
    }
    return { recordset: [] as T[] }
  }
}

// Cast a row from "insert-shape" (named after parameter names) to the
// snake_case column shape consumed by rowToServer.
function toCanonicalRow(r: Row): Row {
  // Insert path stores parameter names (id, host, port, instance_name, ...)
  // — already in snake_case so we can return as-is.
  return r
}

const fakePool = { request: () => new FakeRequest() }

vi.mock('../store/sqlserver/connection', () => ({
  getPool: () => fakePool
}))

vi.mock('../utils/safeStorageUtil', () => ({
  encrypt: vi.fn((s: string) => `ENC:${s}`),
  decrypt: vi.fn((s: string) => (s.startsWith('ENC:') ? s.slice(4) : s)),
  isAvailable: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' }
}))

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn()
}))

import {
  init,
  add,
  getAll,
  getById,
  getByIpPort,
  update,
  remove,
  stripCredentials,
  upsertByIpPort,
  exportForBackup,
  importFromBackup
} from '../store/sqlserver/serverRepository'

beforeEach(async () => {
  storedRows = []
  await init() // load the (empty) cache
})

function seed(row: Partial<{ id: string; host: string; port: number; use_windows_auth: number; encrypted_password: string | null; added_at: string; notes: string | null }>): void {
  storedRows.push({
    id: row.id ?? 'test-id',
    host: row.host ?? '10.0.0.1',
    port: row.port ?? 1433,
    instance_name: null,
    use_windows_auth: row.use_windows_auth ?? 1,
    username: null,
    encrypted_password: row.encrypted_password ?? null,
    added_at: row.added_at ?? '2024-01-01T00:00:00.000Z',
    last_seen: null,
    unreachable: 0,
    unreachable_since: null,
    machine_name: null,
    ag_group_id: null,
    ag_name: null,
    ag_role: null,
    logical_cpus: null,
    physical_cpus: null,
    hosting_type: null,
    notes: row.notes ?? null
  })
}

describe('add', () => {
  it('adds a new server successfully', async () => {
    const result = await add({ host: '10.0.0.1', port: 1433, useWindowsAuth: true })
    expect(result.success).toBe(true)
    expect(result.server?.host).toBe('10.0.0.1')
    expect(storedRows).toHaveLength(1)
  })

  it('fails when host is missing', async () => {
    const result = await add({ port: 1433, useWindowsAuth: true })
    expect(result.success).toBe(false)
    expect(result.reason).toBe('missing host')
  })

  it.each([
    { host: '', port: 1433, reason: 'missing host' },
    { host: 'bad host with spaces', port: 1433, reason: 'invalid host' },
    { host: '10.0.0.1', port: 0, reason: 'invalid port' },
    { host: '10.0.0.1', port: 65536, reason: 'invalid port' },
    { host: '10.0.0.1', port: 1433.5, reason: 'invalid port' },
    { host: '10.0.0.1', port: 1433, useWindowsAuth: 'yes', reason: 'invalid auth mode' }
  ])('rejects malformed server input %#', async (params) => {
    const result = await add(params)
    expect(result.success).toBe(false)
    expect(result.reason).toBe(params.reason)
    expect(storedRows).toHaveLength(0)
  })

  it('rejects duplicates (same host+port)', async () => {
    seed({ host: '10.0.0.1', port: 1433 })
    await init()
    const result = await add({ host: '10.0.0.1', port: 1433, useWindowsAuth: true })
    expect(result.success).toBe(false)
    expect(result.reason).toBe('duplicate')
  })

  it('encrypts the password before persisting (no plaintext on disk)', async () => {
    await add({ host: '10.0.0.2', port: 1433, useWindowsAuth: false, password: 'secret' })
    expect(storedRows[0].encrypted_password).toBe('ENC:secret')
  })

  it('accepts legacy ip field via normalizeServer', async () => {
    const result = await add({ ip: '10.0.0.3', port: 1433, useWindowsAuth: true } as never)
    expect(result.success).toBe(true)
    expect(result.server?.host).toBe('10.0.0.3')
  })
})

describe('getAll', () => {
  it('decrypts encryptedPassword when reading', async () => {
    seed({ encrypted_password: 'ENC:my-password' })
    await init()
    const servers = getAll()
    expect(servers[0].password).toBe('my-password')
  })
})

describe('getById', () => {
  it('returns matching server by id', async () => {
    seed({ id: 'abc', encrypted_password: 'ENC:pw' })
    await init()
    const s = getById('abc')
    expect(s).toBeDefined()
    expect(s?.id).toBe('abc')
    expect(s?.password).toBe('pw')
  })

  it('returns undefined for unknown id', () => {
    expect(getById('nonexistent')).toBeUndefined()
  })
})

describe('getByIpPort', () => {
  it('finds a server by host and port', async () => {
    seed({ host: '10.0.0.1', port: 1433 })
    await init()
    expect(getByIpPort('10.0.0.1', 1433)).toBeDefined()
  })

  it('returns undefined for unknown host:port', () => {
    expect(getByIpPort('99.99.99.99', 1433)).toBeUndefined()
  })
})

describe('update', () => {
  it('patches the matching server in the store', async () => {
    seed({ id: 'srv-1', host: '10.0.0.1' })
    await init()
    await update('srv-1', { notes: 'production DB' })
    expect(storedRows[0].notes).toBe('production DB')
  })

  it('encrypts updated password before saving', async () => {
    seed({ id: 'srv-1' })
    await init()
    await update('srv-1', { password: 'new-pass' })
    expect(storedRows[0].encrypted_password).toBe('ENC:new-pass')
  })

  it('is a no-op for unknown id', async () => {
    await expect(update('unknown', { notes: 'x' })).resolves.not.toThrow()
  })
})

describe('remove', () => {
  it('removes the server with the given id', async () => {
    seed({ id: 'del-me' })
    seed({ id: 'keep-me', host: '10.0.0.2' })
    await init()
    await remove('del-me')
    expect(storedRows).toHaveLength(1)
    expect(storedRows[0].id).toBe('keep-me')
  })
})

describe('stripCredentials', () => {
  it('removes both password and encryptedPassword', () => {
    const stripped = stripCredentials({
      id: 't',
      host: '10.0.0.1',
      port: 1433,
      useWindowsAuth: false,
      addedAt: '2024',
      password: 'plain',
      encryptedPassword: 'ENC:plain'
    })
    expect(stripped.password).toBeUndefined()
    expect(stripped.encryptedPassword).toBeUndefined()
  })
})

describe('upsertByIpPort', () => {
  it('inserts when no existing server matches host:port', async () => {
    const result = await upsertByIpPort({ host: '10.0.0.1', port: 1433, useWindowsAuth: true })
    expect(result.host).toBe('10.0.0.1')
    expect(storedRows).toHaveLength(1)
  })

  it('updates when server already exists', async () => {
    seed({ host: '10.0.0.1', port: 1433, notes: 'old' })
    await init()
    await upsertByIpPort({ host: '10.0.0.1', port: 1433, useWindowsAuth: true, notes: 'updated' })
    expect(storedRows[0].notes).toBe('updated')
  })
})

describe('exportForBackup', () => {
  it('returns valid JSON with version=1 and no credentials', async () => {
    seed({ encrypted_password: 'ENC:secret', notes: 'prod' })
    await init()
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
  it('returns error on invalid JSON', async () => {
    const result = await importFromBackup('not json')
    expect(result.errors).toHaveLength(1)
    expect(result.imported).toBe(0)
  })

  it('returns error on unrecognized format', async () => {
    const result = await importFromBackup(JSON.stringify({ version: 99 }))
    expect(result.errors).toHaveLength(1)
  })

  it('imports new servers successfully', async () => {
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: [{ host: '10.0.0.50', port: 1433, useWindowsAuth: true }]
    })
    const result = await importFromBackup(backup)
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('skips entries that already exist (no duplicate)', async () => {
    seed({ host: '10.0.0.1', port: 1433 })
    await init()
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: [{ host: '10.0.0.1', port: 1433, useWindowsAuth: true }]
    })
    const result = await importFromBackup(backup)
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
  })
})
