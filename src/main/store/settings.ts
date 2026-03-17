import { getDb } from './database'

const DEFAULT_RETENTION_MINUTES = 60

export interface AppSettings {
  retentionMinutes: number
}

export function getSettings(): AppSettings {
  const db = getDb()
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('retentionMinutes') as { value: string } | undefined
  return {
    retentionMinutes: row ? parseInt(row.value, 10) : DEFAULT_RETENTION_MINUTES
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  if (settings.retentionMinutes !== undefined) {
    upsert.run('retentionMinutes', String(settings.retentionMinutes))
  }
}
