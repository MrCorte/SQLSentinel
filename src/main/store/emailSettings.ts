import { getDb } from './database'
import { encrypt, decrypt, isAvailable, isEncrypted } from './safeStorageUtil'
import type Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'
import { createLogger } from '../utils/logger'

const log = createLogger('email-settings')

export interface EmailSettings {
  emailEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpTls: boolean
  emailRecipients: string[]
}

interface SettingsRow {
  key: string
  value: string
}

interface SmtpPasswordRow {
  value: string
}

// --- Cached prepared statements ---

let _db: Database.Database | null = null
let _stmts: {
  selectAll: Statement<[], SettingsRow>
  upsert: Statement<[string, string]>
  selectSmtpPassword: Statement<[], SmtpPasswordRow>
  updateSmtpPassword: Statement<[string]>
} | null = null

function stmts() {
  const db = getDb()
  if (_stmts && _db === db) return _stmts
  _db = db
  _stmts = {
    selectAll: db.prepare<[], SettingsRow>('SELECT key, value FROM settings'),
    upsert: db.prepare<[string, string]>('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
    selectSmtpPassword: db.prepare<[], SmtpPasswordRow>(
      "SELECT value FROM settings WHERE key = 'smtp_password'"
    ),
    updateSmtpPassword: db.prepare<[string]>(
      "UPDATE settings SET value = ? WHERE key = 'smtp_password'"
    ),
  }
  return _stmts
}

export function getEmailSettings(): EmailSettings {
  const rows = stmts().selectAll.all()
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  let recipients: string[] = []
  if (map['email_recipients'] != null) {
    try { recipients = JSON.parse(map['email_recipients']) as string[] } catch { recipients = [] }
  }
  const storedPwd = map['smtp_password'] ?? ''
  return {
    emailEnabled:    map['email_enabled']  != null ? map['email_enabled'] === 'true'   : false,
    smtpHost:        map['smtp_host']      ?? '',
    smtpPort:        map['smtp_port']      != null ? parseInt(map['smtp_port'], 10)     : 587,
    smtpUser:        map['smtp_user']      ?? '',
    smtpPassword:    storedPwd ? decrypt(storedPwd) : '',
    smtpTls:         map['smtp_tls']       != null ? map['smtp_tls'] === 'true'         : true,
    emailRecipients: recipients,
  }
}

export function saveEmailSettings(settings: Partial<EmailSettings>): void {
  const upsert = stmts().upsert
  if (settings.emailEnabled    != null) upsert.run('email_enabled',    String(settings.emailEnabled))
  if (settings.smtpHost        != null) upsert.run('smtp_host',        settings.smtpHost)
  if (settings.smtpPort        != null) upsert.run('smtp_port',        String(settings.smtpPort))
  if (settings.smtpUser        != null) upsert.run('smtp_user',        settings.smtpUser)
  if (settings.smtpPassword    != null) upsert.run('smtp_password',    encrypt(settings.smtpPassword))
  if (settings.smtpTls         != null) upsert.run('smtp_tls',         String(settings.smtpTls))
  if (settings.emailRecipients != null) upsert.run('email_recipients', JSON.stringify(settings.emailRecipients))
}

// One-shot migration: encrypts any existing plaintext smtp_password on first boot
// after this patch. No-op if already encrypted or if safeStorage unavailable.
export function migrateEncryptEmailPassword(): void {
  try {
    if (!isAvailable()) return
    const row = stmts().selectSmtpPassword.get()
    if (!row || !row.value) return
    if (isEncrypted(row.value)) return
    stmts().updateSmtpPassword.run(encrypt(row.value))
    log.info('[emailSettings] migrated smtp_password to encrypted storage')
  } catch (err) {
    console.error('[emailSettings] migrateEncryptEmailPassword:', err)
  }
}
