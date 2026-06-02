import { describe, expect, it } from 'vitest'

import { isMockModeEnabled } from './mockMode'

describe('isMockModeEnabled', () => {
  it('uses VITE_MOCK_MODE as the canonical flag', () => {
    expect(isMockModeEnabled({ VITE_MOCK_MODE: 'true' })).toBe(true)
    expect(isMockModeEnabled({ VITE_MOCK_MODE: 'false' })).toBe(false)
  })

  it('does not enable mocks from the legacy VITE_USE_MOCK flag alone', () => {
    expect(isMockModeEnabled({ VITE_USE_MOCK: 'true' })).toBe(false)
  })
})
