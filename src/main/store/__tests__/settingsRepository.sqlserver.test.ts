import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as mssql from 'mssql'

const SKIP = !process.env['STORAGE_TEST_HOST']
const REQUIRED_STORAGE_TEST_USER = process.env['STORAGE_TEST_USER'] ?? process.env['SQLSENTINEL_APP_USER']
const REQUIRED_STORAGE_TEST_PASSWORD = process.env['STORAGE_TEST_PASSWORD']
const pool = { value: null as mssql.ConnectionPool | null }

vi.mock('../sqlserver/connection', () => ({ getPool: () => pool.value }))

beforeAll(async () => {
  if (SKIP) return
  if (!REQUIRED_STORAGE_TEST_USER) {
    throw new Error('STORAGE_TEST_USER or SQLSENTINEL_APP_USER is required when STORAGE_TEST_HOST is set')
  }
  if (!REQUIRED_STORAGE_TEST_PASSWORD) {
    throw new Error('STORAGE_TEST_PASSWORD is required when STORAGE_TEST_HOST is set')
  }
  pool.value = await mssql.connect({
    server: process.env['STORAGE_TEST_HOST']!,
    port: Number(process.env['STORAGE_TEST_PORT'] ?? 1437),
    database: process.env['STORAGE_TEST_DB'] ?? 'SQLSentinelDB',
    authentication: {
      type: 'default',
      options: {
        userName: REQUIRED_STORAGE_TEST_USER,
        password: REQUIRED_STORAGE_TEST_PASSWORD
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
