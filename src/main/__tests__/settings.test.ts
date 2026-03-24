import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockAll = vi.fn()
const mockRun = vi.fn()
vi.mock('../store/database', () => ({
  getDb: () => ({ prepare: () => ({ all: mockAll, run: mockRun }) }),
}))

import { getSettings, saveSettings } from '../store/settings'

describe('themeMode in settings', () => {
  beforeEach(() => {
    mockAll.mockReset()
    mockRun.mockReset()
  })

  it('defaults to "system" when key is absent', () => {
    mockAll.mockReturnValue([])
    expect(getSettings().themeMode).toBe('system')
  })

  it('reads persisted themeMode "dark" from db', () => {
    mockAll.mockReturnValue([{ key: 'theme_mode', value: 'dark' }])
    expect(getSettings().themeMode).toBe('dark')
  })

  it('reads persisted themeMode "light" from db', () => {
    mockAll.mockReturnValue([{ key: 'theme_mode', value: 'light' }])
    expect(getSettings().themeMode).toBe('light')
  })

  it('saveSettings persists themeMode with key "theme_mode"', () => {
    mockAll.mockReturnValue([])
    saveSettings({ themeMode: 'light' })
    expect(mockRun).toHaveBeenCalledWith('theme_mode', 'light')
  })

  it('saveSettings ignores themeMode when undefined', () => {
    mockAll.mockReturnValue([])
    saveSettings({ retentionMinutes: 60 })
    const calls = (mockRun as ReturnType<typeof vi.fn>).mock.calls
    const themeCall = calls.find(([k]) => k === 'theme_mode')
    expect(themeCall).toBeUndefined()
  })
})
