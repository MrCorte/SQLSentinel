import { getDb } from './database'
import type { Statement } from 'better-sqlite3'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  retentionMinutes: number
  backgroundEnabled: boolean
  backgroundMode: 'light' | 'full'
  backgroundIntervalMinutes: number
  backgroundNotifications: boolean
  themeMode: ThemeMode
}

interface SettingsRow {
  key: string
  value: string
}

function safeInt(raw: string | undefined, fallback: number, min = 0): number {
  if (raw == null) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= min ? n : fallback
}

// --- Cached prepared statements ---

let _stmts: {
  selectAll: Statement<[], SettingsRow>
  upsert: Statement<[string, string]>
} | null = null

function stmts() {
  if (_stmts) return _stmts
  const db = getDb()
  _stmts = {
    selectAll: db.prepare<[], SettingsRow>('SELECT key, value FROM settings'),
    upsert: db.prepare<[string, string]>('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  }
  return _stmts
}

export function getSettings(): AppSettings {
  const rows = stmts().selectAll.all()
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const rawTheme = map['theme_mode']
  return {
    retentionMinutes:          safeInt(map['retentionMinutes'], 60, 1),
    backgroundEnabled:         map['background_enabled']           != null ? map['background_enabled'] === 'true'              : true,
    backgroundMode:            (map['background_mode'] === 'full') ? 'full'                                                    : 'light',
    backgroundIntervalMinutes: safeInt(map['background_interval_minutes'], 30, 1),
    backgroundNotifications:   map['background_notifications']     != null ? map['background_notifications'] === 'true'         : true,
    themeMode:                 (rawTheme === 'dark' || rawTheme === 'light') ? rawTheme                                         : 'system',
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const upsert = stmts().upsert
  if (settings.retentionMinutes          != null) upsert.run('retentionMinutes',            String(settings.retentionMinutes))
  if (settings.backgroundEnabled         != null) upsert.run('background_enabled',           String(settings.backgroundEnabled))
  if (settings.backgroundMode            != null) upsert.run('background_mode',              settings.backgroundMode)
  if (settings.backgroundIntervalMinutes != null) upsert.run('background_interval_minutes',  String(settings.backgroundIntervalMinutes))
  if (settings.backgroundNotifications   != null) upsert.run('background_notifications',     String(settings.backgroundNotifications))
  if (settings.themeMode                 != null) upsert.run('theme_mode',                   settings.themeMode)
}
