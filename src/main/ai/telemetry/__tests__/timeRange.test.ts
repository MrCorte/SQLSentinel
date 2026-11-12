import { describe, it, expect } from 'vitest'
import { parseTimeRange, asksForHistory } from '../timeRange'

// Mercoledì 12/11/2026 ore 10:30 locali
const NOW = new Date(2026, 10, 12, 10, 30, 0)
const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m, 0).getTime()

describe('parseTimeRange', () => {
  it('returns null when there is no time reference', () => {
    expect(parseTimeRange('show blocking sessions', NOW)).toBeNull()
  })

  it('parses "ieri" / "yesterday" as the full previous day', () => {
    for (const q of ['cosa è successo ieri su PROD01?', 'what happened yesterday']) {
      const r = parseTimeRange(q, NOW)!
      expect(r.from.getTime()).toBe(at(11, 0))
      expect(r.to.getTime()).toBe(at(12, 0))
    }
  })

  it('parses "stanotte" / "last night" as 22:00 → 07:00', () => {
    for (const q of ['perché era lento stanotte?', 'ieri notte CPU alta', 'slow last night']) {
      const r = parseTimeRange(q, NOW)!
      expect(r.from.getTime()).toBe(at(11, 22))
      expect(r.to.getTime()).toBe(at(12, 7))
    }
  })

  it('clamps "stanotte" to now when still in the night', () => {
    const early = new Date(2026, 10, 12, 3, 0, 0)
    const r = parseTimeRange('stanotte', early)!
    expect(r.from.getTime()).toBe(at(11, 22))
    expect(r.to.getTime()).toBe(early.getTime())
  })

  it('parses "ultime N ore" / "last N hours"', () => {
    expect(parseTimeRange('blocking nelle ultime 3 ore', NOW)!.from.getTime()).toBe(
      NOW.getTime() - 3 * 3_600_000
    )
    expect(parseTimeRange('cpu in the last two hours', NOW)!.from.getTime()).toBe(
      NOW.getTime() - 2 * 3_600_000
    )
  })

  it('parses "alle 15" as ±1h, rolling to yesterday when in the future', () => {
    const r = parseTimeRange('cosa è successo alle 15?', NOW)!
    expect(r.from.getTime()).toBe(at(11, 14))
    expect(r.to.getTime()).toBe(at(11, 16))
    const r2 = parseTimeRange('ieri alle 9:30', NOW)!
    expect(r2.from.getTime()).toBe(at(11, 8, 30))
    const r3 = parseTimeRange('at 9am', NOW)!
    expect(r3.from.getTime()).toBe(at(12, 8))
    expect(r3.to.getTime()).toBe(at(12, 10))
  })

  it('parses "2 ore fa" / "3 hours ago"', () => {
    const r = parseTimeRange('2 ore fa il server era lento', NOW)!
    expect(r.from.getTime()).toBe(NOW.getTime() - 3 * 3_600_000)
    expect(r.to.getTime()).toBe(NOW.getTime() - 1 * 3_600_000)
  })

  it('parses parts of the day and weeks', () => {
    expect(parseTimeRange('stamattina', NOW)!.from.getTime()).toBe(at(12, 6))
    expect(parseTimeRange('stamattina', NOW)!.to.getTime()).toBe(NOW.getTime())
    expect(parseTimeRange('trend della settimana scorsa', NOW)!.from.getTime()).toBe(
      NOW.getTime() - 7 * 86_400_000
    )
    expect(parseTimeRange('oggi', NOW)!.from.getTime()).toBe(at(12, 0))
  })
})

describe('asksForHistory', () => {
  it('detects comparison / recurrence intent', () => {
    expect(asksForHistory('è normale questa CPU?')).toBe(true)
    expect(asksForHistory('è già successo questo blocking?')).toBe(true)
    expect(asksForHistory('has this happened before?')).toBe(true)
    expect(asksForHistory('show me blocking sessions')).toBe(false)
  })
})
