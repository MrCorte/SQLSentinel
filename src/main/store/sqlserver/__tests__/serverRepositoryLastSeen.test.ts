/**
 * Tests for the lastSeen write-coalescing buffer in serverRepository.
 *
 * The hot path (health check, ~200 servers × 1/min) calls markLastSeen()
 * synchronously; the buffer is flushed every 5 minutes. flushLastSeenBuffer
 * must:
 *  - Emit one UPDATE per dirty server
 *  - Skip rows whose lastSeen is already equal (no-op short-circuit)
 *  - Trigger a single cache reload at the end (not per-row)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

let storedRows: Row[] = []
const updateBatches: Array<Array<{ id: string; lastSeen: string }>> = []
const selectQueries: string[] = []

class FakeRequest {
  private inputs = new Map<string, unknown>()
  input(name: string, _type: unknown, maybeValue?: unknown): this {
    this.inputs.set(name, arguments.length >= 3 ? maybeValue : _type)
    return this
  }
  async query<T = unknown>(sqlText: string): Promise<{ recordset: T[] }> {
    const norm = sqlText.replace(/\s+/g, ' ').toLowerCase()
    if (norm.includes('select * from dbo.servers')) {
      selectQueries.push(sqlText)
      return { recordset: storedRows as T[] }
    }
    // Batched UPDATE...FROM (VALUES ...) — extract all (idN, tsN) pairs and
    // treat them as one batch.
    if (norm.includes('update s') && norm.includes('last_seen')) {
      const batch: Array<{ id: string; lastSeen: string }> = []
      for (const [key, value] of this.inputs) {
        if (typeof key === 'string' && key.startsWith('id')) {
          const idx = key.slice(2)
          const ts = this.inputs.get(`ts${idx}`) as string
          if (ts) {
            batch.push({ id: value as string, lastSeen: ts })
            const row = storedRows.find((r) => r['id'] === value)
            if (row) row['last_seen'] = ts
          }
        }
      }
      updateBatches.push(batch)
      return { recordset: [] as T[] }
    }
    return { recordset: [] as T[] }
  }
}

const fakePool = { request: () => new FakeRequest() }
vi.mock('../connection', () => ({ getPool: () => fakePool }))
vi.mock('../../safeStorageUtil', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn((s: string) => s),
  isAvailable: vi.fn(() => true),
  isEncrypted: vi.fn(() => true)
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('node:fs', () => ({ writeFileSync: vi.fn(), readFileSync: vi.fn() }))

import {
  init,
  markLastSeen,
  flushLastSeenBuffer,
  stopLastSeenFlushTimer
} from '../serverRepository'

function seed(id: string, host: string, port: number, lastSeen: string | null = null): void {
  storedRows.push({
    id,
    host,
    port,
    instance_name: null,
    use_windows_auth: 1,
    username: null,
    encrypted_password: null,
    added_at: '2024-01-01T00:00:00.000Z',
    last_seen: lastSeen,
    unreachable: 0,
    unreachable_since: null,
    machine_name: null,
    ag_group_id: null,
    ag_name: null,
    ag_role: null,
    logical_cpus: null,
    physical_cpus: null,
    hosting_type: null,
    notes: null
  })
}

beforeEach(async () => {
  storedRows = []
  updateBatches.length = 0
  selectQueries.length = 0
  stopLastSeenFlushTimer()
  seed('srv-1', '10.0.0.1', 1433)
  seed('srv-2', '10.0.0.2', 1433, '2024-01-01T00:00:00.000Z')
  await init()
  // init triggers one SELECT; reset so the test only observes post-flush activity.
  selectQueries.length = 0
})

describe('flushLastSeenBuffer', () => {
  it('issues a single batched UPDATE for all dirty rows', async () => {
    markLastSeen('srv-1', '2026-05-26T12:00:00.000Z')
    markLastSeen('srv-2', '2026-05-26T12:01:00.000Z')
    await flushLastSeenBuffer()
    expect(updateBatches).toHaveLength(1)
    expect(updateBatches[0].map((u) => u.id).sort()).toEqual(['srv-1', 'srv-2'])
  })

  it('skips rows whose lastSeen already matches the buffered value', async () => {
    markLastSeen('srv-2', '2024-01-01T00:00:00.000Z')
    await flushLastSeenBuffer()
    expect(updateBatches).toHaveLength(0)
  })

  it('does not reload the cache after a flush (in-place patch)', async () => {
    markLastSeen('srv-1', '2026-05-26T12:00:00.000Z')
    markLastSeen('srv-2', '2026-05-26T12:01:00.000Z')
    await flushLastSeenBuffer()
    expect(selectQueries.length).toBe(0)
  })

  it('does not query at all when nothing actually changed', async () => {
    markLastSeen('srv-2', '2024-01-01T00:00:00.000Z')
    await flushLastSeenBuffer()
    expect(updateBatches).toHaveLength(0)
    expect(selectQueries.length).toBe(0)
  })

  it('drops the buffered timestamp after the flush', async () => {
    markLastSeen('srv-1', '2026-05-26T12:00:00.000Z')
    await flushLastSeenBuffer()
    // Buffer should be empty now: a second flush must do nothing.
    await flushLastSeenBuffer()
    expect(updateBatches).toHaveLength(1)
  })
})
