import nodemailer from 'nodemailer'
import type { Alert, IpcResult } from './ipc/types'
import { getEmailSettings } from './store/emailSettings'
import type { EmailSettings } from './store/emailSettings'

// ---------------------------------------------------------------------------
// Dedup — 15 min per (serverId, category, severity) triple
// ---------------------------------------------------------------------------

const emailDedup = new Map<string, number>()

export function __resetEmailDedupForTests(): void {
  emailDedup.clear()
}

function dedupKey(serverId: string, category: string, severity: string): string {
  return `${serverId}::${category}::${severity}`
}

function canSendEmail(key: string): boolean {
  const last = emailDedup.get(key) ?? 0
  return Date.now() - last >= 15 * 60_000
}

// ---------------------------------------------------------------------------
// Transport + email content
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildTransporter(s: EmailSettings) {
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    requireTLS: s.smtpTls,
    auth: { user: s.smtpUser, pass: s.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 5_000
  })
}

function buildContent(
  serverId: string,
  category: string,
  severity: 'WARNING' | 'CRITICAL',
  message: string,
  timestamp: number
): { subject: string; html: string } {
  const emoji = severity === 'CRITICAL' ? '🔴' : '🟡'
  const color = severity === 'CRITICAL' ? '#dc2626' : '#d97706'
  const ts = new Date(timestamp).toLocaleString('en-US')
  const categoryLabel = category.replace(/_/g, ' ').toUpperCase()
  const safeServerId = escapeHtml(serverId)
  const safeCategory = escapeHtml(categoryLabel)
  const safeMessage = escapeHtml(message)
  const subject = `${emoji} [SQL Sentinel] ${serverId} — ${categoryLabel} ${severity}`
  const footerStyle =
    'color:#9ca3af;font-size:12px;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px'
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px">
  <div style="background:${color};color:#fff;padding:16px;border-radius:8px 8px 0 0">
    <h2 style="margin:0">${emoji} ${severity} — ${safeCategory}</h2>
    <p style="margin:4px 0 0">Server: <strong>${safeServerId}</strong></p>
  </div>
  <div style="border:1px solid #e5e7eb;padding:20px;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="padding:6px;color:#6b7280">Timestamp</td>
        <td style="padding:6px;font-weight:bold">${ts}</td>
      </tr>
      <tr>
        <td style="padding:6px;color:#6b7280">Category</td>
        <td style="padding:6px;font-weight:bold">${safeCategory}</td>
      </tr>
      <tr>
        <td style="padding:6px;color:#6b7280">Severity</td>
        <td style="padding:6px;font-weight:bold;color:${color}">${severity}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:6px;color:#6b7280;border-top:1px solid #e5e7eb">
          <strong>Details:</strong><br/>${safeMessage}
        </td>
      </tr>
    </table>
    <p style="${footerStyle}">
      SQL Sentinel — Automated SQL Server Monitoring<br/>
      To disable email notifications, go to Settings → Email Notifications
    </p>
  </div>
</div>`
  return { subject, html }
}

// ---------------------------------------------------------------------------
// Internal send (no dedup — used by both sendAlertEmail and sendTestEmail)
// ---------------------------------------------------------------------------

async function sendEmail(
  settings: EmailSettings,
  recipients: string[],
  subject: string,
  html: string
): Promise<void> {
  const transporter = buildTransporter(settings)
  await transporter.sendMail({
    from: `"SQL Sentinel" <${settings.smtpUser}>`,
    to: recipients.join(', '),
    subject,
    html
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendAlertEmail(alert: Alert): Promise<void> {
  const settings = getEmailSettings()
  if (!settings.emailEnabled || !settings.smtpHost) return
  if (settings.emailRecipients.length === 0) return
  const key = dedupKey(alert.serverId, alert.category, alert.severity)
  if (!canSendEmail(key)) return
  const { subject, html } = buildContent(
    alert.serverId,
    alert.category,
    alert.severity,
    alert.message,
    alert.detectedAt.getTime()
  )
  await sendEmail(settings, settings.emailRecipients, subject, html)
  emailDedup.set(key, Date.now())
}

export async function sendTestEmail(): Promise<IpcResult<null>> {
  const settings = getEmailSettings()
  if (!settings.smtpHost) return { ok: false, error: 'SMTP host not configured' }
  if (settings.emailRecipients.length === 0)
    return { ok: false, error: 'No recipients configured' }
  try {
    const { subject, html } = buildContent(
      'TEST-SERVER',
      'test',
      'WARNING',
      'This is a test email from SQL Sentinel. SMTP configuration is correct ✅',
      Date.now()
    )
    await sendEmail(settings, settings.emailRecipients, subject, html)
    return { ok: true, data: null }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
