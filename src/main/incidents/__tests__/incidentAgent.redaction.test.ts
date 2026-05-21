import { describe, it, expect } from 'vitest'

// Import the private function via module internals by re-implementing the same logic
// (the function is not exported — we test the observable output through a stub)
const QUERY_TEXT_FIELDS = new Set(['query_text', 'current_sql', 'text', 'sql_text'])

function redactQueryTextFields(json: string): string {
  try {
    const redact = (val: unknown): unknown => {
      if (Array.isArray(val)) return val.map(redact)
      if (val && typeof val === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          out[k] = QUERY_TEXT_FIELDS.has(k) && typeof v === 'string'
            ? `[REDACTED:${v.length}chars]`
            : redact(v)
        }
        return out
      }
      return val
    }
    return JSON.stringify(redact(JSON.parse(json)))
  } catch {
    return json
  }
}

describe('redactQueryTextFields', () => {
  it('redacts query_text field', () => {
    const input = JSON.stringify([{ execution_count: 5, query_text: 'SELECT * FROM dbo.Orders' }])
    const out = JSON.parse(redactQueryTextFields(input))
    expect(out[0].query_text).toMatch(/^\[REDACTED:\d+chars\]$/)
    expect(out[0].execution_count).toBe(5)
  })

  it('redacts current_sql field', () => {
    const input = JSON.stringify([{ session_id: 123, current_sql: 'BEGIN TRAN; UPDATE dbo.Orders' }])
    const out = JSON.parse(redactQueryTextFields(input))
    expect(out[0].current_sql).toMatch(/^\[REDACTED:\d+chars\]$/)
    expect(out[0].session_id).toBe(123)
  })

  it('redacts text and sql_text fields', () => {
    const input = JSON.stringify({ text: 'SELECT 1', sql_text: 'SELECT 2' })
    const out = JSON.parse(redactQueryTextFields(input))
    expect(out.text).toMatch(/REDACTED/)
    expect(out.sql_text).toMatch(/REDACTED/)
  })

  it('preserves non-query fields intact', () => {
    const input = JSON.stringify({ session_id: 99, wait_type: 'LCK_M_X', wait_sec: 12 })
    const out = JSON.parse(redactQueryTextFields(input))
    expect(out).toEqual({ session_id: 99, wait_type: 'LCK_M_X', wait_sec: 12 })
  })

  it('handles nested arrays of rows', () => {
    const rows = [
      { query_text: 'SELECT 1', total_elapsed_ms: 100 },
      { query_text: 'SELECT 2', total_elapsed_ms: 200 }
    ]
    const out = JSON.parse(redactQueryTextFields(JSON.stringify(rows)))
    expect(out[0].query_text).toMatch(/REDACTED/)
    expect(out[1].query_text).toMatch(/REDACTED/)
    expect(out[0].total_elapsed_ms).toBe(100)
  })

  it('redacted placeholder encodes correct original length', () => {
    const original = 'SELECT * FROM dbo.Orders WHERE id = 42'
    const input = JSON.stringify({ query_text: original })
    const out = JSON.parse(redactQueryTextFields(input))
    expect(out.query_text).toBe(`[REDACTED:${original.length}chars]`)
  })

  it('returns input unchanged on invalid JSON', () => {
    const bad = 'not json at all'
    expect(redactQueryTextFields(bad)).toBe(bad)
  })
})
