/**
 * Mock di better-sqlite3 con store in-memoria.
 * Usato da store.test.ts per girare senza il binario nativo better_sqlite3.node.
 *
 * Ogni new Database() crea uno store indipendente → i test si isolano tramite
 * il ciclo initDb(':memory:') / closeDb() nei beforeEach / afterEach di store.test.ts.
 */
import { vi } from 'vitest'

// ── Tipi interni ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

interface Tables {
  servers: Map<string, Row>
  metrics_snapshots: Map<string, Row>
}

// ── Helper: calcola la data di cutoff da un offset in giorni ─────────────────

function daysOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

// ── Statement mock ────────────────────────────────────────────────────────────

class MockStatement {
  private sql: string
  private tables: Tables

  constructor(sql: string, tables: Tables) {
    this.sql = sql
    this.tables = tables
  }

  // Normalizza il testo SQL per i pattern match
  private s(): string {
    return this.sql.replace(/\s+/g, ' ').toLowerCase().trim()
  }

  run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    const s = this.s()
    const { servers, metrics_snapshots } = this.tables

    // ── INSERT INTO servers (upsert con ON CONFLICT) ──────────────────────────
    if (s.includes('insert into servers') && s.includes('on conflict')) {
      const [id, ip, port, instance_name, use_windows_auth, username, encrypted_password,
             added_at, last_seen_at, last_metrics_at] = args

      // Cerca un record esistente per ip:port
      const existing = [...servers.values()].find(r => r.ip === ip && r.port === port)
      if (existing) {
        Object.assign(existing, {
          instance_name, use_windows_auth, username, encrypted_password,
          last_seen_at, last_metrics_at
        })
      } else {
        servers.set(id as string, {
          id, ip, port, instance_name, use_windows_auth, username,
          encrypted_password, added_at, last_seen_at, last_metrics_at
        })
      }
      return { changes: 1, lastInsertRowid: 1 }
    }

    // ── DELETE FROM servers ───────────────────────────────────────────────────
    if (s.includes('delete from servers')) {
      const id = args[0] as string
      servers.delete(id)
      return { changes: 1, lastInsertRowid: 0 }
    }

    // ── UPDATE servers SET last_seen_at ───────────────────────────────────────
    if (s.includes('update servers set last_seen_at')) {
      const [last_seen_at, id] = args
      const row = servers.get(id as string)
      if (row) row.last_seen_at = last_seen_at
      return { changes: 1, lastInsertRowid: 0 }
    }

    // ── UPDATE servers SET last_metrics_at ────────────────────────────────────
    if (s.includes('update servers set last_metrics_at')) {
      const [last_metrics_at, id] = args
      const row = servers.get(id as string)
      if (row) row.last_metrics_at = last_metrics_at
      return { changes: 1, lastInsertRowid: 0 }
    }

    // ── INSERT INTO metrics_snapshots ─────────────────────────────────────────
    if (s.includes('insert into metrics_snapshots')) {
      const [id, server_id, collected_at, metrics_json] = args
      metrics_snapshots.set(id as string, { id, server_id, collected_at, metrics_json })
      return { changes: 1, lastInsertRowid: 1 }
    }

    // ── DELETE FROM metrics_snapshots WHERE collected_at < datetime('now', ?) ─
    if (s.includes('delete from metrics_snapshots')) {
      const days = args[0] as number   // e.g. -30
      const cutoff = daysOffset(days)
      for (const [key, row] of metrics_snapshots) {
        if ((row.collected_at as string) < cutoff) {
          metrics_snapshots.delete(key)
        }
      }
      return { changes: 1, lastInsertRowid: 0 }
    }

    return { changes: 0, lastInsertRowid: 0 }
  }

  get(...args: unknown[]): Row | undefined {
    const s = this.s()
    const { servers, metrics_snapshots } = this.tables

    // ── SELECT * FROM servers WHERE id = ? ────────────────────────────────────
    if (s.includes('from servers where id = ?')) {
      return servers.get(args[0] as string)
    }

    // ── SELECT * FROM servers WHERE ip = ? AND port = ? ──────────────────────
    if (s.includes('from servers where ip = ?') && s.includes('and port = ?')) {
      const [ip, port] = args
      return [...servers.values()].find(r => r.ip === ip && r.port === port)
    }

    // ── SELECT * FROM metrics_snapshots … LIMIT 1 (findLatest) ───────────────
    if (s.includes('from metrics_snapshots') && s.includes('limit 1')) {
      const sid = args[0] as string
      return [...metrics_snapshots.values()]
        .filter(r => r.server_id === sid)
        .sort((a, b) =>
          (b.collected_at as string).localeCompare(a.collected_at as string)
        )[0]
    }

    return undefined
  }

  all(...args: unknown[]): Row[] {
    const s = this.s()
    const { servers, metrics_snapshots } = this.tables

    // ── SELECT * FROM servers ORDER BY ip, port ───────────────────────────────
    if (s.includes('from servers order by')) {
      return [...servers.values()].sort((a, b) => {
        const ipCmp = (a.ip as string).localeCompare(b.ip as string)
        return ipCmp !== 0 ? ipCmp : (a.port as number) - (b.port as number)
      })
    }

    // ── SELECT * FROM metrics_snapshots WHERE server_id = ? AND collected_at >= ─
    if (s.includes('from metrics_snapshots') && s.includes('collected_at >=')) {
      const [sid, days] = args    // days es. -7
      const since = daysOffset(days as number)
      return [...metrics_snapshots.values()]
        .filter(r => r.server_id === sid && (r.collected_at as string) >= since)
        .sort((a, b) =>
          (b.collected_at as string).localeCompare(a.collected_at as string)
        )
    }

    // ── SELECT * FROM metrics_snapshots WHERE server_id = ? ORDER BY … LIMIT ? (findLastN) ──
    if (s.includes('from metrics_snapshots') && s.includes('server_id = ?') && s.includes('limit')) {
      const [sid, limit] = args
      return [...metrics_snapshots.values()]
        .filter(r => r.server_id === sid)
        .sort((a, b) =>
          (b.collected_at as string).localeCompare(a.collected_at as string)
        )
        .slice(0, limit as number)
    }

    // ── SELECT * FROM metrics_snapshots WHERE server_id = ? (findHistory 9999) ─
    if (s.includes('from metrics_snapshots') && s.includes('server_id = ?')) {
      const sid = args[0] as string
      return [...metrics_snapshots.values()]
        .filter(r => r.server_id === sid)
        .sort((a, b) =>
          (b.collected_at as string).localeCompare(a.collected_at as string)
        )
    }

    // ── findLastNBulk: ROW_NUMBER() OVER (PARTITION BY server_id) ─────────────
    // Args: ...serverIds, n  (last arg is the limit n)
    if (s.includes('row_number()') && s.includes('partition by server_id')) {
      const n = args[args.length - 1] as number
      const serverIdSet = new Set(args.slice(0, -1) as string[])
      const grouped = new Map<string, Row[]>()
      for (const row of metrics_snapshots.values()) {
        const sid = row.server_id as string
        if (!serverIdSet.has(sid)) continue
        if (!grouped.has(sid)) grouped.set(sid, [])
        grouped.get(sid)!.push(row)
      }
      const result: Row[] = []
      for (const [, rows] of grouped) {
        const sorted = rows
          .sort((a, b) => (b.collected_at as string).localeCompare(a.collected_at as string))
          .slice(0, n)
          .reverse() // ASC order (oldest first)
        result.push(...sorted)
      }
      // Sort by server_id then collected_at ASC (matches ORDER BY in real query)
      result.sort((a, b) => {
        const sidCmp = (a.server_id as string).localeCompare(b.server_id as string)
        return sidCmp !== 0 ? sidCmp : (a.collected_at as string).localeCompare(b.collected_at as string)
      })
      return result
    }

    return []
  }
}

// ── Database mock ─────────────────────────────────────────────────────────────

class MockDatabase {
  private tables: Tables = {
    servers: new Map(),
    metrics_snapshots: new Map()
  }

  pragma(_sql: string): void { /* no-op */ }
  exec(_sql: string): void   { /* no-op: DDL handled implicitly by the Maps */ }
  close(): void              { /* no-op */ }

  prepare(sql: string): MockStatement {
    return new MockStatement(sql, this.tables)
  }

  transaction(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
    return fn
  }
}

// ── Mock registration ─────────────────────────────────────────────────────────

vi.mock('better-sqlite3', () => ({
  default: MockDatabase
}))
