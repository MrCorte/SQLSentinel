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

- No changes to the renderer, existing IPC channels, or the metrics worker structure
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
  destroy(): void
}

interface WorkerApi {
  syncServers(servers: StoredServer[], overrides?: IntervalOverrides): void
  stopWorker(): void
}
```

`index.ts` changes are minimal (~10 lines): import + instantiation, plus passing `workerApi` wrapper. No changes to the renderer, hooks, or existing IPC handlers.

### Existing Modules — Unchanged

- `metricsWorker.ts` — no structural changes; `BackgroundService` reconfigures it via the existing `syncServers()` API
- `index.ts` health check loop — unchanged
- All IPC channels — unchanged
- Renderer codebase — unchanged

---

## Components

### 1. Window Close Intercept

`BackgroundService` attaches to `win.on('close')`:

```typescript
win.on('close', (e) => {
  if (!this.quitting) {
    e.preventDefault()
    win.hide()
  }
})
```

A `quitting` flag is set to `true` only when the user clicks "Esci" in the tray menu. This is the standard Electron hide-to-tray pattern.

### 2. Tray Icon

- **Icon assets:** `resources/tray-icon.png` (normal) and `resources/tray-icon-alert.png` (red badge variant, shown when CRITICAL alerts are active and unacknowledged)
- Icon switches automatically when CRITICAL alert state changes
- Tray is created on `BackgroundService` construction, destroyed on `destroy()`

### 3. Tray Context Menu

Rebuilt every 30 seconds and on each new CRITICAL alert:

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

- "N server online / M offline" lines are `enabled: false` (display only)
- Status counts read from `serverStore.getAll()` checking `unreachable` field
- "Polling background" label shows current state; click toggles `background_polling_enabled` setting and reconfigures the worker immediately
- "Esci" sets `quitting = true` then calls `app.quit()`

### 4. Background Mode Manager

Triggered by `win.on('hide')` and `win.on('show')`:

**On hide:**
1. Read settings: `background_polling_enabled`, `background_mode`, `background_interval_minutes`
2. If `background_polling_enabled = false` → call `stopWorker()`
3. If `background_mode = 'light'` → call `syncServers(servers, { idleIntervalMs: N, activeIntervalMs: N })` where N = `background_interval_minutes * 60_000`; all servers get the same interval, no "active" priority
4. If `background_mode = 'full'` → no change, worker runs with its normal intervals

**On show:**
1. If worker was stopped → restart via `syncServers(servers)` with default intervals
2. If in light mode → call `syncServers(servers)` with default intervals (restores active/idle/offline tiers)

Settings are read fresh from SQLite on each hide event (never cached).

### 5. Notification Dispatcher

Listens to the existing `ALERT_NEW` push events (via direct event subscription inside the main process — no new IPC needed).

- **Filter:** `severity === 'CRITICAL'` only
- **Window check:** only fires when `!win.isVisible()`
- **Deduplication:** `Map<"${serverId}:${category}", timestamp>` — cooldown 15 minutes per `(server, category)` pair; resets on alert acknowledgement
- **Notification:** uses Electron's built-in `Notification` class (no external dependency)
  ```
  Title: "SQLSentinel — Alert Critico"
  Body:  "[server:port] — CPU al 95% (soglia 90%)"
  ```
- **Click handler:** `win.show()` + `win.focus()`

---

## Settings

Three new keys added to the existing SQLite `settings` table (no schema migration needed — key/value store):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `background_polling_enabled` | `'true'` / `'false'` | `'true'` | Enable/disable background polling |
| `background_mode` | `'light'` / `'full'` | `'light'` | Polling intensity when hidden |
| `background_interval_minutes` | number string | `'30'` | Interval for light mode |

Read/written via existing `SETTINGS_GET` / `SETTINGS_SET` IPC channels.

### Settings UI

New "Background & Tray" section added to the existing Settings page:

```
┌─ Background & Tray ──────────────────────────────────────┐
│ [✓] Mantieni attivo in background alla chiusura           │
│                                                           │
│     Modalità polling background                           │
│     ○ Light  (intervallo: [__30__] min)                   │
│     ● Full   (stesso intervallo del foreground)           │
│                                                           │
│ [✓] Notifiche sistema per alert critici                   │
└───────────────────────────────────────────────────────────┘
```

A fourth setting key `background_notifications_enabled` (`'true'`/`'false'`, default `'true'`) controls whether the notification dispatcher fires.

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
       ├─ subscribes to ALERT_NEW events → maybeNotify()
       └─ starts 30s menu refresh timer

User clicks X (window close)
  → win.on('close') fires → preventDefault() + win.hide()
  → win.on('hide') fires → BackgroundService reads settings → adjusts worker

metricsWorker emits ALERT_NEW (severity=CRITICAL)
  → BackgroundService.maybeNotify() checks dedup + win visibility
  → new Notification(...) → user sees Windows toast

User clicks tray → "Apri SQLSentinel"
  → win.show() + win.focus()
  → win.on('show') fires → BackgroundService restores normal intervals

User clicks tray → "Esci"
  → quitting = true → app.quit()
  → win.on('close') fires without preventDefault → normal shutdown
```

---

## Assets Required

- `resources/tray-icon.png` — 16×16 and 32×32 (normal state)
- `resources/tray-icon-alert.png` — 16×16 and 32×32 (CRITICAL alert active)

These must be included in the electron-vite build. If not present at build time, a fallback to a single asset with no alert variant is acceptable.

---

## Error Handling

- If `Notification` API is unavailable (e.g., older Windows) → catch and log, do not crash
- If `syncServers()` throws → log error, do not interrupt tray or window behavior
- If settings keys are missing → use defaults (no migration needed, key/value store handles missing keys gracefully)

---

## Testing

- Unit test `BackgroundService` in isolation: mock `BrowserWindow`, `Tray`, `Notification`, `serverStore`, and `workerApi`
- Test cases: hide → light mode reconfiguration, hide → polling disabled, show → interval restore, CRITICAL alert → notification fired, WARNING alert → notification not fired, deduplication cooldown, quitting flag behavior
- Existing tests: no changes required (renderer untouched, worker untouched)
