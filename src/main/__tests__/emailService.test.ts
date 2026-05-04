import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock nodemailer ---
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' })
const mockTransporter = { sendMail: mockSendMail }
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => mockTransporter) }
}))

// --- Mock emailSettings store ---
const mockGetEmailSettings = vi.fn()
vi.mock('../store/emailSettings', () => ({
  getEmailSettings: mockGetEmailSettings
}))

// --- Default settings helper ---
function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    emailEnabled: true,
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'user@example.com',
    smtpPassword: 'pass',
    smtpTls: true,
    emailRecipients: ['dest@example.com'],
    ...overrides
  }
}

// --- Alert fixture ---
const testAlert = {
  id: '1',
  serverId: '10.0.0.1:1433',
  category: 'cpu_high' as const,
  severity: 'CRITICAL' as const,
  message: 'CPU al 95%',
  detectedAt: new Date('2026-03-24T10:00:00Z'),
  acknowledgedAt: null
}

describe('sendAlertEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when emailEnabled=false', async () => {
    mockGetEmailSettings.mockReturnValue(makeSettings({ emailEnabled: false }))
    const { sendAlertEmail, __resetEmailDedupForTests } = await import('../emailService')
    __resetEmailDedupForTests()
    await sendAlertEmail(testAlert)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('does nothing when smtpHost is empty', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings({ smtpHost: '' }))
    const { sendAlertEmail, __resetEmailDedupForTests } = await import('../emailService')
    __resetEmailDedupForTests()
    await sendAlertEmail(testAlert)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('does nothing when recipients list is empty', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings({ emailRecipients: [] }))
    const { sendAlertEmail, __resetEmailDedupForTests } = await import('../emailService')
    __resetEmailDedupForTests()
    await sendAlertEmail(testAlert)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('sends email when all conditions are met', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings())
    const { sendAlertEmail, __resetEmailDedupForTests } = await import('../emailService')
    __resetEmailDedupForTests()
    await sendAlertEmail(testAlert)
    expect(mockSendMail).toHaveBeenCalledOnce()
    const call = mockSendMail.mock.calls[0][0]
    expect(call.to).toContain('dest@example.com')
    expect(call.subject).toContain('CRITICAL')
    expect(call.subject).toContain('10.0.0.1:1433')
    // The HTML template renders the category as a human-readable label
    // (e.g. "CPU HIGH"), not the raw enum value.
    expect(call.html).toMatch(/cpu_high|CPU HIGH/i)
  })

  it('deduplicates: does not re-send within 15 minutes', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings())
    const { sendAlertEmail, __resetEmailDedupForTests } = await import('../emailService')
    __resetEmailDedupForTests()
    await sendAlertEmail(testAlert)
    await sendAlertEmail(testAlert) // second call — same server+category
    expect(mockSendMail).toHaveBeenCalledTimes(1)
  })

  it('sends for WARNING alerts (email is not CRITICAL-only)', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings())
    const { sendAlertEmail, __resetEmailDedupForTests } = await import('../emailService')
    __resetEmailDedupForTests()
    await sendAlertEmail({ ...testAlert, severity: 'WARNING' })
    expect(mockSendMail).toHaveBeenCalledOnce()
  })
})

describe('sendTestEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { ok: false } when smtpHost is empty', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings({ smtpHost: '' }))
    const { sendTestEmail } = await import('../emailService')
    const result = await sendTestEmail()
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toBeTruthy()
  })

  it('returns { ok: false } when recipients is empty', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings({ emailRecipients: [] }))
    const { sendTestEmail } = await import('../emailService')
    const result = await sendTestEmail()
    expect(result.ok).toBe(false)
  })

  it('returns { ok: true } when sendMail succeeds', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings())
    mockSendMail.mockResolvedValue({ messageId: 'ok' })
    const { sendTestEmail } = await import('../emailService')
    const result = await sendTestEmail()
    expect(result.ok).toBe(true)
    expect(mockSendMail).toHaveBeenCalledOnce()
  })

  it('returns { ok: false } when sendMail throws', async () => {
    vi.resetModules()
    mockGetEmailSettings.mockReturnValue(makeSettings())
    mockSendMail.mockRejectedValue(new Error('SMTP connection refused'))
    const { sendTestEmail } = await import('../emailService')
    const result = await sendTestEmail()
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toContain('SMTP')
  })
})
