# Tray Background Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a system tray icon so closing the window hides the app instead of quitting, with background polling, configurable light mode, and CRITICAL alert notifications.

**Architecture:** A new `BackgroundService` class (main process only) owns the tray, intercepts window close, reconfigures the metrics worker on hide/show, and dispatches Windows toast notifications for CRITICAL alerts. Two additive exports are added to `metricsWorker.ts` (`setIntervalOverrides`, `onAlert`) plus performance guards (skip IPC push when hidden, thundering herd stagger, history cap reduction, light field trimming).

**Tech Stack:** Electron `Tray`, `Notification`, `BrowserWindow` APIs; `better-sqlite3` (existing settings store); Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-03-23-tray-background-design.md`

---

## File Map

| File                                           | Action     | Responsibility                                         |
| ---------------------------------------------- | ---------- | ------------------------------------------------------ |
| `src/main/metricsWorker.ts`                    | Modify     | Add `setIntervalOverrides`, `onAlert`, perf guards     |
| `src/main/store/settings.ts`                   | Modify     | Extend `AppSettings` + `getSettings`/`saveSettings`    |
| `src/main/ipc/types.ts`                        | Modify     | Extend `AppSettings` + `SaveSettingsRequest`           |
| `src/preload/index.d.ts`                       | Modify     | Extend `AppSettings` + `SaveSettingsRequest`           |
| `src/main/backgroundService.ts`                | **Create** | Tray, close intercept, bg mode, notifications          |
| `src/main/__tests__/backgroundService.test.ts` | **Create** | Unit tests for BackgroundService                       |
| `src/main/index.ts`                            | Modify     | Instantiate BackgroundService after createWindow       |
| `src/renderer/src/pages/Settings.tsx`          | Modify     | Add "Background & Tray" UI section                     |
| `resources/tray-icon.png`                      | **Create** | Required tray icon (copy from icon.png as placeholder) |
| `resources/tray-icon-alert.png`                | **Create** | Optional alert variant (copy as placeholder)           |

---

## Task 1: Extend AppSettings and SaveSettingsRequest types

Add four new optional fields to all type declarations. No logic changes yet — just widen the interfaces so TypeScript accepts the new keys.

**Files:**

- Modify: `src/main/ipc/types.ts:139-145`
- Modify: `src/preload/index.d.ts:239-245`

- [ ] **Step 1: Update `AppSettings` and `SaveSettingsRequest` in `src/main/ipc/types.ts`**

Replace lines 139–145:

```typescript
export interface AppSettings {
  retentionMinutes: number
  backgroundEnabled: boolean
  backgroundMode: 'light' | 'full'
  backgroundIntervalMinutes: number
  backgroundNotifications: boolean
}

export interface SaveSettingsRequest {
  retentionMinutes?: number
  backgroundEnabled?: boolean
  backgroundMode?: 'light' | 'full'
  backgroundIntervalMinutes?: number
  backgroundNotifications?: boolean
}
```

- [ ] **Step 2: Mirror the same changes in `src/preload/index.d.ts:239-245`**

```typescript
export interface AppSettings {
  retentionMinutes: number
  backgroundEnabled: boolean
  backgroundMode: 'light' | 'full'
  backgroundIntervalMinutes: number
  backgroundNotifications: boolean
}

export interface SaveSettingsRequest {
  retentionMinutes?: number
  backgroundEnabled?: boolean
  backgroundMode?: 'light' | 'full'
  backgroundIntervalMinutes?: number
  backgroundNotifications?: boolean
}
```

- [ ] **Step 3: Verify no typecheck errors**

```bash
npm run typecheck
```

Expected: no errors (or only pre-existing errors unrelated to settings types)

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/types.ts src/preload/index.d.ts
git commit -m "feat(types): extend AppSettings and SaveSettingsRequest for background mode"
```

---

## Task 2: Update settings store (getSettings defaults + saveSettings)

`src/main/store/settings.ts` currently reads/writes only `retentionMinutes`. Extend it to handle the four new keys.

**Files:**

- Modify: `src/main/store/settings.ts`

- [ ] **Step 1: Update `getSettings()` and `saveSettings()` in `src/main/store/settings.ts`**

The existing file uses `import { getDb } from './database'` and calls `const db = getDb()` at function entry. Replicate that pattern exactly. Replace the entire file content:

```typescript
import { getDb } from './database'

export interface AppSettings {
  retentionMinutes: number
  backgroundEnabled: boolean
  backgroundMode: 'light' | 'full'
  backgroundIntervalMinutes: number
  backgroundNotifications: boolean
}

export function getSettings(): AppSettings {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    retentionMinutes: map['retentionMinutes'] != null ? parseInt(map['retentionMinutes'], 10) : 60,
    backgroundEnabled:
      map['background_enabled'] != null ? map['background_enabled'] === 'true' : true,
    backgroundMode: map['background_mode'] === 'full' ? 'full' : 'light',
    backgroundIntervalMinutes:
      map['background_interval_minutes'] != null
        ? parseInt(map['background_interval_minutes'], 10)
        : 30,
    backgroundNotifications:
      map['background_notifications'] != null ? map['background_notifications'] === 'true' : true
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  if (settings.retentionMinutes != null)
    upsert.run('retentionMinutes', String(settings.retentionMinutes))
  if (settings.backgroundEnabled != null)
    upsert.run('background_enabled', String(settings.backgroundEnabled))
  if (settings.backgroundMode != null) upsert.run('background_mode', settings.backgroundMode)
  if (settings.backgroundIntervalMinutes != null)
    upsert.run('background_interval_minutes', String(settings.backgroundIntervalMinutes))
  if (settings.backgroundNotifications != null)
    upsert.run('background_notifications', String(settings.backgroundNotifications))
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/main/store/settings.ts
git commit -m "feat(settings): add background mode settings with defaults"
```

---

## Task 3: metricsWorker — add `onAlert` callback

Add the `alertCallback` module variable and the `onAlert()` export. Invoke the callback inside `processAlerts()`.

**Files:**

- Modify: `src/main/metricsWorker.ts`

- [ ] **Step 1: Write the failing test**

In a new file `src/main/__tests__/metricsWorker.background.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onAlert, __resetForTests } from '../metricsWorker'

// Expose the active callback for white-box testing
// (add a __getAlertCallbackForTest() export to metricsWorker alongside __resetForTests)
import { __getAlertCallbackForTest } from '../metricsWorker'

describe('onAlert', () => {
  beforeEach(() => {
    __resetForTests()
  })

  it('registers a callback that becomes the active one', () => {
    const cb = vi.fn()
    onAlert(cb)
    expect(__getAlertCallbackForTest()).toBe(cb)
  })

  it('replaces previous callback when called twice — only second is active', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    onAlert(cb1)
    onAlert(cb2)
    expect(__getAlertCallbackForTest()).toBe(cb2)
    expect(__getAlertCallbackForTest()).not.toBe(cb1)
  })
})
```

> **Also add to `metricsWorker.ts`** a test-helper export alongside the existing `__resetForTests`:
>
> ```typescript
> export function __getAlertCallbackForTest() {
>   return alertCallback
> }
> ```

- [ ] **Step 2: Run test to verify it fails (module export missing)**

```bash
npm test -- --reporter=verbose src/main/__tests__/metricsWorker.background.test.ts
```

Expected: FAIL — `onAlert is not a function` or similar

- [ ] **Step 3: Add `alertCallback` variable and `onAlert` export to `metricsWorker.ts`**

After the existing module-level variables (around line 52), add:

```typescript
let alertCallback: ((alert: Alert) => void) | null = null
```

After the existing exported functions, add:

```typescript
/**
 * Register a callback invoked for each genuinely new alert (post-dedup).
 * Calling a second time silently replaces the previous callback.
 */
export function onAlert(cb: (alert: Alert) => void): void {
  alertCallback = cb
}
```

Also update `__resetForTests()` to clear it:

```typescript
// inside __resetForTests():
alertCallback = null
```

- [ ] **Step 4: Invoke callback inside `processAlerts()` (around line 185)**

Inside the `if (!hasOpen)` branch, just before `pushToRenderer(IpcChannel.ALERT_NEW, alert)`:

```typescript
if (alertCallback) alertCallback(alert)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/main/__tests__/metricsWorker.background.test.ts
```

Expected: PASS

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/main/metricsWorker.ts src/main/__tests__/metricsWorker.background.test.ts
git commit -m "feat(worker): add onAlert callback for background notification dispatch"
```

---

## Task 4: metricsWorker — add `setIntervalOverrides` + thundering herd stagger

Add interval override support and stagger job `nextRun` times when overrides are applied (avoids all 200 jobs firing simultaneously).

**Files:**

- Modify: `src/main/metricsWorker.ts`

- [ ] **Step 1: Add `IntervalOverrides` interface and module variable**

At the top of `metricsWorker.ts`, after the existing interfaces:

```typescript
export interface IntervalOverrides {
  activeMs: number
  idleMs: number
  offlineMs: number
  lightCollectors?: boolean
  historyCapOverride?: number
}

let intervalOverrides: IntervalOverrides | null = null
```

Also update `__resetForTests()` to clear it:

```typescript
intervalOverrides = null
```

- [ ] **Step 2: Write the failing tests**

In `src/main/__tests__/metricsWorker.background.test.ts`, add:

```typescript
import { setIntervalOverrides, __getJobForTest, syncServers } from '../metricsWorker'
import type { CollectMetricsRequest } from '../../main/ipc/types'

const mockServer: CollectMetricsRequest = {
  ip: '10.0.0.1',
  port: 1433,
  useWindowsAuth: true
}

describe('setIntervalOverrides', () => {
  beforeEach(() => {
    __resetForTests()
  })

  it('accepts overrides without throwing', () => {
    expect(() =>
      setIntervalOverrides({ activeMs: 1000, idleMs: 1000, offlineMs: 1000 })
    ).not.toThrow()
  })

  it('accepts null to restore defaults without throwing', () => {
    setIntervalOverrides({ activeMs: 1000, idleMs: 1000, offlineMs: 1000 })
    expect(() => setIntervalOverrides(null)).not.toThrow()
  })

  it('staggers nextRun across [now, now + N/2] when applied', () => {
    syncServers([mockServer, { ...mockServer, ip: '10.0.0.2' }])
    const before = Date.now()
    setIntervalOverrides({ activeMs: 60_000, idleMs: 60_000, offlineMs: 60_000 })
    const job1 = __getJobForTest('10.0.0.1:1433')!
    const job2 = __getJobForTest('10.0.0.2:1433')!
    expect(job1.nextRun).toBeGreaterThanOrEqual(before)
    expect(job1.nextRun).toBeLessThanOrEqual(before + 30_000 + 100) // N/2 = 30s + small buffer
    expect(job2.nextRun).toBeGreaterThanOrEqual(before)
    expect(job2.nextRun).toBeLessThanOrEqual(before + 30_000 + 100)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose src/main/__tests__/metricsWorker.background.test.ts
```

Expected: FAIL — `setIntervalOverrides is not a function`

- [ ] **Step 4: Implement `setIntervalOverrides`**

Add after `onAlert`:

```typescript
export function setIntervalOverrides(overrides: IntervalOverrides | null): void {
  intervalOverrides = overrides
  if (overrides !== null) {
    // Stagger all jobs across [now, now + N/2] to prevent thundering herd
    const halfInterval = overrides.idleMs / 2
    jobs.forEach((job) => {
      job.nextRun = Date.now() + Math.random() * halfInterval
    })
  }
  // On null (restore): leave existing nextRun values; normal interval tiers resume naturally
}
```

- [ ] **Step 5: Use overrides in the scheduler — update `getIntervalForJob()`**

In the scheduler tick (where `INTERVAL_ACTIVE_MS` / `INTERVAL_IDLE_MS` / `INTERVAL_OFFLINE_MS` are read to compute `nextRun` after a job runs), apply overrides when set. Find the section in `runJob()` around line 242–245 where `job.nextRun` is set on success:

```typescript
// Replace the success nextRun calculation:
const ov = intervalOverrides
if (ov) {
  job.nextRun = Date.now() + (job.priority === 0 ? ov.activeMs : ov.idleMs)
} else {
  job.nextRun = Date.now() + (job.priority === 0 ? activeIntervalMs : INTERVAL_IDLE_MS)
}
```

And the offline/error nextRun (exponential backoff path around line 248–252) should remain unchanged — backoff always applies regardless of overrides.

- [ ] **Step 6: Run tests**

```bash
npm test -- --reporter=verbose src/main/__tests__/metricsWorker.background.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/metricsWorker.ts src/main/__tests__/metricsWorker.background.test.ts
git commit -m "feat(worker): add setIntervalOverrides with thundering herd stagger"
```

---

## Task 5: metricsWorker — performance guards (skip push + history cap + light fields)

Three optimizations active when the window is hidden or in light mode.

**Files:**

- Modify: `src/main/metricsWorker.ts`

- [ ] **Step 1: Skip `METRICS_UPDATED` and `SERVER_HEALTH_UPDATE` push when no visible window**

In `runJob()`, compute the visibility flag once near the top of the success path and use it for both pushes. The spec (Performance §2) specifies both channels must be suppressed; only `ALERT_NEW` passes through (it feeds the `alertCallback`).

Find the `pushToRenderer(IpcChannel.METRICS_UPDATED, ...)` line (around line 216) and the `pushToRenderer(... SERVER_HEALTH_UPDATE ...)` line in the `finally` block (around line 261). Add the guard to both:

```typescript
// Compute once per job execution (before success/error branches):
const hasVisibleWindow = BrowserWindow.getAllWindows().some(
  (w) => !w.isDestroyed() && w.isVisible()
)

// Guard METRICS_UPDATED (success path ~line 216):
if (hasVisibleWindow) {
  pushToRenderer(IpcChannel.METRICS_UPDATED, delta)
}

// Guard SERVER_HEALTH_UPDATE (finally block ~line 261):
if (hasVisibleWindow) {
  pushToRenderer(IpcChannel.SERVER_HEALTH_UPDATE, healthPayload)
}
// ALERT_NEW is always sent — it feeds the onAlert callback used by BackgroundService
```

- [ ] **Step 2: Apply `historyCapOverride` when adding to metricsHistory**

In `runJob()`, find the rolling buffer code around line 210–213:

```typescript
// Replace:
const hist = metricsHistory.get(sid) ?? []
hist.push(enrichedMetrics)
if (hist.length > MAX_HISTORY) hist.shift()
metricsHistory.set(sid, hist)

// With:
const cap = intervalOverrides?.historyCapOverride ?? MAX_HISTORY
const hist = metricsHistory.get(sid) ?? []
hist.push(enrichedMetrics)
while (hist.length > cap) hist.shift()
metricsHistory.set(sid, hist)
```

Also, when `setIntervalOverrides` is called with a `historyCapOverride`, trim existing histories immediately:

```typescript
// In setIntervalOverrides(), after staggering nextRun:
if (overrides?.historyCapOverride != null) {
  const cap = overrides.historyCapOverride
  metricsHistory.forEach((hist, sid) => {
    while (hist.length > cap) hist.shift()
    metricsHistory.set(sid, hist)
  })
}
```

- [ ] **Step 3: Strip heavy fields in light mode (post-collection)**

> **Scope note:** The spec describes skipping entire T-SQL queries in light mode (`collectMetricsCritical()`). Implementing a new collector function requires significant changes across the collectors layer and is deferred. This step achieves the IPC/memory saving (no large payloads stored or sent) by zeroing heavy fields _after_ collection. The SQL query count reduction is a separate future task.

In `runJob()`, after building `enrichedMetrics` and before saving to history, add:

```typescript
if (intervalOverrides?.lightCollectors) {
  // Strip fields not needed for alert evaluation; reduces IPC payload and history memory.
  // Note: full T-SQL query skipping (collectMetricsCritical) is deferred.
  enrichedMetrics = {
    ...enrichedMetrics,
    topQueries: [],
    waitStats: [],
    databaseFiles: []
  }
}
```

- [ ] **Step 4: Run typecheck and tests**

```bash
npm run typecheck && npm test
```

Expected: no errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main/metricsWorker.ts
git commit -m "perf(worker): skip IPC push when hidden, reduce history cap and fields in light mode"
```

---

## Task 6: Tray icon assets

Two PNG files needed. For now, copy the existing `resources/icon.png` as placeholders. A designer will replace them later.

**Files:**

- Create: `resources/tray-icon.png`
- Create: `resources/tray-icon-alert.png`

- [ ] **Step 1: Copy icon.png as both tray icon variants**

```bash
cp resources/icon.png resources/tray-icon.png
cp resources/icon.png resources/tray-icon-alert.png
```

> These are placeholder assets. Replace with proper 16×16 / 32×32 icons before release.

- [ ] **Step 2: Commit**

```bash
git add resources/tray-icon.png resources/tray-icon-alert.png
git commit -m "feat(assets): add placeholder tray icon assets (to be replaced)"
```

---

## Task 7: Create `BackgroundService` — skeleton + tray + window close intercept

Build the class with tray creation and the close-to-hide behavior. No background mode logic yet.

**Files:**

- Create: `src/main/backgroundService.ts`
- Create: `src/main/__tests__/backgroundService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/__tests__/backgroundService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---
const mockTray = {
  destroy: vi.fn(),
  setContextMenu: vi.fn(),
  setImage: vi.fn(),
  isDestroyed: vi.fn(() => false)
}
const MockTray = vi.fn(() => mockTray)
const mockMenu = { popup: vi.fn() }
const MockMenu = { buildFromTemplate: vi.fn(() => mockMenu) }
const mockNotification = { show: vi.fn(), on: vi.fn() }
const MockNotification = vi.fn(() => mockNotification)
MockNotification.isSupported = vi.fn(() => true)

vi.mock('electron', () => ({
  Tray: MockTray,
  Menu: MockMenu,
  Notification: MockNotification,
  app: { quit: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('../store/serverStore', () => ({ getAll: vi.fn(() => []) }))
vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({
    retentionMinutes: 60,
    backgroundEnabled: true,
    backgroundMode: 'light',
    backgroundIntervalMinutes: 30,
    backgroundNotifications: true
  })),
  saveSettings: vi.fn()
}))
vi.mock('../metricsWorker', () => ({
  syncServers: vi.fn(),
  stopWorker: vi.fn(),
  setIntervalOverrides: vi.fn(),
  onAlert: vi.fn(),
  getAlerts: vi.fn(() => [])
}))

// Mock win
function makeMockWin() {
  const listeners: Record<string, Function[]> = {}
  return {
    on: vi.fn((event: string, cb: Function) => {
      ;(listeners[event] ??= []).push(cb)
    }),
    emit: (event: string, ...args: unknown[]) => listeners[event]?.forEach((cb) => cb(...args)),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isVisible: vi.fn(() => true),
    isDestroyed: vi.fn(() => false),
    _listeners: listeners
  }
}

describe('BackgroundService — window close intercept', () => {
  it('hides the window instead of closing when quitting=false', async () => {
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const workerApi = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    new BackgroundService(win, workerApi)
    const preventDefault = vi.fn()
    win.emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(win.hide).toHaveBeenCalled()
  })

  it('does NOT prevent close when quitting=true (Esci clicked)', async () => {
    vi.resetModules()
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const workerApi = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    const svc = new BackgroundService(win, workerApi)
    ;(svc as any).quitting = true
    const preventDefault = vi.fn()
    win.emit('close', { preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npm test -- --reporter=verbose src/main/__tests__/backgroundService.test.ts
```

Expected: FAIL — `BackgroundService` not found

- [ ] **Step 3: Create `src/main/backgroundService.ts` skeleton**

```typescript
import { Tray, Menu, Notification, app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import trayIconNormal from '../../../resources/tray-icon.png?asset'
import type { CollectMetricsRequest, Alert } from './ipc/types'
import type { IntervalOverrides } from './metricsWorker'
import { getSettings, saveSettings } from './store/settings'
import * as serverStore from './store/serverStore'
import { getAlerts, syncServers, stopWorker, setIntervalOverrides } from './metricsWorker'

const alertAssetPath = join(dirname(trayIconNormal), 'tray-icon-alert.png')
const trayIconAlert = existsSync(alertAssetPath) ? alertAssetPath : trayIconNormal

export interface WorkerApi {
  syncServers(servers: CollectMetricsRequest[]): void
  stopWorker(): void
  setIntervalOverrides(overrides: IntervalOverrides | null): void
  onAlert(cb: (alert: Alert) => void): void
}

export class BackgroundService {
  private tray: Tray | null = null
  private menuTimer: ReturnType<typeof setInterval> | null = null
  quitting = false
  private wasStoppedWhenHidden = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly worker: WorkerApi
  ) {
    this.createTray()
    this.attachWindowListeners()
    worker.onAlert((alert) => this.maybeNotify(alert))
    this.menuTimer = setInterval(() => this.rebuildMenu(), 30_000)
  }

  private createTray(): void {
    this.tray = new Tray(trayIconNormal)
    this.rebuildMenu()
    this.tray.on('double-click', () => {
      this.win.show()
      this.win.focus()
    })
  }

  private attachWindowListeners(): void {
    this.win.on('close', (e: Electron.Event) => {
      if (!this.quitting) {
        e.preventDefault()
        this.win.hide()
      }
    })
    this.win.on('hide', () => this.reconfigureWorker())
    this.win.on('show', () => this.restoreWorker())
  }

  private rebuildMenu(): void {
    if (!this.tray || this.tray.isDestroyed()) return
    const servers = serverStore.getAll()
    const online = servers.filter((s) => !s.unreachable).length
    const offline = servers.filter((s) => s.unreachable).length
    const settings = getSettings()
    const hasAlert = getAlerts().some((a) => a.severity === 'CRITICAL' && !a.acknowledgedAt)
    this.tray.setImage(hasAlert ? trayIconAlert : trayIconNormal)
    const menu = Menu.buildFromTemplate([
      {
        label: 'Apri SQLSentinel',
        click: () => {
          this.win.show()
          this.win.focus()
        }
      },
      { type: 'separator' },
      { label: `● ${online} server online`, enabled: false },
      { label: `✕  ${offline} server offline`, enabled: false },
      { type: 'separator' },
      {
        label: `Polling background: ${settings.backgroundEnabled ? 'Attivo' : 'Disattivo'}`,
        click: () => {
          saveSettings({ backgroundEnabled: !settings.backgroundEnabled })
          if (settings.backgroundEnabled) {
            this.worker.stopWorker()
          } else {
            this.restoreWorker()
          }
          this.rebuildMenu()
        }
      },
      { type: 'separator' },
      {
        label: 'Esci',
        click: () => {
          this.quitting = true
          this.destroy()
          app.quit()
        }
      }
    ])
    this.tray.setContextMenu(menu)
  }

  private reconfigureWorker(): void {
    const s = getSettings()
    this.wasStoppedWhenHidden = false
    if (!s.backgroundEnabled) {
      this.worker.stopWorker()
      this.wasStoppedWhenHidden = true
    } else if (s.backgroundMode === 'light') {
      const ms = s.backgroundIntervalMinutes * 60_000
      this.worker.setIntervalOverrides({
        activeMs: ms,
        idleMs: ms,
        offlineMs: ms,
        lightCollectors: true,
        historyCapOverride: 3
      })
    }
    // 'full' mode: no change
  }

  private restoreWorker(): void {
    this.worker.setIntervalOverrides(null)
    if (this.wasStoppedWhenHidden) {
      const servers = serverStore.getAll().map(
        (s) =>
          ({
            ip: s.host,
            port: s.port,
            instanceName: s.instanceName,
            useWindowsAuth: s.useWindowsAuth,
            username: s.username,
            password: s.password
          }) as CollectMetricsRequest
      )
      this.worker.syncServers(servers)
      this.wasStoppedWhenHidden = false
    }
  }

  private readonly notifyDedup = new Map<string, number>()

  private maybeNotify(alert: Alert): void {
    if (alert.severity !== 'CRITICAL') return
    if (this.win.isVisible()) return
    if (!getSettings().backgroundNotifications) return
    // Reset dedup for acknowledged alerts
    getAlerts()
      .filter((a) => a.severity === 'CRITICAL' && a.acknowledgedAt)
      .forEach((a) => this.notifyDedup.delete(`${a.serverId}::${a.category}`))
    const key = `${alert.serverId}::${alert.category}`
    const last = this.notifyDedup.get(key) ?? 0
    if (Date.now() - last < 15 * 60_000) return
    this.notifyDedup.set(key, Date.now())
    try {
      if (!Notification.isSupported()) return
      const n = new Notification({
        title: 'SQLSentinel — Alert Critico',
        body: `${alert.serverId} — ${alert.message}`
      })
      n.on('click', () => {
        this.win.show()
        this.win.focus()
      })
      n.show()
    } catch (err) {
      console.error('[BackgroundService] Notification error:', err)
    }
  }

  destroy(): void {
    if (this.menuTimer) {
      clearInterval(this.menuTimer)
      this.menuTimer = null
    }
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --reporter=verbose src/main/__tests__/backgroundService.test.ts
```

Expected: PASS

- [ ] **Step 5: Run full test suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: no errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/backgroundService.ts src/main/__tests__/backgroundService.test.ts
git commit -m "feat(tray): add BackgroundService with tray, close intercept, bg mode, notifications"
```

---

## Task 8: Additional BackgroundService unit tests

Cover the remaining scenarios from the spec test matrix.

**Files:**

- Modify: `src/main/__tests__/backgroundService.test.ts`

- [ ] **Step 1: Add tests for background mode reconfiguration**

Append to the test file:

```typescript
describe('BackgroundService — background mode manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls setIntervalOverrides with correct ms on hide (light mode)', async () => {
    vi.resetModules()
    const settingsMock = {
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60
      })),
      saveSettings: vi.fn()
    }
    vi.doMock('../store/settings', () => settingsMock)
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    new BackgroundService(win, worker)
    win.emit('hide')
    expect(worker.setIntervalOverrides).toHaveBeenCalledWith(
      expect.objectContaining({
        activeMs: 30 * 60_000,
        lightCollectors: true,
        historyCapOverride: 3
      })
    )
  })

  it('calls stopWorker on hide when backgroundEnabled=false', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: false,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    new BackgroundService(win, worker)
    win.emit('hide')
    expect(worker.stopWorker).toHaveBeenCalled()
  })

  it('calls setIntervalOverrides(null) on show', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'full',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn()
    }
    new BackgroundService(win, worker)
    win.emit('show')
    expect(worker.setIntervalOverrides).toHaveBeenCalledWith(null)
  })
})

describe('BackgroundService — notifications', () => {
  it('does not notify for WARNING alerts', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60
      })),
      saveSettings: vi.fn()
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    win.isVisible.mockReturnValue(false)
    let capturedCb: Function | null = null
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn((cb) => {
        capturedCb = cb
      })
    }
    new BackgroundService(win, worker)
    capturedCb!({
      severity: 'WARNING',
      serverId: 'x',
      category: 'cpu_high',
      message: 'test',
      detectedAt: new Date(),
      acknowledgedAt: null,
      id: '1'
    })
    expect(MockNotification).not.toHaveBeenCalled()
  })

  it('notifies for CRITICAL alerts when window hidden', async () => {
    vi.resetModules()
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60
      })),
      saveSettings: vi.fn()
    }))
    vi.doMock('../metricsWorker', () => ({
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn((cb: Function) => {
        /* store cb for test */
      }),
      getAlerts: vi.fn(() => [])
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    win.isVisible.mockReturnValue(false)
    let capturedCb: Function | null = null
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn((cb) => {
        capturedCb = cb
      })
    }
    new BackgroundService(win, worker)
    capturedCb!({
      severity: 'CRITICAL',
      serverId: '10.0.0.1:1433',
      category: 'cpu_high',
      message: 'CPU 95%',
      detectedAt: new Date(),
      acknowledgedAt: null,
      id: '1'
    })
    expect(MockNotification).toHaveBeenCalled()
    expect(mockNotification.show).toHaveBeenCalled()
  })

  it('does not re-notify within 15-minute cooldown', async () => {
    vi.resetModules()
    vi.clearAllMocks() // reset MockNotification call count from prior tests
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        backgroundEnabled: true,
        backgroundMode: 'light',
        backgroundIntervalMinutes: 30,
        backgroundNotifications: true,
        retentionMinutes: 60
      })),
      saveSettings: vi.fn()
    }))
    vi.doMock('../metricsWorker', () => ({
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn(),
      getAlerts: vi.fn(() => [])
    }))
    const { BackgroundService } = await import('../backgroundService')
    const win = makeMockWin() as any
    win.isVisible.mockReturnValue(false)
    let capturedCb: Function | null = null
    const worker = {
      syncServers: vi.fn(),
      stopWorker: vi.fn(),
      setIntervalOverrides: vi.fn(),
      onAlert: vi.fn((cb) => {
        capturedCb = cb
      })
    }
    new BackgroundService(win, worker)
    const alert = {
      severity: 'CRITICAL' as const,
      serverId: '10.0.0.1:1433',
      category: 'cpu_high' as const,
      message: 'CPU 95%',
      detectedAt: new Date(),
      acknowledgedAt: null,
      id: '1'
    }
    capturedCb!(alert)
    capturedCb!(alert) // second call — should be deduped
    expect(MockNotification).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --reporter=verbose src/main/__tests__/backgroundService.test.ts
```

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/backgroundService.test.ts
git commit -m "test(tray): add full BackgroundService test coverage"
```

---

## Task 9: Wire BackgroundService into `index.ts`

Instantiate `BackgroundService` after `createWindow()` and call `destroy()` on shutdown.

**Files:**

- Modify: `src/main/index.ts`

- [ ] **Step 1: Add import and instantiation**

At the top of `src/main/index.ts`, add the import (alongside existing imports):

```typescript
import { BackgroundService } from './backgroundService'
import type { WorkerApi } from './backgroundService'
import { syncServers, stopWorker, setIntervalOverrides, onAlert } from './metricsWorker'
```

After `createWindow()` is called (around line 143, after `registerIpcHandlers()`), add:

```typescript
const workerApi: WorkerApi = { syncServers, stopWorker, setIntervalOverrides, onAlert }
let backgroundService: BackgroundService | null = null
if (mainWindow) {
  backgroundService = new BackgroundService(mainWindow, workerApi)
}
```

- [ ] **Step 2: Call `destroy()` in `window-all-closed`**

Find the existing `window-all-closed` handler (around line 181):

```typescript
app.on('window-all-closed', () => {
  backgroundService?.destroy() // add this line — idempotent
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Smoke test — start the app**

```bash
npm run dev
```

Expected: app opens, tray icon visible in system tray, window X button hides instead of closing, tray "Apri" reopens it, "Esci" quits cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(tray): integrate BackgroundService into app lifecycle"
```

---

## Task 10: Settings.tsx — Background & Tray section

Add the UI controls for the four new settings fields.

**Files:**

- Modify: `src/renderer/src/pages/Settings.tsx`

- [ ] **Step 1: Extend Settings component to load and save background settings**

In `Settings.tsx`, the component currently loads `retentionMinutes` from `useWorker()`. Add a local state block for background settings. At the top of the `Settings()` function body, after existing state:

```typescript
const [bgEnabled, setBgEnabled] = React.useState(true)
const [bgMode, setBgMode] = React.useState<'light' | 'full'>('light')
const [bgInterval, setBgInterval] = React.useState(30)
const [bgNotifications, setBgNotifications] = React.useState(true)
const [bgLoaded, setBgLoaded] = React.useState(false)

React.useEffect(() => {
  window.sqlSentinel.getSettings().then((res) => {
    if (res.ok) {
      setBgEnabled(res.data.backgroundEnabled)
      setBgMode(res.data.backgroundMode)
      setBgInterval(res.data.backgroundIntervalMinutes)
      setBgNotifications(res.data.backgroundNotifications)
      setBgLoaded(true)
    }
  })
}, [])

const saveBgSettings = (
  patch: Partial<{
    backgroundEnabled: boolean
    backgroundMode: 'light' | 'full'
    backgroundIntervalMinutes: number
    backgroundNotifications: boolean
  }>
) => {
  window.sqlSentinel.saveSettings(patch)
}
```

- [ ] **Step 2: Add the UI section**

Below the existing retention section (before the closing `</Box>` of the main container), add:

```tsx
{
  bgLoaded && (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h6" gutterBottom>
        Background & Tray
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={bgEnabled}
            onChange={(e) => {
              setBgEnabled(e.target.checked)
              saveBgSettings({ backgroundEnabled: e.target.checked })
            }}
          />
        }
        label="Mantieni attivo in background alla chiusura"
      />
      <Box
        sx={{
          mt: 2,
          ml: 2,
          opacity: bgEnabled ? 1 : 0.4,
          pointerEvents: bgEnabled ? 'auto' : 'none'
        }}
      >
        <Typography variant="body2" sx={{ mb: 1 }}>
          Modalità polling background
        </Typography>
        <RadioGroup
          value={bgMode}
          onChange={(e) => {
            const v = e.target.value as 'light' | 'full'
            setBgMode(v)
            saveBgSettings({ backgroundMode: v })
          }}
        >
          <FormControlLabel
            value="light"
            control={<Radio />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <span>Light — intervallo:</span>
                <TextField
                  type="number"
                  size="small"
                  value={bgInterval}
                  disabled={bgMode !== 'light'}
                  inputProps={{ min: 1, max: 240 }}
                  sx={{ width: 80 }}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(240, Number(e.target.value)))
                    setBgInterval(v)
                    saveBgSettings({ backgroundIntervalMinutes: v })
                  }}
                />
                <span>min</span>
              </Box>
            }
          />
          <FormControlLabel
            value="full"
            control={<Radio />}
            label="Full — stesso intervallo del foreground"
          />
        </RadioGroup>
      </Box>
      <Box sx={{ mt: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={bgNotifications}
              onChange={(e) => {
                setBgNotifications(e.target.checked)
                saveBgSettings({ backgroundNotifications: e.target.checked })
              }}
            />
          }
          label="Notifiche sistema per alert critici"
        />
      </Box>
    </Box>
  )
}
```

Add any missing MUI imports at the top of the file (check which of `RadioGroup`, `Radio`, `TextField`, `FormControlLabel`, `Switch` are already imported).

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Smoke test the Settings page**

```bash
npm run dev
```

Navigate to Settings. Verify the "Background & Tray" section appears, toggles work, values persist after app restart.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Settings.tsx
git commit -m "feat(settings): add Background & Tray configuration UI"
```

---

## Task 11: CHANGELOG update

- [ ] **Step 1: Add entry to CHANGELOG.md**

Under `## [Unreleased]`, add:

```markdown
### Added — 2026-03-23 (tray background service)

- **Tray icon**: app ora si nasconde nella system tray alla chiusura della finestra (X) invece di uscire; doppio-click sull'icona o "Apri SQLSentinel" nel menu contestuale riapre la finestra; "Esci" nel menu chiude l'app completamente
- **Polling background**: il worker continua a girare con la finestra nascosta; configurabile tra modalità _Light_ (intervallo personalizzabile, solo 4 query critiche, history cap 3) e _Full_ (intervalli invariati)
- **Notifiche sistema**: alert CRITICAL inviano notifiche Windows toast quando la finestra è nascosta; cooldown 15 min per coppia (server, categoria); si ripristina all'acknowledgement; disabilitabili da Settings
- **Menu tray contestuale**: mostra N server online / M offline, toggle polling background, Esci
- **Performance**: `METRICS_UPDATED` IPC push saltato quando nessuna finestra visibile; thundering herd evitato staggerando `nextRun` su `[now, now+N/2]`; history cap ridotto a 3 in light mode; `topQueries`, `waitStats`, `databaseFiles` azzerati in light mode
- **Settings**: nuova sezione "Background & Tray" con 4 parametri (`backgroundEnabled`, `backgroundMode`, `backgroundIntervalMinutes`, `backgroundNotifications`)
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for tray background service"
```
