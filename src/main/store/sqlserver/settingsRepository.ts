import * as sql from 'mssql'
import { getPool } from './connection'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  retentionMinutes: number
  backgroundEnabled: boolean
  backgroundMode: 'light' | 'full'
  backgroundIntervalMinutes: number
  backgroundNotifications: boolean
  themeMode: ThemeMode
}

function safeInt(raw: string | undefined, fallback: number, min = 0): number {
  if (raw == null) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= min ? n : fallback
}

async function upsertKey(pool: sql.ConnectionPool, key: string, value: string): Promise<void> {
  await pool
    .request()
    .input('k', sql.NVarChar(200), key)
    .input('v', sql.NVarChar(sql.MAX), value)
    .query(`MERGE dbo.settings AS t
            USING (SELECT @k AS [key], @v AS value) AS s ON t.[key] = s.[key]
            WHEN MATCHED THEN UPDATE SET t.value = s.value
            WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (s.[key], s.value);`)
}

export async function getSettings(): Promise<AppSettings> {
  const pool = getPool()
  const result = await pool
    .request()
    .query<{ key: string; value: string }>(`SELECT [key], value FROM dbo.settings`)
  const map = Object.fromEntries(result.recordset.map((r) => [r.key, r.value]))
  const rawTheme = map['theme_mode']
  return {
    retentionMinutes: safeInt(map['retentionMinutes'], 60, 1),
    backgroundEnabled:
      map['background_enabled'] != null ? map['background_enabled'] === 'true' : true,
    backgroundMode: map['background_mode'] === 'full' ? 'full' : 'light',
    backgroundIntervalMinutes: safeInt(map['background_interval_minutes'], 30, 1),
    backgroundNotifications:
      map['background_notifications'] != null ? map['background_notifications'] === 'true' : true,
    themeMode: rawTheme === 'dark' || rawTheme === 'light' ? rawTheme : 'system'
  }
}

/**
 * Read a single setting row by key. Returns undefined if the row does not exist.
 * Used by feature code (AI provider, incident agent) that owns its own keys
 * outside the typed AppSettings surface.
 */
export async function getRawSetting(key: string): Promise<string | undefined> {
  const r = await getPool()
    .request()
    .input('k', sql.NVarChar(200), key)
    .query<{ value: string }>(`SELECT value FROM dbo.settings WHERE [key] = @k`)
  return r.recordset[0]?.value
}

/** Read multiple settings keys in one round-trip. */
export async function getRawSettings(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {}
  const req = getPool().request()
  const placeholders = keys.map((k, i) => {
    const name = `k${i}`
    req.input(name, sql.NVarChar(200), k)
    return `@${name}`
  })
  const r = await req.query<{ key: string; value: string }>(
    `SELECT [key], value FROM dbo.settings WHERE [key] IN (${placeholders.join(',')})`
  )
  return Object.fromEntries(r.recordset.map((row) => [row.key, row.value]))
}

export async function setRawSetting(key: string, value: string): Promise<void> {
  await upsertKey(getPool(), key, value)
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const pool = getPool()
  if (settings.retentionMinutes != null)
    await upsertKey(pool, 'retentionMinutes', String(settings.retentionMinutes))
  if (settings.backgroundEnabled != null)
    await upsertKey(pool, 'background_enabled', String(settings.backgroundEnabled))
  if (settings.backgroundMode != null) await upsertKey(pool, 'background_mode', settings.backgroundMode)
  if (settings.backgroundIntervalMinutes != null)
    await upsertKey(pool, 'background_interval_minutes', String(settings.backgroundIntervalMinutes))
  if (settings.backgroundNotifications != null)
    await upsertKey(pool, 'background_notifications', String(settings.backgroundNotifications))
  if (settings.themeMode != null) await upsertKey(pool, 'theme_mode', settings.themeMode)
}
