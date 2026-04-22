# SQLSentinel — Pre-Release Audit Report

**Date:** 2026-04-21  
**Branch:** feature/ai-assistant  
**Scope:** Full codebase — bugs, i18n, security, performance, edge cases

---

## Legend

| Symbol | Severity | Definition                                               |
| ------ | -------- | -------------------------------------------------------- |
| 🔴     | CRITICAL | Release blocker — ships broken UX or data loss           |
| 🟠     | MEDIUM   | Fix before release — visible to users or silent failures |
| 🟡     | LOW      | Fix next release — minor UX or code quality              |
| 🔵     | INFO     | Future backlog — architectural improvement               |

---

## 🔴 CRITICAL — Release Blockers

### C1 · Italian alert messages shown to users (metricsWorker.ts)

All alert body strings sent to AlertsFeed are in Italian. These are user-visible.

| Line | Current (Italian)                         | Should be                               |
| ---- | ----------------------------------------- | --------------------------------------- |
| 225  | `'CPU al ${cpu}% (soglia: 90%)'`          | `'CPU at ${cpu}% (threshold: 90%)'`     |
| 227  | `'CPU al ${cpu}% (soglia: 70%)'`          | `'CPU at ${cpu}% (threshold: 70%)'`     |
| 234  | `'${n} sessione/i bloccata/e'`            | `'${n} blocking session(s)'`            |
| 241  | (blocking session detail)                 | Translate                               |
| 253  | `'Backup full scaduto/assente: ${dbs}'`   | `'Full backup overdue/missing: ${dbs}'` |
| 264  | (log backup variant)                      | Translate                               |
| 266  | `'Volume spazio critico: ${desc}'`        | `'Volume space critical: ${desc}'`      |
| 272  | `'Volume spazio in esaurimento: ${desc}'` | `'Volume space running low: ${desc}'`   |
| 282  | `'Autogrowth disabilitato: ${desc}'`      | `'Autogrowth disabled: ${desc}'`        |

**File:** `src/main/metricsWorker.ts`

---

### C2 · Italian password-change error messages (authService.ts)

These strings are returned to the renderer and displayed to the user during password change.

| Line | Current (Italian)                 | Should be                         |
| ---- | --------------------------------- | --------------------------------- |
| 177  | `'Utente non trovato'`            | `'User not found'`                |
| 180  | `'Password attuale non corretta'` | `'Current password incorrect'`    |
| 182  | `'Minimo 8 caratteri'`            | `'Minimum 8 characters'`          |
| 183  | `'Almeno una lettera maiuscola'`  | `'At least one uppercase letter'` |
| 184  | `'Almeno un numero'`              | `'At least one number'`           |

**File:** `src/main/authService.ts`

---

### C3 · Memory leak: deleted-server data never purged from renderer stores

When a server is removed, neither `metricsStore` nor `alertsStore` cleans up its entries.

- **metricsStore**: `metricsMap[serverId]`, `summaries[serverId]`, `historyMap[serverId]` all persist. Each server can hold several MB of metrics history in RAM indefinitely.
- **alertsStore**: Unacknowledged alerts for deleted servers persist forever (acknowledged alerts are pruned at 24h, but unacknowledged have no cap and no server-deletion hook).

**Impact:** In a long-running session with server churn, RAM grows unboundedly. For the alertsStore, CRITICAL/WARNING alerts from a deleted server can block the "0 active alerts" state forever.

**Files:** `src/renderer/src/store/metricsStore.ts`, `src/renderer/src/store/alertsStore.ts`

**Fix needed:** Add `deleteServerMetrics(serverId)` and `deleteServerAlerts(serverId)` methods, call them from the REMOVE_SERVER IPC response handler.

---

### C4 · langGraphAgent crash on empty messages array

**File:** `src/main/ai/langGraphAgent.ts` line ~283

```typescript
const last = result.messages[result.messages.length - 1] // crashes if length === 0
```

If `agent.invoke()` returns an empty `messages` array (network error, Ollama timeout, model refusal), this throws `TypeError: Cannot read properties of undefined`. The outer catch in `langGraphAsk()` may or may not be present.

**Impact:** Unhandled exception in main process; IPC call hangs or crashes.

---

## 🟠 MEDIUM — Fix Before Release

### M1 · IPC handlers without try/catch

Several handlers propagate unhandled exceptions. In Electron, an uncaught throw inside `ipcMain.handle()` surfaces as a rejection on the renderer side — but since these handlers use the `handle()` wrapper, the behavior depends on whether `handleWrapper` catches.  
The handlers below have **no local try/catch** and throw synchronously or call functions that can throw:

| File             | Channel              | Line | Risk                                          |
| ---------------- | -------------------- | ---- | --------------------------------------------- |
| `servers.ipc.ts` | `GET_SERVERS`        | ~75  | `listServersLegacy()` could throw             |
| `servers.ipc.ts` | `REMOVE_SERVER`      | ~85  | `removeServer()` could throw, no error return |
| `alarms.ipc.ts`  | `ALERTS_GET_ALL`     | ~13  | `getAlerts()` could throw                     |
| `alarms.ipc.ts`  | `ALERTS_ACKNOWLEDGE` | ~24  | `acknowledgeAlert()` could throw              |

---

### M2 · Italian strings in InventoryDbTable tooltips

| Line | Current (Italian)                   | Should be                          |
| ---- | ----------------------------------- | ---------------------------------- |
| ~176 | `"Sola lettura"` (tooltip)          | `"Read-only"`                      |
| ~245 | `'TDE attivo'` / `'TDE non attivo'` | `'TDE enabled'` / `'TDE disabled'` |
| 313  | `toLocaleDateString('it-IT')`       | `toLocaleDateString('en-US')`      |

**File:** `src/renderer/src/components/features/inventory/InventoryDbTable.tsx`

---

### M3 · Italian strings in SidebarTree

| Line | Current (Italian)                             | Should be                                  |
| ---- | --------------------------------------------- | ------------------------------------------ |
| ~339 | `"istanze"` (instances label)                 | `"instances"` (also needs singular/plural) |
| ~448 | `'tentativo fallito'` / `'tentativi falliti'` | `'failed attempt'` / `'failed attempts'`   |
| ~448 | `'prossimo retry'`                            | `'next retry'`                             |
| ~448 | `toLocaleTimeString('it-IT')`                 | `toLocaleTimeString('en-US')`              |

**File:** `src/renderer/src/components/features/sidebar/SidebarTree.tsx`

---

### M4 · Italian error message in alarms.ipc.ts

**File:** `src/main/ipc/handlers/alarms.ipc.ts` line ~25

```typescript
error: `Alert ${req.alertId} non trovato` // Italian: "not found"
```

This error can reach the renderer and be displayed to users.

---

### M5 · Italian AI tool descriptions in langGraphAgent.ts

The tool descriptions are sent to the LLM as part of the system prompt. They should be in English both for consistency and because the LLM may use them when generating responses visible to users.

| Line | Issue                                                                  |
| ---- | ---------------------------------------------------------------------- |
| ~42  | Tool description `'Metriche correnti di tutti i server monitorati...'` |
| ~68  | Tool description `'Alert attivi (CRITICAL e WARNING)...'`              |
| ~178 | Tool description `'Restituisce una query T-SQL diagnostica...'`        |
| ~180 | Schema description with Italian problem-type keywords                  |

**Related:** The `TSQL_MAP` keys (`cpu_alta`, `query_lente`, `connessioni`, etc.) are Italian. If the LLM selects these keys based on English input, matching may fail depending on the model used.

**File:** `src/main/ai/langGraphAgent.ts`

---

### M6 · ServerDashboard: updateServer() fires without error feedback

**File:** `src/renderer/src/components/ServerDashboard.tsx` lines ~42-45

The hosting-type select onChange calls `updateServer()` (async) without any try/catch or loading state. If the IPC call fails, the dropdown resets visually but the user receives no error message. The button is also not disabled while the update is in flight, allowing rapid re-clicks.

---

### M7 · langGraphAgent: no guard before last-message access

See C4 above. Even if a try/catch is present at the top level, the array access is still a crash point.

```typescript
// Needs guard:
if (!result.messages?.length) throw new Error('Agent returned no messages')
const last = result.messages[result.messages.length - 1]
```

---

## 🟡 LOW — Next Release

### L1 · Italian string in alarms.ipc.ts comments

Lines ~12, ~17: Code comments in Italian (`// ALERTS_GET_ALL — restituisce tutti gli alert`). Developer-facing only, no user impact.

### L2 · Italian error string in database.ts

**Line ~125:** `'Database non inizializzato. Chiamare initDb() prima.'`

Developer-facing; could appear in logs. Low priority but inconsistent.

### L3 · Italian log in ServerService.ts

**Line ~123:** `"rimossi X mock, rimasti: X"` — developer log, never shown to users.

### L4 · metricsStore: pushCapped creates new array on every push

`pushCapped()` uses `.concat()` or spread, allocating a new array each poll cycle for every server. With 60-point ring buffer × N servers, this generates significant GC pressure. Consider mutating in place.

**File:** `src/renderer/src/store/metricsStore.ts`

### L5 · HomeDashboard: no debounce on "Refresh metrics" button

The refresh button has no in-flight guard. Rapid clicking triggers multiple concurrent IPC calls.

**File:** `src/renderer/src/components/HomeDashboard.tsx` line ~107

### L6 · useInventoryState: timer not cancelled on unmount

The throttling timer inside `useInventoryState` is stored in a closure ref. If the component unmounts while the delay is pending, the timer fires and calls setState on an unmounted component.

**File:** `src/renderer/src/components/features/inventory/useInventoryState.ts` lines ~82-88

### L7 · useDiscovery: potential listener leak on double-scan

If `scan()` is called twice rapidly, the second call calls `removeProgressListener()` on the first call's listener before it completes, leaking the first listener.

**File:** `src/renderer/src/hooks/useDiscovery.ts` lines ~24-54

### L8 · InventoryDbTable: Invalid Date display for malformed dates

`new Date(row.lastFullBackup!)`, `new Date(row.lastLogBackup!)`, `new Date(row.createDate)` — if the backend returns a malformed date string, these render `"Invalid Date"` with no fallback.

**File:** `src/renderer/src/components/features/inventory/InventoryDbTable.tsx` lines ~270, ~300, ~313

### L9 · SidebarTree: no singular/plural for instance count

Line ~339 always renders `"N istanze"` (now "N instances" after translation) without handling the singular case ("1 instance").

**File:** `src/renderer/src/components/features/sidebar/SidebarTree.tsx`

---

## 🔵 INFO — Future Backlog

### I1 · SESSION_TIMEOUT_MS hardcoded at 8 hours

Not user-configurable. No warning shown to user as timeout approaches.  
**File:** `src/main/authService.ts`

### I2 · MAX_HISTORY_ACTIVE / MAX_HISTORY_IDLE not configurable

Ring buffer sizes (60 / 10 points) are compile-time constants, not settings.  
**File:** `src/renderer/src/store/metricsStore.ts`

### I3 · No error boundary for HomeDashboard

If `useHomeDashboard()` throws, the entire page crashes to a blank screen with no recovery UI.

### I4 · langGraphAgent TSQL_MAP Italian keys

Keys like `cpu_alta`, `query_lente`, `connessioni` may not match English LLM output reliably. If the LLM returns `"slow_queries"` instead of `"query_lente"`, the lookup silently returns nothing.

### I5 · No de-duplication guard in useDiscovery addServer

If the user double-clicks "Add" rapidly, two concurrent IPC calls fire. The store-level dedup check happens at a different point and may not prevent duplicate entries.

### I6 · database.ts Italian comment at line 125

Internal developer-facing error message. Tracked here for completeness.

---

## i18n Complete Inventory

All remaining Italian strings not yet fixed, ordered by file:

| File                                                                  | Lines                               | Strings                                               |
| --------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `src/main/metricsWorker.ts`                                           | 225,227,234,241,253,264,266,272,282 | 9 alert messages (user-facing)                        |
| `src/main/authService.ts`                                             | 177,180,182,183,184                 | 5 validation messages (user-facing)                   |
| `src/main/ai/langGraphAgent.ts`                                       | ~42,~68,~178,~180                   | 4 tool descriptions + TSQL_MAP keys                   |
| `src/main/ipc/handlers/alarms.ipc.ts`                                 | ~25                                 | 1 error message (user-facing)                         |
| `src/main/store/database.ts`                                          | ~125                                | 1 error message (dev-facing)                          |
| `src/main/services/ServerService.ts`                                  | ~123                                | 1 log message (dev-facing)                            |
| `src/renderer/src/components/features/inventory/InventoryDbTable.tsx` | ~176,~245                           | 2 tooltips (user-facing) + `it-IT` locale at line 313 |
| `src/renderer/src/components/features/sidebar/SidebarTree.tsx`        | ~339,~448                           | 3 strings (user-facing) + `it-IT` locale at line ~448 |

---

## Security Summary

| Item                                                   | Status                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| All SQL queries parameterized                          | ✅                                                              |
| `contextIsolation: true`, `nodeIntegration: false`     | ✅                                                              |
| `sandbox: false`                                       | ⚠️ Required (main process needs Node — documented in CLAUDE.md) |
| Credentials encrypted via safeStorage (DPAPI/Keychain) | ✅                                                              |
| `stripCredentials()` before IPC to renderer            | ✅                                                              |
| IPC auth enforcement via `handleWrapper`               | ✅                                                              |
| Session timeout enforced (8h)                          | ✅                                                              |

No SQL injection, XSS, or credential-leak vulnerabilities found.

---

## TypeScript & Lint

- **TypeScript**: 0 errors (strict mode, split web/node configs)
- **ESLint**: Only Prettier formatting warnings — no logic errors found

---

## Summary by Severity

| Severity    | Count |
| ----------- | ----- |
| 🔴 CRITICAL | 4     |
| 🟠 MEDIUM   | 7     |
| 🟡 LOW      | 9     |
| 🔵 INFO     | 6     |

**Recommended action before release:** Fix all 🔴 CRITICAL and 🟠 MEDIUM items. The 🟡 LOW items are acceptable for this release with no user-blocking impact.
