import { describe, it, expect } from 'vitest'
import { hashQuestion } from '../aiFeedbackRepository'

describe('hashQuestion', () => {
  it('returns the same hash for case-insensitive variants', () => {
    expect(hashQuestion('Show blocking sessions')).toBe(hashQuestion('show blocking sessions'))
  })

  it('returns the same hash for punctuation variants', () => {
    expect(hashQuestion('Show blocking sessions!')).toBe(hashQuestion('Show blocking sessions'))
    expect(hashQuestion('Show blocking sessions?')).toBe(hashQuestion('Show blocking sessions'))
  })

  it('returns the same hash for whitespace variants', () => {
    expect(hashQuestion('show   blocking\tsessions')).toBe(hashQuestion('show blocking sessions'))
  })

  it('returns different hashes for semantically different questions', () => {
    expect(hashQuestion('Show blocking sessions')).not.toBe(hashQuestion('Show slow queries'))
  })

  it('returns a 64-character hex hash', () => {
    const h = hashQuestion('any question')
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it('handles empty input without crashing', () => {
    expect(hashQuestion('')).toMatch(/^[a-f0-9]{64}$/)
  })
})
