import { describe, it, expect, beforeEach, vi } from 'vitest'

// Fake mssql pool: getSettings runs a single SELECT, saveSettings runs MERGE
// per dirty key. We capture inputs from each Request to assert MERGE payloads.

type Row = { key: string; value: string }

let storedRows: Row[] = []
const mergeCalls: Array<{ key: string; value: string }> = []

class FakeRequest {
  private inputs = new Map<string, unknown>()
  input(name: string, _type: unknown, value?: unknown): this {
    this.inputs.set(name, arguments.length >= 3 ? value : _type)
    return this
  }
  async query<T = unknown>(sqlText: string): Promise<{ recordset: T[] }> {
    const norm = sqlText.replace(/\s+/g, ' ').toLowerCase()
    if (norm.includes('select [key], value from dbo.settings')) {
      return { recordset: storedRows as T[] }
    }
    if (norm.includes('merge dbo.settings')) {
      const key = this.inputs.get('k') as string
      const value = this.inputs.get('v') as string
      mergeCalls.push({ key, value })
      const idx = storedRows.findIndex((r) => r.key === key)
      if (idx >= 0) storedRows[idx].value = value
      else storedRows.push({ key, value })
      return { recordset: [] as T[] }
    }
    return { recordset: [] as T[] }
  }
}

const fakePool = { request: () => new FakeRequest() }

vi.mock('../store/sqlserver/connection', () => ({
  getPool: () => fakePool
}))

import { getSettings, saveSettings } from '../store/sqlserver/settingsRepository'

describe('themeMode in settings', () => {
  beforeEach(() => {
    storedRows = []
    mergeCalls.length = 0
  })

  it('defaults to "system" when key is absent', async () => {
    expect((await getSettings()).themeMode).toBe('system')
  })

  it('reads persisted themeMode "dark" from db', async () => {
    storedRows = [{ key: 'theme_mode', value: 'dark' }]
    expect((await getSettings()).themeMode).toBe('dark')
  })

  it('reads persisted themeMode "light" from db', async () => {
    storedRows = [{ key: 'theme_mode', value: 'light' }]
    expect((await getSettings()).themeMode).toBe('light')
  })

  it('saveSettings persists themeMode with key "theme_mode"', async () => {
    await saveSettings({ themeMode: 'light' })
    expect(mergeCalls).toContainEqual({ key: 'theme_mode', value: 'light' })
  })

  it('saveSettings ignores themeMode when undefined', async () => {
    await saveSettings({ retentionMinutes: 60 })
    const themeCall = mergeCalls.find((c) => c.key === 'theme_mode')
    expect(themeCall).toBeUndefined()
  })
})
