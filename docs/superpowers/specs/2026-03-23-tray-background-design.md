# Tray Background Service — Design Spec
**Date:** 2026-03-23
**Status:** Approved

---

## Problem

SQLSentinel terminates all polling when the window is closed. For environments with many servers, users need continuous background monitoring (alert detection, health checks) even when the UI is not open. Currently there is no tray icon, no background persistence, and no system-level notifications.

---

## Goals

- Window close hides the app to tray instead of quitting
- Background polling continues while the window is hidden
- CRITICAL alerts trigger Windows system notifications when the window is hidden
- Tray context menu shows live server status and polling controls
- Background polling mode is configurable (light / full / off)

---

## Non-Goals

- No structural refactor of the metrics worker (two small additive exports are required — see Worker API Changes section)
- No new IPC channels
- No push to all users / broadcast notifications
- No mobile or cross-device sync

---

## Architecture

### New Module: `src/main/backgroundService.ts`

A single class `BackgroundService` instantiated once in `src/main/index.ts` after `createWindow()`.

```typescript
class BackgroundService {
  constructor(win: BrowserWindow, workerApi: WorkerApi)
  destroy(): void  // idempotent — see Shutdown section
}

interface WorkerApi {
  syncServers(servers: CollectMetricsRequest[]): void
  stopWorker(): void
  setIntervalOverrides(overrides: IntervalOverrides | null): void
  onAlert(cb: (alert: Alert) => void): void
}

interface IntervalOverrides {
  activeMs: number
  idleMs: number
  offlineMs: number
}
```

`index.ts` changes: ~15 lines — import + instantiation + `destroy()` call in `window-all-closed`.

### Worker API Changes (additive only)

Two minimal additions to `src/main/metricsWorker.ts`:

**`setIntervalOverrides(overrides: IntervalOverrides | null)`**
Stores overrides in a module-level variable (`let intervalOverrides: IntervalOverrides | null = null`). The scheduler reads from it when non-null, otherwise falls back to the existing `INTERVAL_ACTIVE_MS` / `INTERVAL_IDLE_MS` / `INTERVAL_OFFLINE_MS` constants. Calling with `null` restores defaults.

**`onAlert(cb: (alert: Alert) => void)`**
Registers a callback in `let alertCallback: ((a: Alert) => void) | null = null`. Calling `onAlert` a second time **silently replaces** the previous callback — only one subscriber is supported by design (only `BackgroundService` ever subscribes). The callback is invoked inside `processAlerts()` for each alert that passes the worker's own dedup (i.e., only genuinely new alert instances, not repeating open conditions). Note: the worker's dedup and the notification 15-minute cooldown operate at different layers — the worker prevents duplicate `Alert` objects from being created, while the cooldown prevents repeat notifications if a condition clears and re-triggers within 15 minutes.

### `AppSettings` and `SaveSettingsRequest` Changes

Four new optional fields must be added to **all of the following** locations:

| File | Type(s) to update |
|---|---|
| `src/main/store/settings.ts` | `AppSettings` interface + `getSettings()` defaults + `saveSettings()` |
| `src/main/ipc/types.ts` | `AppSettings` interface + `SaveSettingsRequest` interface |
| `src/preload/index.d.ts` | `AppSettings` interface + `SaveSettingsRequest` interface |
| `src/renderer/src/pages/Settings.tsx` | UI + `saveSettings()` call |

New fields:
```typescript
backgroundEnabled: boolean        // default true
backgroundMode: 'light' | 'full' // default 'light'
backgroundIntervalMinutes: number // default 30 (only used when backgroundMode === 'light'; harmlessly ignored in 'full' mode)
backgroundNotifications: boolean  // default true
```

`getSettings()` must return defaults for all four fields when keys are absent from SQLite (no migration needed — key/value store). `SaveSettingsRequest` extends `AppSettings` for these fields (all optional on the request side).

### Existing Modules — Unchanged (except above)

- `metricsWorker.ts` — only the two additive exports above
- `index.ts` health check loop — unchanged
- All IPC channels — unchanged
- Renderer codebase — unchanged (except `Settings.tsx`)

---

## Components

### 1. Window Close Intercept

```typescript
win.on('close', (e) => {
  if (!this.quitting) {
    e.preventDefault()
    win.hide()
  }
})
```

`quitting` is set to `true` only in the "Esci" tray menu handler. The `window-all-closed` event in `index.ts` fires only after the window is actually destroyed (not when hidden), so existing `closeDb()` call is unaffected.

### 2. Tray Icon

**Asset imports** in `backgroundService.ts` (electron-vite `?asset` pattern, same as existing `icon.png?asset` in `index.ts`):
```typescript
import trayIconNormal from '../../../resources/tray-icon.png?asset'
```

For the optional alert variant, derive its path from `trayIconNormal` at runtime (electron-vite resolves `?asset` to an absolute path string):
```typescript
import { existsSync } from 'fs'
import { join, dirname } from 'path'
const alertAssetPath = join(dirname(trayIconNormal), 'tray-icon-alert.png')
const trayIconAlert = existsSync(alertAssetPath) ? alertAssetPath : trayIconNormal
```

In packaged builds, electron-vite copies `?asset` imports to the output directory; `tray-icon.png` is **required** (build will fail if absent). `tray-icon-alert.png` is optional; if absent, both states use the normal icon.

Required assets:
- `resources/tray-icon.png` — 16×16 and 32×32 (**required**)
- `resources/tray-icon-alert.png` — 16×16 and 32×32 (optional, falls back to normal icon)

Icon switches to alert variant when unacknowledged CRITICAL alerts exist; checked on each menu rebuild via `getAlerts()`.

Tray is created on `BackgroundService` construction, destroyed in `destroy()`.

### 3. Tray Context Menu

Rebuilt on two triggers:
- **30s timer** (health-check loop runs every 60s; status counts may lag up to 60s — acceptable)
- **Each new CRITICAL alert** (via `onAlert` callback)

```
Apri SQLSentinel
─────────────────────────
● 12 server online
✕  3 server offline
─────────────────────────
Polling background: Attivo   ← toggleable
─────────────────────────
Esci
```

- Status counts: `serverStore.getAll()` → count by `unreachable` flag
- "Polling background" reflects `backgroundEnabled`; click toggles it, writes via `saveSettings()`, reconfigures worker immediately
- "Esci": sets `quitting = true`, calls `this.destroy()`, then `app.quit()`

### 4. Background Mode Manager

**On `win.hide()` — read settings fresh via `getSettings()`:**

| `backgroundEnabled` | `backgroundMode` | Action |
|---|---|---|
| `false` | — | `stopWorker()` |
| `true` | `'light'` | `setIntervalOverrides({ activeMs: N, idleMs: N, offlineMs: N })` where N = `backgroundIntervalMinutes * 60_000` |
| `true` | `'full'` | no-op (worker runs at normal intervals) |

**On `win.show()`:**
1. `setIntervalOverrides(null)` — restores default intervals
2. If worker was stopped (`backgroundEnabled` was `false` when hidden): call `syncServers(servers)` to restart. `BackgroundService` obtains the server list by calling `serverStore.getAll()` and mapping each `StoredServer` to `CollectMetricsRequest` — the same mapping already used in `index.ts` when `WORKER_START` is handled. `syncServers` adds jobs back and calls `scheduleTick()` internally; no `startWorker` needed. Note: `stopWorker()` clears `previousMetrics`, so the first poll after resume sends full metrics (not a delta) — this is intentional and desirable.

`backgroundIntervalMinutes` is consumed only when `backgroundMode === 'light'`; it is stored but ignored in `'full'` mode.

### 5. Notification Dispatcher

Subscribes via `workerApi.onAlert(cb)` during construction. Note: `onAlert` replaces any prior callback — construction order matters; `BackgroundService` must be the last (and only) caller of `onAlert`.

- **Filter:** `severity === 'CRITICAL'` and `!win.isVisible()`
- **Guarded by:** `getSettings().backgroundNotifications === true`
- **Deduplication:** `Map<string, number>` keyed by `"${alert.serverId}::${alert.category}"` (double-colon avoids ambiguity with the `ip:port` format of `serverId`); value = last notification timestamp; cooldown 15 minutes per `(server, category)` pair
- **Dedup reset on acknowledgement:** on each menu rebuild, check `getAlerts()`; for any CRITICAL alert where `acknowledgedAt !== null`, remove its entry from the dedup map so re-occurrence triggers a new notification
- **Electron `Notification`:**
  ```typescript
  if (!Notification.isSupported()) return  // log and skip on unsupported systems
  const n = new Notification({
    title: 'SQLSentinel — Alert Critico',
    body: `${alert.serverId} — ${alert.message}`
  })
  n.on('click', () => { win.show(); win.focus() })
  n.show()
  ```
  Entire block wrapped in try/catch — notification failure must not crash the app.

---

## Settings

Four keys in the existing SQLite `settings` key/value table. SQLite key names and their `AppSettings` field mappings:

| `AppSettings` field | SQLite key | Default |
|---|---|---|
| `backgroundEnabled` | `background_enabled` | `true` |
| `backgroundMode` | `background_mode` | `'light'` |
| `backgroundIntervalMinutes` | `background_interval_minutes` | `30` |
| `backgroundNotifications` | `background_notifications` | `true` |

`backgroundIntervalMinutes` is only applied when `backgroundMode === 'light'`.

### Settings UI

New "Background & Tray" section in `Settings.tsx`, below the existing retention section:

```
┌─ Background & Tray ──────────────────────────────────────┐
│ [✓] Mantieni attivo in background alla chiusura           │
│                                                           │
│     Modalità polling background                           │
│     ○ Light  (intervallo: [__30__] min)                   │
│     ○ Full   (stesso intervallo foreground)               │
│                                                           │
│ [✓] Notifiche sistema per alert critici                   │
└───────────────────────────────────────────────────────────┘
```

- "Modalità" radio and interval input are disabled when "Mantieni attivo" is unchecked
- Interval input: number, min=1, max=240
- All four fields saved together via `SETTINGS_SET` on change (same pattern as retention control)

---

## Data Flow

```
app.whenReady()
  └─ createWindow() → win
  └─ new BackgroundService(win, workerApi)
       ├─ creates Tray
       ├─ attaches win.on('close') intercept
       ├─ attaches win.on('hide') → reconfigureWorker()
       ├─ attaches win.on('show') → restoreWorker()
       ├─ workerApi.onAlert(cb) → notification dispatcher
       └─ starts 30s menu refresh timer

User clicks X (window close)
  → win.close() fires close event → preventDefault() + win.hide()
  → win.on('hide') → getSettings() → adjusts worker intervals or stops

metricsWorker processAlerts() creates new CRITICAL alert
  → alertCallback(alert) → BackgroundService.maybeNotify()
  → checks isVisible + dedup + backgroundNotifications → Notification.show()

User clicks tray → "Apri SQLSentinel"
  → win.show() + win.focus()
  → win.on('show') → setIntervalOverrides(null) + optional syncServers

User clicks tray → "Esci"
  → quitting = true → this.destroy() → app.quit()
  → window destroyed → window-all-closed fires → destroy() called again (idempotent, no-op)
  → closeDb() → process exits
```

---

## Shutdown Sequence

**Normal quit path (user clicks "Esci"):**
1. `quitting = true`
2. `this.destroy()` — clears timer, destroys tray (first call)
3. `app.quit()` — Electron destroys the window
4. `window-all-closed` fires → `backgroundService?.destroy()` — **second call, must be a no-op**
5. `closeDb()`

`destroy()` is guaranteed to be called **twice** in the normal quit path. Idempotency is mandatory, not optional. Implementation: guard all operations with null/destroyed checks (e.g., `if (this.tray && !this.tray.isDestroyed()) { this.tray.destroy(); this.tray = null }`).

`destroy()` does **not** call `stopWorker()` — in-flight SQL jobs from `metricsWorker` may still be running when `closeDb()` is called. This is a pre-existing race condition unrelated to this feature; resolving it is out of scope.

**`index.ts` `window-all-closed` handler change:**
```typescript
app.on('window-all-closed', () => {
  backgroundService?.destroy()  // ← add this line (idempotent)
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})
```

---

## Error Handling

- `Notification.isSupported()` checked before every notification; unsupported → log + return
- `setIntervalOverrides` / `syncServers` / `getSettings` failures → `console.error`, no crash
- Missing `tray-icon.png` → build-time failure (required asset); missing `tray-icon-alert.png` → runtime fallback to normal icon via `fs.existsSync` check
- `destroy()` must be idempotent and never throw

---

## Testing

Unit tests for `BackgroundService` with mocked `BrowserWindow`, `Tray`, `Notification`, `serverStore`, `getSettings`, and `workerApi`:

| Scenario | Expected |
|---|---|
| `win.hide()` + light mode | `setIntervalOverrides` called with correct ms |
| `win.hide()` + full mode | `setIntervalOverrides` not called |
| `win.hide()` + disabled | `stopWorker` called |
| `win.show()` after disabled | `syncServers` called (restart) |
| `win.show()` after light mode | `setIntervalOverrides(null)` called |
| CRITICAL alert + `win.isVisible() = false` | notification fires |
| WARNING alert | notification not fired |
| CRITICAL alert within 15-min cooldown | notification not fired |
| CRITICAL alert after acknowledgement | dedup cleared → notification fires |
| `quitting = true` + close event | `preventDefault` not called |
| `destroy()` called twice | second call is no-op, no throw |
| `onAlert` called twice | second callback replaces first |

Existing tests: no changes required.
