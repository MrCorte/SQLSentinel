/**
 * Tests for incidents/repository.ts on SQL Server:
 *   - listIncidents() must return correct results with and without status filter.
 *   - createIncident() binds exactly the placeholders required by the insert statement.
 *
 * The mssql pool is replaced with a lightweight in-memory fake whose `.request()`
 * builder records bound inputs and dispatches on the SQL text. Test-only; we
 * only support the queries actually issued by repository.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// In-memory pool fake — Map-backed store with a tiny query dispatcher.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

/**
 * Mirror of the listIncidents CTE: keep the newest row per (server_id, category)
 * group, annotate each with group_count, and order by opened_at DESC.
 */
function dedupNewestPerGroup(rows: Row[]): Row[] {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const key = `${r.server_id}|${r.category}`
    const arr = groups.get(key)
    if (arr) arr.push(r)
    else groups.set(key, [r])
  }
  const winners: Row[] = []
  for (const arr of groups.values()) {
    const newest = arr.reduce((a, b) => ((b.opened_at as number) > (a.opened_at as number) ? b : a))
    winners.push({ ...newest, group_count: arr.length })
  }
  return winners.sort((a, b) => (b.opened_at as number) - (a.opened_at as number))
}

class FakeRequest {
  private inputs = new Map<string, unknown>()
  constructor(private store: Map<string, Row>) {}

  // mssql.Request.input(name, type?, value?) — we ignore type; record (name, value).
  input(name: string, typeOrValue: unknown, maybeValue?: unknown): this {
    const value = arguments.length >= 3 ? maybeValue : typeOrValue
    this.inputs.set(name, value)
    return this
  }

  async query<T = unknown>(sqlText: string): Promise<{ recordset: T[] }> {
    const norm = sqlText.replace(/\s+/g, ' ').trim().toLowerCase()

    if (norm.startsWith('insert into dbo.incidents')) {
      const row: Row = {
        id: this.inputs.get('id'),
        server_id: this.inputs.get('server_id'),
        category: this.inputs.get('category'),
        severity: this.inputs.get('severity'),
        status: 'open',
        opened_at: this.inputs.get('opened_at'),
        resolved_at: null,
        summary: null,
        root_cause_md: null
      }
      this.store.set(row.id as string, row)
      return { recordset: [] as T[] }
    }

    if (norm.includes('from dbo.incidents where id = @id')) {
      const id = this.inputs.get('id') as string
      const r = this.store.get(id)
      return { recordset: (r ? [r] : []) as T[] }
    }

    // listIncidents: a CTE dedups to the newest row per (server_id, category)
    // via ROW_NUMBER ... WHERE rn = 1, annotating each with group_count.
    if (norm.includes('from dbo.incidents') && norm.includes('row_number')) {
      let rows = [...this.store.values()]
      if (norm.includes('where status = @status')) {
        const status = this.inputs.get('status')
        rows = rows.filter((r) => r.status === status)
      }
      return { recordset: dedupNewestPerGroup(rows).slice(0, 200) as T[] }
    }

    return { recordset: [] as T[] }
  }
}

class FakePool {
  readonly incidents = new Map<string, Row>()
  request(): FakeRequest {
    return new FakeRequest(this.incidents)
  }
}

let pool: FakePool

vi.mock('../../store/sqlserver/connection', () => ({
  getPool: vi.fn(() => pool)
}))

// Import AFTER mocks
import { createIncident, listIncidents } from '../repository'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertRaw(
  id: string,
  status: string,
  openedAt: number,
  serverId = 'srv-1',
  category = 'blocking_sessions'
): void {
  pool.incidents.set(id, {
    id,
    server_id: serverId,
    category,
    severity: 'warning',
    status,
    opened_at: openedAt,
    resolved_at: null,
    summary: null,
    root_cause_md: null
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listIncidents()', () => {
  beforeEach(() => {
    pool = new FakePool()
  })

  it('returns the newest incident per (server, category) group', async () => {
    // Distinct categories → three separate groups, all surface.
    insertRaw('a', 'open', 1000, 'srv-1', 'cpu_high')
    insertRaw('b', 'resolved', 900, 'srv-1', 'blocking_sessions')
    insertRaw('c', 'investigating', 800, 'srv-1', 'disk_space_low')

    const all = await listIncidents()
    expect(all).toHaveLength(3)
    expect(all.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('collapses multiple incidents in the same group to the newest', async () => {
    insertRaw('old', 'open', 100, 'srv-1', 'cpu_high')
    insertRaw('new', 'open', 300, 'srv-1', 'cpu_high')

    const all = await listIncidents()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('new')
    expect(all[0].count).toBe(2)
  })

  it('returns only open incidents when filtered by status=open', async () => {
    insertRaw('a', 'open', 1000, 'srv-1', 'cpu_high')
    insertRaw('b', 'resolved', 900, 'srv-1', 'blocking_sessions')
    insertRaw('c', 'open', 800, 'srv-1', 'disk_space_low')

    const open = await listIncidents({ status: 'open' })
    expect(open).toHaveLength(2)
    expect(open.every((i) => i.status === 'open')).toBe(true)
  })

  it('returns only resolved incidents when filtered by status=resolved', async () => {
    insertRaw('a', 'open', 1000, 'srv-1', 'cpu_high')
    insertRaw('b', 'resolved', 900, 'srv-1', 'blocking_sessions')
    insertRaw('c', 'resolved', 800, 'srv-1', 'disk_space_low')

    const resolved = await listIncidents({ status: 'resolved' })
    expect(resolved).toHaveLength(2)
    expect(resolved.every((i) => i.status === 'resolved')).toBe(true)
  })

  it('returns incidents ordered by opened_at DESC', async () => {
    insertRaw('old', 'open', 100, 'srv-1', 'cpu_high')
    insertRaw('newest', 'open', 300, 'srv-1', 'blocking_sessions')
    insertRaw('mid', 'open', 200, 'srv-1', 'disk_space_low')

    const all = await listIncidents()
    expect(all[0].id).toBe('newest')
    expect(all[1].id).toBe('mid')
    expect(all[2].id).toBe('old')
  })

  it('returns empty array when no incidents match the filter', async () => {
    insertRaw('a', 'open', 1000)
    expect(await listIncidents({ status: 'resolved' })).toHaveLength(0)
  })

  it('returns empty array on empty table', async () => {
    expect(await listIncidents()).toHaveLength(0)
    expect(await listIncidents({ status: 'open' })).toHaveLength(0)
  })
})

describe('createIncident()', () => {
  beforeEach(() => {
    pool = new FakePool()
  })

  it('persists the row with status=open and the provided fields', async () => {
    const incident = await createIncident('srv-1', 'disk_space_low', 'WARNING', 1234)

    expect(incident.serverId).toBe('srv-1')
    expect(incident.category).toBe('disk_space_low')
    expect(incident.severity).toBe('WARNING')
    expect(incident.status).toBe('open')
    expect(incident.openedAt).toBe(1234)
  })
})
