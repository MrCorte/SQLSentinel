import { describe, it, expect } from 'vitest'
import {
  shouldInjectWaitStats,
  selectRelevantWaitStats,
  formatWaitStatsBlock,
  WAIT_STATS
} from '../waitStatsReference'

describe('shouldInjectWaitStats', () => {
  it('triggers on the word "wait"', () => {
    expect(shouldInjectWaitStats('high wait times', '')).toBe(true)
  })

  it('triggers on Italian "attesa"', () => {
    expect(shouldInjectWaitStats('analizza le attese', '')).toBe(true)
  })

  it('triggers when context contains a known wait_type', () => {
    expect(shouldInjectWaitStats('what is happening?', 'alert: PAGEIOLATCH_SH dominant')).toBe(true)
  })

  it('triggers on "blocking" / "lock" / "latch"', () => {
    expect(shouldInjectWaitStats('blocking sessions', '')).toBe(true)
    expect(shouldInjectWaitStats('lock escalation', '')).toBe(true)
    expect(shouldInjectWaitStats('latch contention', '')).toBe(true)
  })

  it('does NOT trigger for unrelated questions', () => {
    expect(shouldInjectWaitStats('show me top 5 slow queries', '')).toBe(false)
    expect(shouldInjectWaitStats('list databases', '')).toBe(false)
  })
})

describe('selectRelevantWaitStats', () => {
  it('returns ONLY explicitly mentioned wait types when present', () => {
    const result = selectRelevantWaitStats('what is CXPACKET?', '')
    expect(result.length).toBe(1)
    expect(result[0].type).toBe('CXPACKET')
  })

  it('returns multiple when several are mentioned', () => {
    const result = selectRelevantWaitStats('I see WRITELOG and SOS_SCHEDULER_YIELD', '')
    const types = new Set(result.map((r) => r.type))
    expect(types.has('WRITELOG')).toBe(true)
    expect(types.has('SOS_SCHEDULER_YIELD')).toBe(true)
  })

  it('falls back to common set when no specific wait type named', () => {
    const result = selectRelevantWaitStats('analyze waits', '')
    expect(result.length).toBeGreaterThanOrEqual(5)
    // Common set should include the diagnostic staples
    const types = new Set(result.map((r) => r.type))
    expect(types.has('LCK_M_X')).toBe(true)
    expect(types.has('PAGEIOLATCH_SH')).toBe(true)
  })
})

describe('formatWaitStatsBlock', () => {
  it('emits one line per entry with type, category, meaning, fix', () => {
    const sample = WAIT_STATS.slice(0, 2)
    const out = formatWaitStatsBlock(sample)
    expect(out).toContain(sample[0].type)
    expect(out).toContain(sample[0].category)
    expect(out).toContain('→')
    expect(out).toContain(sample[1].type)
  })

  it('handles empty input', () => {
    expect(formatWaitStatsBlock([])).toBe('')
  })
})

describe('WAIT_STATS data integrity', () => {
  it('has unique type identifiers', () => {
    const types = WAIT_STATS.map((w) => w.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('every entry has non-empty meaning and fix', () => {
    for (const w of WAIT_STATS) {
      expect(w.meaning.length).toBeGreaterThan(0)
      expect(w.fix.length).toBeGreaterThan(0)
    }
  })

  it('every category is from the allowed enum', () => {
    const allowed = new Set([
      'lock', 'io', 'memory', 'cpu', 'network', 'log', 'parallelism', 'latch', 'other'
    ])
    for (const w of WAIT_STATS) {
      expect(allowed.has(w.category)).toBe(true)
    }
  })
})
