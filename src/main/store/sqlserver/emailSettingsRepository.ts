import * as sql from 'mssql'
import { getPool } from './connection'
import { encrypt, decrypt, isAvailable, isEncrypted } from '../../utils/safeStorageUtil'
import { createLogger } from '../../utils/logger'

const log = createLogger('email-settings-ss')

export interface EmailSettings {
  emailEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpTls: boolean
  emailRecipients: string[]
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

async function getKey(pool: sql.ConnectionPool, key: string): Promise<string | undefined> {
  const r = await pool
    .request()
    .input('k', sql.NVarChar(200), key)
    .query<{ value: string }>(`SELECT value FROM dbo.settings WHERE [key] = @k`)
  return r.recordset[0]?.value
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const pool = getPool()
  const result = await pool
    .request()
    .query<{ key: string; value: string }>(
      `SELECT [key], value FROM dbo.settings
       WHERE [key] IN (N'email_enabled', N'smtp_host', N'smtp_port',
                       N'smtp_user', N'smtp_password', N'smtp_tls', N'email_recipients')`
    )
  const map = Object.fromEntries(result.recordset.map((r) => [r.key, r.value]))
  let recipients: string[] = []
  if (map['email_recipients']) {
    try {
      recipients = JSON.parse(map['email_recipients']) as string[]
    } catch {
      recipients = []
    }
  }
  const storedPwd = map['smtp_password'] ?? ''
  let smtpPassword = ''
  if (storedPwd) {
    try {
      smtpPassword = decrypt(storedPwd)
    } catch {
      log.error('[emailSettings] failed to decrypt smtp_password — clearing cached value')
    }
  }
  return {
    emailEnabled: map['email_enabled'] != null ? map['email_enabled'] === 'true' : false,
    smtpHost: map['smtp_host'] ?? '',
    smtpPort: map['smtp_port'] != null ? parseInt(map['smtp_port'], 10) : 587,
    smtpUser: map['smtp_user'] ?? '',
    smtpPassword,
    smtpTls: map['smtp_tls'] != null ? map['smtp_tls'] === 'true' : true,
    emailRecipients: recipients
  }
}

export async function saveEmailSettings(settings: Partial<EmailSettings>): Promise<void> {
  const pool = getPool()
  if (settings.emailEnabled != null)
    await upsertKey(pool, 'email_enabled', String(settings.emailEnabled))
  if (settings.smtpHost != null) await upsertKey(pool, 'smtp_host', settings.smtpHost)
  if (settings.smtpPort != null) await upsertKey(pool, 'smtp_port', String(settings.smtpPort))
  if (settings.smtpUser != null) await upsertKey(pool, 'smtp_user', settings.smtpUser)
  if (settings.smtpPassword != null)
    await upsertKey(pool, 'smtp_password', encrypt(settings.smtpPassword))
  if (settings.smtpTls != null) await upsertKey(pool, 'smtp_tls', String(settings.smtpTls))
  if (settings.emailRecipients != null)
    await upsertKey(pool, 'email_recipients', JSON.stringify(settings.emailRecipients))
}

export async function migrateEncryptEmailPassword(): Promise<void> {
  try {
    if (!isAvailable()) return
    const pool = getPool()
    const stored = await getKey(pool, 'smtp_password')
    if (!stored || isEncrypted(stored)) return
    await upsertKey(pool, 'smtp_password', encrypt(stored))
    log.info('[emailSettings] migrated smtp_password to encrypted storage')
  } catch (err) {
    log.error('[emailSettings] migrateEncryptEmailPassword:', err)
  }
}
