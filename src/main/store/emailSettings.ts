import { getDb } from './database'
import { encrypt, decrypt, isAvailable, isEncrypted } from './safeStorageUtil'

export interface EmailSettings {
  emailEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpTls: boolean
  emailRecipients: string[]
}

export function getEmailSettings(): EmailSettings {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
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
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
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
    const db = getDb()
    const row = db
      .prepare<[], { value: string }>("SELECT value FROM settings WHERE key = 'smtp_password'")
      .get()
    if (!row || !row.value) return
    if (isEncrypted(row.value)) return
    db.prepare("UPDATE settings SET value = ? WHERE key = 'smtp_password'").run(encrypt(row.value))
    console.log('[emailSettings] migrated smtp_password to encrypted storage')
  } catch (err) {
    console.error('[emailSettings] migrateEncryptEmailPassword:', err)
  }
}
