import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as mssql from 'mssql'

const SKIP = !process.env['STORAGE_TEST_HOST']
const pool = { value: null as mssql.ConnectionPool | null }

vi.mock('../sqlserver/connection', () => ({ getPool: () => pool.value }))

beforeAll(async () => {
  if (SKIP) return
  pool.value = await mssql.connect({
    server: process.env['STORAGE_TEST_HOST']!,
    port: Number(process.env['STORAGE_TEST_PORT'] ?? 1437),
    database: process.env['STORAGE_TEST_DB'] ?? 'SQLSentinelDB',
    authentication: {
      type: 'default',
      options: {
        userName: process.env['STORAGE_TEST_USER'] ?? 'sqlsentinel_app',
        password: process.env['STORAGE_TEST_PASSWORD'] ?? 'App@Sentinel2025'
      }
    },
    options: { encrypt: false, trustServerCertificate: true }
  })
  await pool.value.request().query(`DELETE FROM dbo.settings WHERE [key] LIKE N'__test_%'`)
})

afterAll(async () => {
  if (pool.value) {
    await pool.value.request().query(`DELETE FROM dbo.settings WHERE [key] LIKE N'__test_%'`)
    await pool.value.close()
  }
})

import { getSettings, saveSettings } from '../sqlserver/settingsRepository'

describe.skipIf(SKIP)('settingsRepository (SQL Server)', () => {
  it('returns defaults when no rows exist for keys', async () => {
    const s = await getSettings()
    expect(s.retentionMinutes).toBeGreaterThan(0)
    expect(['light', 'dark', 'system']).toContain(s.themeMode)
  })

  it('saves and retrieves a setting', async () => {
    await saveSettings({ themeMode: 'dark' })
    const s = await getSettings()
    expect(s.themeMode).toBe('dark')
    await saveSettings({ themeMode: 'system' })
  })
})
