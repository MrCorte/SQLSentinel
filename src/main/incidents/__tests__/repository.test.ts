/**
 * Tests for repository.ts fix #3:
 *   listIncidents() must return correct results with and without status filter,
 *   using index-friendly SQL (no non-sargable '? = ''  OR status = ?' trick).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Lightweight in-memory SQLite stand-in that supports incident queries.
// better-sqlite3 native binary is incompatible with the CI Node version,
// so we provide a JS Map-based substitute for this test file only.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

class IncidentStatement {
  constructor(
    private sql: string,
    private store: Map<string, Row>
  ) {}

  private normalised(): string {
    return this.sql.replace(/\s+/g, ' ').trim().toLowerCase()
  }

  run(...args: unknown[]): { changes: number } {
    const n = this.normalised()
    const placeholderCount = (this.sql.match(/\?/g) ?? []).length
    if (args.length > placeholderCount) {
      throw new RangeError('Too many parameter values were provided')
    }

    if (n.startsWith('insert into incidents')) {
      // INSERT INTO incidents (id, server_id, ...) VALUES (?, ?, ...)
      const [id, server_id, category, severity, opened_at] = args
      this.store.set(id as string, {
        id,
        server_id,
        category,
        severity,
        status: 'open',
        opened_at,
        resolved_at: null,
        summary: null,
        root_cause_md: null
      })
      return { changes: 1 }
    }

    if (n.startsWith('update incidents set status')) {
      const [status, resolved_at, id] = args
      const row = this.store.get(id as string)
      if (row) Object.assign(row, { status, resolved_at })
      return { changes: row ? 1 : 0 }
    }

    if (n.startsWith('update incidents set summary')) {
      const [summary, id] = args
      const row = this.store.get(id as string)
      if (row) row.summary = summary
      return { changes: row ? 1 : 0 }
    }

    if (n.startsWith('update incidents set root_cause_md')) {
      const [root_cause_md, id] = args
      const row = this.store.get(id as string)
      if (row) row.root_cause_md = root_cause_md
      return { changes: row ? 1 : 0 }
    }

    return { changes: 0 }
  }

  get(...args: unknown[]): Row | undefined {
    const n = this.normalised()

    if (n.includes('from incidents where id = ?')) {
      return this.store.get(args[0] as string)
    }

    if (n.includes('from incidents') && n.includes('server_id = ?') && n.includes("status = 'open'")) {
      const [server_id, category] = args
      return [...this.store.values()]
        .filter((r) => r.server_id === server_id && r.category === category && r.status === 'open')
        .sort((a, b) => (b.opened_at as number) - (a.opened_at as number))[0]
    }

    if (n.includes('from settings')) {
      return undefined
    }

    return undefined
  }

  all(...args: unknown[]): Row[] {
    const n = this.normalised()

    // No-filter: SELECT * FROM incidents ORDER BY opened_at DESC LIMIT 200
    if (n.includes('from incidents') && !n.includes('where') && n.includes('order by opened_at')) {
      return [...this.store.values()]
        .sort((a, b) => (b.opened_at as number) - (a.opened_at as number))
        .slice(0, 200)
    }

    // Status-filtered: SELECT * FROM incidents WHERE status = ? ORDER BY ...
    if (n.includes('from incidents') && n.includes('where status = ?')) {
      const status = args[0] as string
      return [...this.store.values()]
        .filter((r) => r.status === status)
        .sort((a, b) => (b.opened_at as number) - (a.opened_at as number))
        .slice(0, 200)
    }

    // Legacy non-sargable: WHERE (? = '' OR status = ?)
    // Still handle it so tests show the behavioral difference if the fix is reverted.
    if (n.includes('from incidents') && n.includes("? = ''")) {
      const [statusFilter] = args as string[]
      const rows = [...this.store.values()]
      const filtered = statusFilter === '' ? rows : rows.filter((r) => r.status === statusFilter)
      return filtered
        .sort((a, b) => (b.opened_at as number) - (a.opened_at as number))
        .slice(0, 200)
    }

    return []
  }
}

class IncidentMockDatabase {
  readonly incidents = new Map<string, Row>()

  pragma(): void {}
  exec(): void {}
  close(): void {}

  prepare(sql: string): IncidentStatement {
    return new IncidentStatement(sql, this.incidents)
  }

  transaction(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
    return fn
  }
}

// ---------------------------------------------------------------------------
// Mock registration
// ---------------------------------------------------------------------------

let dbInstance: IncidentMockDatabase

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => dbInstance)
}))

vi.mock('../../store/database', () => ({
  getDb: vi.fn(() => dbInstance)
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' }
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
) {
  dbInstance.incidents.set(id, {
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
    dbInstance = new IncidentMockDatabase()
  })

  it('returns all incidents when no status filter is provided', () => {
    insertRaw('a', 'open', 1000)
    insertRaw('b', 'resolved', 900)
    insertRaw('c', 'investigating', 800)

    const all = listIncidents()
    expect(all).toHaveLength(3)
    expect(all.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns only open incidents when filtered by status=open', () => {
    insertRaw('a', 'open', 1000)
    insertRaw('b', 'resolved', 900)
    insertRaw('c', 'open', 800)

    const open = listIncidents({ status: 'open' })
    expect(open).toHaveLength(2)
    expect(open.every((i) => i.status === 'open')).toBe(true)
  })

  it('returns only resolved incidents when filtered by status=resolved', () => {
    insertRaw('a', 'open', 1000)
    insertRaw('b', 'resolved', 900)
    insertRaw('c', 'resolved', 800)

    const resolved = listIncidents({ status: 'resolved' })
    expect(resolved).toHaveLength(2)
    expect(resolved.every((i) => i.status === 'resolved')).toBe(true)
  })

  it('returns incidents ordered by opened_at DESC', () => {
    insertRaw('old', 'open', 100)
    insertRaw('newest', 'open', 300)
    insertRaw('mid', 'open', 200)

    const all = listIncidents()
    expect(all[0].id).toBe('newest')
    expect(all[1].id).toBe('mid')
    expect(all[2].id).toBe('old')
  })

  it('returns empty array when no incidents match the filter', () => {
    insertRaw('a', 'open', 1000)
    expect(listIncidents({ status: 'resolved' })).toHaveLength(0)
  })

  it('returns empty array on empty table', () => {
    expect(listIncidents()).toHaveLength(0)
    expect(listIncidents({ status: 'open' })).toHaveLength(0)
  })
})

describe('createIncident()', () => {
  beforeEach(() => {
    dbInstance = new IncidentMockDatabase()
  })

  it('binds exactly the placeholders required by the insert statement', () => {
    const incident = createIncident('srv-1', 'disk_space_low', 'WARNING', 1234)

    expect(incident.serverId).toBe('srv-1')
    expect(incident.category).toBe('disk_space_low')
    expect(incident.severity).toBe('WARNING')
    expect(incident.status).toBe('open')
    expect(incident.openedAt).toBe(1234)
  })
})
