# Email Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send HTML email alerts via SMTP when WARNING/CRITICAL alerts are detected, with configurable settings UI and 15-minute dedup.

**Architecture:** A new `emailService.ts` (main process) owns nodemailer transport, HTML building, and dedup. A new `emailSettings.ts` store extends the existing key-value settings table. Email dispatch is hooked into `BackgroundService.maybeNotify()` before the CRITICAL-only filter so WARNING alerts also trigger email. Three new IPC channels expose get/save/test to the renderer.

> **Critical schema note:** The existing `settings` table uses key-value rows (`INSERT OR REPLACE INTO settings (key, value)`). There is NO `ALTER TABLE` — email settings are just new keys in the same table. The spec's `ALTER TABLE` block describes logical fields, not SQL DDL.

> **Critical `onAlert` note:** `onAlert` in `metricsWorker` is a **single-subscriber** replace-on-call function. `BackgroundService` already owns that slot. Email is dispatched by calling `sendAlertEmail()` from _inside_ `BackgroundService.maybeNotify()`, before the CRITICAL-only toast filter — so both WARNING and CRITICAL alerts generate email (controlled by `emailEnabled` flag and dedup).

**Tech Stack:** nodemailer v7, better-sqlite3 (existing key-value settings), Vitest for unit tests, MUI v5 for UI.

---

## File Map

| File                                           | Action     | Responsibility                                                                                |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `src/main/store/emailSettings.ts`              | **Create** | `getEmailSettings` / `saveEmailSettings` — key-value pattern                                  |
| `src/main/emailService.ts`                     | **Create** | nodemailer transport, HTML builder, module-level dedup, `sendAlertEmail`, `sendTestEmail`     |
| `src/main/__tests__/emailService.test.ts`      | **Create** | Unit tests for email logic (mocks nodemailer + emailSettings store)                           |
| `src/main/ipc/types.ts`                        | Modify     | Add `EmailSettings`, `SaveEmailSettingsRequest`, 3 new `IpcChannel` values                    |
| `src/preload/index.d.ts`                       | Modify     | Mirror `EmailSettings`, `SaveEmailSettingsRequest`, 3 new bridge methods                      |
| `src/preload/index.ts`                         | Modify     | Add `getEmailSettings`, `saveEmailSettings`, `sendTestEmail` to realApi + mockApi + bridgeApi |
| `src/main/ipc/handlers.ts`                     | Modify     | Register handlers for EMAIL_SETTINGS_GET, EMAIL_SETTINGS_SET, EMAIL_TEST                      |
| `src/main/backgroundService.ts`                | Modify     | Call `sendAlertEmail(alert)` from `maybeNotify()` before CRITICAL filter                      |
| `src/main/__tests__/backgroundService.test.ts` | Modify     | Add `vi.mock('../emailService', ...)` so existing tests don't hit nodemailer                  |
| `src/renderer/src/pages/Settings.tsx`          | Modify     | Add "Notifiche Email" card                                                                    |
| `CHANGELOG.md`                                 | Modify     | Add feature entry                                                                             |

---

## Task 1: Install nodemailer

**Files:**

- Modify: `package.json` (via npm)

- [ ] **Step 1: Install runtime + types**

```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

- [ ] **Step 2: Verify install**

```bash
node -e "require('nodemailer'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add nodemailer for email alerting"
```

---

## Task 2: EmailSettings types + IpcChannels

Add types and channel names. No logic yet — just widens the type surface.

**Files:**

- Modify: `src/main/ipc/types.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add 3 IpcChannel entries to `src/main/ipc/types.ts`**

Inside the `IpcChannel` enum (after `DETECT_SERVER_INFO`), add:

```typescript
  // Email alerting
  EMAIL_SETTINGS_GET = 'email:getSettings',
  EMAIL_SETTINGS_SET = 'email:setSettings',
  EMAIL_TEST = 'email:test',
```

- [ ] **Step 2: Add `EmailSettings` and `SaveEmailSettingsRequest` to `src/main/ipc/types.ts`**

After the existing `SaveSettingsRequest` interface (around line 153), add:

```typescript
export interface EmailSettings {
  emailEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpTls: boolean
  emailRecipients: string[]
}

export interface SaveEmailSettingsRequest {
  emailEnabled?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPassword?: string
  smtpTls?: boolean
  emailRecipients?: string[]
}
```

- [ ] **Step 3: Mirror both interfaces in `src/preload/index.d.ts`**

After the existing `SaveSettingsRequest` interface (around line 253), add the same two interfaces (copy-paste — this file is compiled under `tsconfig.web.json` and cannot import from `src/main`).

Also add the 3 new bridge method signatures to the `window.sqlSentinel` interface declaration (find the existing `getSettings` / `saveSettings` declarations and add after them):

```typescript
getEmailSettings(): Promise<IpcResult<EmailSettings>>
saveEmailSettings(req: SaveEmailSettingsRequest): Promise<IpcResult<null>>
sendTestEmail(): Promise<IpcResult<null>>
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/types.ts src/preload/index.d.ts
git commit -m "feat(email): add EmailSettings types and IPC channel names"
```

---

## Task 3: emailSettings store

Key-value store for email configuration, using the same `getDb()` pattern as `settings.ts`.

**Files:**

- Create: `src/main/store/emailSettings.ts`

- [ ] **Step 1: Create `src/main/store/emailSettings.ts`**

```typescript
import { getDb } from './database'

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
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  let recipients: string[] = []
  if (map['email_recipients'] != null) {
    try {
      recipients = JSON.parse(map['email_recipients']) as string[]
    } catch {
      recipients = []
    }
  }
  return {
    emailEnabled: map['email_enabled'] != null ? map['email_enabled'] === 'true' : false,
    smtpHost: map['smtp_host'] ?? '',
    smtpPort: map['smtp_port'] != null ? parseInt(map['smtp_port'], 10) : 587,
    smtpUser: map['smtp_user'] ?? '',
    smtpPassword: map['smtp_password'] ?? '',
    smtpTls: map['smtp_tls'] != null ? map['smtp_tls'] === 'true' : true,
    emailRecipients: recipients
  }
}

export function saveEmailSettings(settings: Partial<EmailSettings>): void {
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  if (settings.emailEnabled != null) upsert.run('email_enabled', String(settings.emailEnabled))
  if (settings.smtpHost != null) upsert.run('smtp_host', settings.smtpHost)
  if (settings.smtpPort != null) upsert.run('smtp_port', String(settings.smtpPort))
  if (settings.smtpUser != null) upsert.run('smtp_user', settings.smtpUser)
  if (settings.smtpPassword != null) upsert.run('smtp_password', settings.smtpPassword)
  if (settings.smtpTls != null) upsert.run('smtp_tls', String(settings.smtpTls))
  if (settings.emailRecipients != null)
    upsert.run('email_recipients', JSON.stringify(settings.emailRecipients))
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/main/store/emailSettings.ts
git commit -m "feat(email): add emailSettings store (key-value pattern)"
```

---

## Task 4: emailService — core logic + tests (TDD)

The service owns transport creation, HTML building, module-level dedup, and sending. Tests are written first.

**Files:**

- Create: `src/main/__tests__/emailService.test.ts`
- Create: `src/main/emailService.ts`

- [ ] **Step 1: Write failing tests in `src/main/__tests__/emailService.test.ts`**

```typescript
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
    expect(call.html).toContain('cpu_high')
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose src/main/__tests__/emailService.test.ts
```

Expected: FAIL — `emailService` not found

- [ ] **Step 3: Create `src/main/emailService.ts`**

```typescript
import nodemailer from 'nodemailer'
import type { Alert, IpcResult } from './ipc/types'
import { getEmailSettings } from './store/emailSettings'
import type { EmailSettings } from './store/emailSettings'

// ---------------------------------------------------------------------------
// Dedup — 15 min per (serverId, category) pair
// ---------------------------------------------------------------------------

const emailDedup = new Map<string, number>()

export function __resetEmailDedupForTests(): void {
  emailDedup.clear()
}

function shouldSendEmail(serverId: string, category: string): boolean {
  const key = `${serverId}::${category}`
  const last = emailDedup.get(key) ?? 0
  if (Date.now() - last < 15 * 60_000) return false
  emailDedup.set(key, Date.now())
  return true
}

// ---------------------------------------------------------------------------
// Transport + email content
// ---------------------------------------------------------------------------

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
  const ts = new Date(timestamp).toLocaleString('it-IT')
  const subject = `${emoji} [SQL Sentinel] ${serverId} — ${category.replace(/_/g, ' ').toUpperCase()} ${severity}`
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px">
  <div style="background:${color};color:#fff;padding:16px;border-radius:8px 8px 0 0">
    <h2 style="margin:0">${emoji} ${severity} — ${category.replace(/_/g, ' ').toUpperCase()}</h2>
    <p style="margin:4px 0 0">Server: <strong>${serverId}</strong></p>
  </div>
  <div style="border:1px solid #e5e7eb;padding:20px;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="padding:6px;color:#6b7280">Timestamp</td>
        <td style="padding:6px;font-weight:bold">${ts}</td>
      </tr>
      <tr>
        <td style="padding:6px;color:#6b7280">Categoria</td>
        <td style="padding:6px;font-weight:bold">${category}</td>
      </tr>
      <tr>
        <td style="padding:6px;color:#6b7280">Livello</td>
        <td style="padding:6px;font-weight:bold;color:${color}">${severity}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:6px;color:#6b7280;border-top:1px solid #e5e7eb">
          <strong>Dettagli:</strong><br/>${message}
        </td>
      </tr>
    </table>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px">
      SQL Sentinel — Monitoring automatico SQL Server<br/>
      Per disabilitare le notifiche email, vai in Impostazioni → Notifiche Email
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
  if (!shouldSendEmail(alert.serverId, alert.category)) return
  const { subject, html } = buildContent(
    alert.serverId,
    alert.category,
    alert.severity,
    alert.message,
    alert.detectedAt.getTime()
  )
  await sendEmail(settings, settings.emailRecipients, subject, html)
}

export async function sendTestEmail(): Promise<IpcResult<null>> {
  const settings = getEmailSettings()
  if (!settings.smtpHost) return { ok: false, error: 'SMTP host non configurato' }
  if (settings.emailRecipients.length === 0)
    return { ok: false, error: 'Nessun destinatario configurato' }
  try {
    const { subject, html } = buildContent(
      'TEST-SERVER',
      'test',
      'WARNING',
      'Questa è una email di test da SQL Sentinel. Configurazione SMTP corretta ✅',
      Date.now()
    )
    await sendEmail(settings, settings.emailRecipients, subject, html)
    return { ok: true, data: null }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/main/__tests__/emailService.test.ts
```

Expected: all PASS

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/main/emailService.ts src/main/__tests__/emailService.test.ts
git commit -m "feat(email): add emailService with nodemailer, dedup, and sendTestEmail"
```

---

## Task 5: IPC handlers

Register the three email channels in the existing `registerIpcHandlers()` function.

**Files:**

- Modify: `src/main/ipc/handlers.ts`

- [ ] **Step 1: Add imports to `src/main/ipc/handlers.ts`**

Near the top (after existing store imports), add:

```typescript
import { getEmailSettings, saveEmailSettings } from '../store/emailSettings'
import type { EmailSettings, SaveEmailSettingsRequest } from './types'
import { sendTestEmail } from '../emailService'
```

Also add `EMAIL_SETTINGS_GET`, `EMAIL_SETTINGS_SET`, `EMAIL_TEST` to the existing `IpcChannel` destructure (already imported from `./types`).

Also add `EmailSettings` and `SaveEmailSettingsRequest` to the existing type imports from `./types`.

- [ ] **Step 2: Add three handlers inside `registerIpcHandlers()`**

Append before the closing `}` of `registerIpcHandlers()`:

```typescript
// EMAIL_SETTINGS_GET
ipcMain.handle(IpcChannel.EMAIL_SETTINGS_GET, async (): Promise<IpcResult<EmailSettings>> => {
  try {
    return { ok: true, data: getEmailSettings() }
  } catch (err) {
    console.error('[IPC] EMAIL_SETTINGS_GET:', safeError(err))
    return { ok: false, error: safeError(err) }
  }
})

// EMAIL_SETTINGS_SET
ipcMain.handle(
  IpcChannel.EMAIL_SETTINGS_SET,
  async (_event: IpcMainInvokeEvent, req: SaveEmailSettingsRequest): Promise<IpcResult<null>> => {
    try {
      saveEmailSettings(req)
      return { ok: true, data: null }
    } catch (err) {
      console.error('[IPC] EMAIL_SETTINGS_SET:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  }
)

// EMAIL_TEST — sendTestEmail() has its own internal try/catch and always returns IpcResult<null>,
// but we wrap in try/catch for consistency and to catch synchronous throws from getEmailSettings().
ipcMain.handle(IpcChannel.EMAIL_TEST, async (): Promise<IpcResult<null>> => {
  try {
    return await sendTestEmail()
  } catch (err) {
    console.error('[IPC] EMAIL_TEST:', safeError(err))
    return { ok: false, error: safeError(err) }
  }
})
```

> **Note:** `safeError` is already defined in `handlers.ts`. If you can't find it, look for a helper that converts `unknown` to `string` — it is used in every existing try/catch block.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handlers.ts
git commit -m "feat(email): add IPC handlers for email settings get/set and test send"
```

---

## Task 6: Preload bridge

Expose the three new IPC channels through the contextBridge to the renderer.

**Files:**

- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add type imports**

In the existing import block from `'../main/ipc/types'`, add `EmailSettings` and `SaveEmailSettingsRequest`:

```typescript
import type {
  ...existing imports...
  EmailSettings,
  SaveEmailSettingsRequest,
} from '../main/ipc/types'
```

- [ ] **Step 2: Add to `realApi`**

After `saveSettings` in `realApi` (around line 388), add:

```typescript
  getEmailSettings: (): Promise<IpcResult<EmailSettings>> =>
    ipcRenderer.invoke(IpcChannel.EMAIL_SETTINGS_GET),

  saveEmailSettings: (req: SaveEmailSettingsRequest): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.EMAIL_SETTINGS_SET, req),

  sendTestEmail: (): Promise<IpcResult<null>> =>
    ipcRenderer.invoke(IpcChannel.EMAIL_TEST),
```

- [ ] **Step 3: Add stubs to `mockApi`**

After `saveSettings` mock stub in `mockApi`, add:

```typescript
  getEmailSettings: (): Promise<IpcResult<EmailSettings>> =>
    Promise.resolve({
      ok: true,
      data: {
        emailEnabled: false,
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPassword: '',
        smtpTls: true,
        emailRecipients: [],
      },
    }),

  saveEmailSettings: (_req: SaveEmailSettingsRequest): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),

  sendTestEmail: (): Promise<IpcResult<null>> =>
    Promise.resolve({ ok: true, data: null }),
```

- [ ] **Step 4: Add to `bridgeApi`**

After `saveSettings: (r: SaveSettingsRequest) => api.saveSettings(r)` in `bridgeApi`, add:

```typescript
  getEmailSettings:  () => api.getEmailSettings(),
  saveEmailSettings: (r: SaveEmailSettingsRequest) => api.saveEmailSettings(r),
  sendTestEmail:     () => realApi.sendTestEmail(),
```

> **Note:** `sendTestEmail` always uses `realApi` (like the export functions) because the mock returns `{ ok: true }` immediately — meaningful only when testing against a real SMTP server.

- [ ] **Step 5: Add re-export entries to the re-export block in `src/preload/index.ts`**

Find the existing re-export block at the top of the file (lines ~41–50 where other types from `../main/ipc/types` are re-exported) and add:

```typescript
export type { EmailSettings, SaveEmailSettingsRequest } from '../main/ipc/types'
```

This allows renderer components to import `EmailSettings` directly from the preload file, consistent with how all other shared types are exposed.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(email): expose email settings and test-send through preload bridge"
```

---

## Task 7: Wire email into BackgroundService

Call `sendAlertEmail()` from `maybeNotify()` before the CRITICAL-only toast filter.

**Files:**

- Modify: `src/main/backgroundService.ts`
- Modify: `src/main/__tests__/backgroundService.test.ts`

- [ ] **Step 1: Add mock for emailService to existing backgroundService tests**

In `src/main/__tests__/backgroundService.test.ts`, add this `vi.mock` alongside the existing `vi.mock('../metricsWorker', ...)`:

```typescript
vi.mock('../emailService', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined)
}))
```

- [ ] **Step 2: Run existing backgroundService tests to confirm they still pass**

```bash
npm test -- --reporter=verbose src/main/__tests__/backgroundService.test.ts
```

Expected: all PASS (mock prevents nodemailer from being called)

- [ ] **Step 3: Add import and call in `src/main/backgroundService.ts`**

Add import (after existing imports):

```typescript
import { sendAlertEmail } from './emailService'
```

In `maybeNotify()`, add a call at the very start (before any filters):

```typescript
private maybeNotify(alert: Alert): void {
  // Email — fires for WARNING and CRITICAL, filtered by emailService settings + dedup
  sendAlertEmail(alert).catch((err) => console.error('[BackgroundService] Email error:', err))

  // Toast — CRITICAL only, hidden window only
  if (alert.severity !== 'CRITICAL') return
  if (this.win.isVisible()) return
  if (!getSettings().backgroundNotifications) return
  // ... rest of existing toast logic unchanged
}
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/backgroundService.ts src/main/__tests__/backgroundService.test.ts
git commit -m "feat(email): dispatch sendAlertEmail from BackgroundService.maybeNotify"
```

---

## Task 8: Settings.tsx — Notifiche Email card

Add the email configuration UI as a new `Card variant="outlined"` at the bottom of the Settings page.

**Files:**

- Modify: `src/renderer/src/pages/Settings.tsx`

- [ ] **Step 1: Read the current Settings.tsx**

Read `src/renderer/src/pages/Settings.tsx` to see the exact current structure before editing.

- [ ] **Step 2: Add state and helpers inside the `Settings()` function**

After the existing background settings state block (around line 95), add:

```typescript
// --- Email settings state ---
const [emailLoaded, setEmailLoaded] = useState(false)
const [emailEnabled, setEmailEnabled] = useState(false)
const [smtpHost, setSmtpHost] = useState('')
const [smtpPort, setSmtpPort] = useState(587)
const [smtpUser, setSmtpUser] = useState('')
const [smtpPassword, setSmtpPassword] = useState('')
const [smtpTls, setSmtpTls] = useState(true)
const [emailRecipients, setEmailRecipients] = useState<string[]>([])
const [recipientInput, setRecipientInput] = useState('')
const [recipientError, setRecipientError] = useState('')
const [testEmailStatus, setTestEmailStatus] = useState<'idle' | 'sending' | 'success' | 'error'>(
  'idle'
)
const [testEmailError, setTestEmailError] = useState('')

useEffect(() => {
  window.sqlSentinel.getEmailSettings().then((res) => {
    if (res.ok) {
      setEmailEnabled(res.data.emailEnabled)
      setSmtpHost(res.data.smtpHost)
      setSmtpPort(res.data.smtpPort)
      setSmtpUser(res.data.smtpUser)
      setSmtpPassword(res.data.smtpPassword)
      setSmtpTls(res.data.smtpTls)
      setEmailRecipients(res.data.emailRecipients)
      setEmailLoaded(true)
    }
  })
}, [])

const saveEmail = (patch: Parameters<typeof window.sqlSentinel.saveEmailSettings>[0]) => {
  window.sqlSentinel.saveEmailSettings(patch).catch((err: unknown) => {
    console.error('[Settings] saveEmailSettings failed:', err)
  })
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const addRecipient = () => {
  const email = recipientInput.trim()
  if (!EMAIL_REGEX.test(email)) {
    setRecipientError('Email non valida')
    return
  }
  if (emailRecipients.includes(email)) {
    setRecipientError('Email già presente')
    return
  }
  if (emailRecipients.length >= 20) {
    setRecipientError('Massimo 20 destinatari')
    return
  }
  const next = [...emailRecipients, email]
  setEmailRecipients(next)
  setRecipientInput('')
  setRecipientError('')
  saveEmail({ emailRecipients: next })
}

const removeRecipient = (email: string) => {
  const next = emailRecipients.filter((r) => r !== email)
  setEmailRecipients(next)
  saveEmail({ emailRecipients: next })
}

const handleTestEmail = async () => {
  setTestEmailStatus('sending')
  setTestEmailError('')
  const result = await window.sqlSentinel.sendTestEmail()
  if (result.ok) {
    setTestEmailStatus('success')
  } else {
    setTestEmailStatus('error')
    setTestEmailError(result.error)
  }
}
```

- [ ] **Step 3: Add the UI card to the JSX return**

After the closing `)}` of the existing `{bgLoaded && (...)}` block (at the end of the JSX), and before the closing `</Box>`, add:

```tsx
{
  /* Card — Notifiche Email */
}
{
  emailLoaded && (
    <Card variant="outlined">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            Notifiche Email
          </Typography>
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={emailEnabled}
              onChange={(e) => {
                setEmailEnabled(e.target.checked)
                saveEmail({ emailEnabled: e.target.checked })
              }}
            />
          }
          label="Abilita notifiche email"
        />

        <Box
          sx={{
            ml: 2,
            opacity: emailEnabled ? 1 : 0.4,
            pointerEvents: emailEnabled ? 'auto' : 'none'
          }}
        >
          <Stack spacing={2}>
            <TextField
              label="SMTP Host"
              size="small"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              onBlur={() => saveEmail({ smtpHost })}
              placeholder="smtp.office365.com"
            />
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField
                label="SMTP Port"
                size="small"
                type="number"
                value={smtpPort}
                inputProps={{ min: 1, max: 65535 }}
                sx={{ width: 120 }}
                onChange={(e) => setSmtpPort(Number(e.target.value))}
                onBlur={() => saveEmail({ smtpPort })}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={smtpTls}
                    onChange={(e) => {
                      setSmtpTls(e.target.checked)
                      saveEmail({ smtpTls: e.target.checked })
                    }}
                  />
                }
                label="TLS/STARTTLS"
              />
            </Stack>
            <TextField
              label="SMTP User (mittente)"
              size="small"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              onBlur={() => saveEmail({ smtpUser })}
              placeholder="alerts@azienda.it"
            />
            <TextField
              label="SMTP Password"
              size="small"
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              onBlur={() => saveEmail({ smtpPassword })}
            />

            {/* Recipient list */}
            <Box>
              <Typography variant="body2" gutterBottom>
                Destinatari ({emailRecipients.length}/20)
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <TextField
                  size="small"
                  placeholder="destinatario@azienda.it"
                  value={recipientInput}
                  onChange={(e) => {
                    setRecipientInput(e.target.value)
                    setRecipientError('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addRecipient()
                    }
                  }}
                  error={!!recipientError}
                  helperText={recipientError}
                  sx={{ flexGrow: 1 }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={addRecipient}
                  disabled={emailRecipients.length >= 20}
                >
                  Aggiungi
                </Button>
              </Stack>
              <Stack spacing={0.5}>
                {emailRecipients.map((email) => (
                  <Stack key={email} direction="row" alignItems="center" spacing={1}>
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>
                      {email}
                    </Typography>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => removeRecipient(email)}
                      sx={{ minWidth: 0, p: 0.5 }}
                    >
                      ❌
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Box>

            {/* Test email */}
            <Box>
              <Button
                variant="outlined"
                size="small"
                onClick={handleTestEmail}
                disabled={
                  testEmailStatus === 'sending' || !smtpHost || emailRecipients.length === 0
                }
              >
                {testEmailStatus === 'sending' ? 'Invio in corso…' : 'Invia email di test'}
              </Button>
              {testEmailStatus === 'success' && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  Email di test inviata con successo
                </Alert>
              )}
              {testEmailStatus === 'error' && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  Errore invio: {testEmailError}
                </Alert>
              )}
            </Box>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  )
}
```

> **Note:** `Alert` in `@mui/material` is already imported (it's used for the existing export error). `Stack` is already imported. `TextField` and `Button` are already imported. Verify the import list before editing — add only what's missing.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Settings.tsx
git commit -m "feat(settings): add Notifiche Email card with SMTP config and test send"
```

---

## Task 9: CHANGELOG

- [ ] **Step 1: Add entry to `CHANGELOG.md`**

Under `## [Unreleased]`, add before the existing tray entry:

```markdown
### Added — 2026-03-24 (email alerting)

- **Notifiche email**: alert WARNING e CRITICAL inviano email HTML via SMTP quando rilevati; disabilitabili da Settings → Notifiche Email
- **Dedup email**: cooldown 15 minuti per coppia (server, categoria) per evitare spam
- **Configurazione SMTP**: host, porta, utente, password, toggle TLS/STARTTLS; persistito nella tabella `settings` come coppie chiave-valore (`email_enabled`, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password`, `smtp_tls`, `email_recipients`)
- **Lista destinatari**: fino a 20 indirizzi email con validazione e rimozione dalla UI
- **Email di test**: pulsante in Settings invia email di prova con stato visualizzato inline
- **Template HTML**: email con header colorato per livello (🔴 CRITICAL / 🟡 WARNING), tabella metriche, footer con link impostazioni
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for email alerting feature"
```
