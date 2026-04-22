# SQLSentinel — Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the SQLSentinel codebase into a clean, modular, performant architecture with zero functional regressions.

**Architecture:** Separate IPC handlers from business logic via Service layer; extract a typed `api/ipc.ts` renderer wrapper; split all components > 300 LOC into focused files. Unify server identity to UUID `id` throughout.

**Tech Stack:** Electron 39, React 19, TypeScript strict, MUI v5, Zustand, better-sqlite3, mssql v12, electron-vite.

**Verification commands (run after every task):**

```bash
npm run typecheck   # zero errors required
npm run lint        # zero warnings required
```

---

## Analysis Summary — Key Findings

| Category                | Finding                                                                     | Priority |
| ----------------------- | --------------------------------------------------------------------------- | -------- |
| Monster files           | Inventory 1823 LOC, Sidebar 1372, HomeDashboard 1251, MetricsPanel 861      | HIGH     |
| IPC handlers            | All 42 handlers in one 760-LOC file, business logic mixed in                | HIGH     |
| Preload bridge          | Every method typed 3×: realApi + mockApi + bridgeApi (946 LOC total)        | HIGH     |
| Console.log             | 106 occurrences across 18 files, no logger                                  | HIGH     |
| Prepared statements     | 7 repositories inline `.prepare()` on every call (never cached)             | HIGH     |
| Debounce duplication    | Hand-rolled in Inventory, HomeDashboard, NoteEditor (3 copies)              | MEDIUM   |
| IPC calls in components | 16 files call `window.sqlSentinel` directly (no wrapper layer)              | MEDIUM   |
| `eslint-disable` hooks  | 15 suppressed react-hooks/exhaustive-deps (hidden stale closures)           | MEDIUM   |
| Server identity         | Three conventions coexist: `id` UUID, `"ip:port"` string, legacy `ip` field | MEDIUM   |
| host/ip duality         | `StoredServer` has both `host` and `ip?` fields; normalizer half-migrated   | MEDIUM   |
| Interval leaks          | `deferredPurge` (24h) and dev GC timer not cleared on app quit              | LOW      |
| `noImplicitAny`         | Disabled in `@electron-toolkit/tsconfig`; 27 `any` usages slip through      | LOW      |
| `@types/mssql`          | In `dependencies` instead of `devDependencies`                              | LOW      |

---

## File Map — What Will Be Created / Modified

### New files (main process)

```
src/main/utils/logger.ts              ← structured logger, replaces console.*
src/main/utils/constants.ts           ← shared intervals, limits, magic numbers
src/main/services/ServerService.ts    ← server CRUD business logic (from handlers.ts)
src/main/services/MetricsService.ts   ← metrics orchestration (from handlers.ts)
src/main/services/AlarmService.ts     ← alarm business logic (from handlers.ts)
src/main/services/KnowledgeService.ts ← RAG/AI business logic (from handlers.ts)
src/main/ipc/handlers/servers.ipc.ts  ← server IPC handlers (thin, call Service)
src/main/ipc/handlers/metrics.ipc.ts  ← metrics IPC handlers
src/main/ipc/handlers/alarms.ipc.ts   ← alarm IPC handlers
src/main/ipc/handlers/knowledge.ipc.ts ← knowledge IPC handlers
src/main/ipc/index.ts                  ← registers all handlers
```

### New files (renderer)

```
src/renderer/src/api/ipc.ts                      ← typed wrapper for all window.sqlSentinel.*
src/renderer/src/utils/constants.ts              ← UI magic numbers, refresh intervals
src/renderer/src/utils/logger.ts                 ← renderer-side logger (console wrapper with level gate)
src/renderer/src/hooks/useDebouncedValue.ts      ← replaces 3 hand-rolled debounces
src/renderer/src/hooks/useIpcEvent.ts            ← replaces 5+ useEffect listener patterns
src/renderer/src/hooks/useVisibilityPoll.ts      ← pauses intervals on window blur

src/renderer/src/components/ui/StatusDot.tsx     ← extracted from HomeDashboard
src/renderer/src/components/ui/TruncatedCell.tsx ← extracted from Inventory
src/renderer/src/components/ui/Sparkline.tsx     ← extracted from HomeDashboard

src/renderer/src/components/features/inventory/InventoryFilters.tsx
src/renderer/src/components/features/inventory/InventoryGrid.tsx
src/renderer/src/components/features/inventory/InventoryToolbar.tsx
src/renderer/src/components/features/inventory/useInventoryState.ts

src/renderer/src/components/features/home/ServerRow.tsx
src/renderer/src/components/features/home/KpiCard.tsx
src/renderer/src/components/features/home/useHomeDashboard.ts

src/renderer/src/components/features/sidebar/SidebarTree.tsx
src/renderer/src/components/features/sidebar/SidebarSearch.tsx
src/renderer/src/components/features/sidebar/useSidebarTree.ts

src/renderer/src/components/features/metrics/MetricsTabs.tsx
src/renderer/src/components/features/metrics/useMetricsData.ts
```

### Modified files (major)

```
src/main/ipc/handlers.ts          ← gutted to thin delegating shells, then removed
src/main/index.ts                 ← cleanup: fix interval leaks, use new logger
src/main/store/serverStore.ts     ← eliminate 12 `any` usages, document ip/host migration
src/main/store/metricsRepository.ts ← cache prepared statements at module load
src/main/store/serverRepository.ts  ← cache prepared statements at module load
src/main/authService.ts           ← cache prepared statements at module load
src/main/collectors/sqlCollector.ts ← replace console.* with logger
src/renderer/src/pages/Inventory.tsx     ← shrink to < 300 LOC via extracted components
src/renderer/src/components/HomeDashboard.tsx ← shrink to < 300 LOC
src/renderer/src/components/Sidebar.tsx  ← shrink to < 300 LOC
src/renderer/src/components/MetricsPanel.tsx ← shrink to < 300 LOC
src/renderer/src/store/serversStore.ts   ← remove `any`, use typed normalizer
src/renderer/src/store/agStore.ts        ← fix circular import pattern
src/renderer/src/App.tsx                 ← use useIpcEvent hook, reduce effect count
src/renderer/src/components/AgDashboard.tsx ← use useVisibilityPoll
package.json                             ← move @types/mssql to devDependencies
```

---

## PHASE A — Infrastructure (zero UI risk)

### Task A1: Logger utility (main process)

**Files:**

- Create: `src/main/utils/logger.ts`

- [ ] **Step 1: Create `src/main/utils/logger.ts`**

```typescript
import { app } from 'electron'

type Level = 'debug' | 'info' | 'warn' | 'error'

const isDev = !app.isPackaged

function stamp(): string {
  return new Date().toISOString()
}

function write(level: Level, scope: string, msg: string, ...args: unknown[]): void {
  if (level === 'debug' && !isDev) return
  const line = `[${stamp()}] [${level.toUpperCase()}] [${scope}] ${msg}`
  if (level === 'error') console.error(line, ...args)
  else if (level === 'warn') console.warn(line, ...args)
  else console.log(line, ...args)
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => write('debug', scope, msg, ...args),
    info: (msg: string, ...args: unknown[]) => write('info', scope, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => write('warn', scope, msg, ...args),
    error: (msg: string, ...args: unknown[]) => write('error', scope, msg, ...args)
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck:node
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/utils/logger.ts
git commit -m "feat(infra): add structured logger for main process"
```

---

### Task A2: Logger utility (renderer)

**Files:**

- Create: `src/renderer/src/utils/logger.ts`

- [ ] **Step 1: Create `src/renderer/src/utils/logger.ts`**

```typescript
type Level = 'debug' | 'info' | 'warn' | 'error'

const isDev = import.meta.env.DEV

function write(level: Level, scope: string, msg: string, ...args: unknown[]): void {
  if (level === 'debug' && !isDev) return
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${msg}`
  if (level === 'error') console.error(line, ...args)
  else if (level === 'warn') console.warn(line, ...args)
  else console.log(line, ...args)
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => write('debug', scope, msg, ...args),
    info: (msg: string, ...args: unknown[]) => write('info', scope, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => write('warn', scope, msg, ...args),
    error: (msg: string, ...args: unknown[]) => write('error', scope, msg, ...args)
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/utils/logger.ts
git commit -m "feat(infra): add structured logger for renderer process"
```

---

### Task A3: Replace console.\* with logger — main process (high-traffic files)

Target files in priority order (most calls first):

1. `src/main/ipc/handlers.ts` — 23 occurrences
2. `src/main/collectors/sqlCollector.ts` — 15 occurrences
3. `src/main/store/serverStore.ts` — 10 occurrences
4. `src/main/index.ts` — 10 occurrences
5. `src/main/metricsWorker.ts` — 5 occurrences
6. `src/main/ai/ragIndexer.ts` — 5 occurrences
7. `src/main/collectors/agCollector.ts` — 4 occurrences
8. `src/main/backgroundService.ts` — 2 occurrences
9. `src/main/store/emailSettings.ts` — 2 occurrences
10. `src/main/authService.ts` — 1 occurrence
11. `src/main/store/safeStorageUtil.ts` — 1 occurrence

**Files:** Modify each of the above.

- [ ] **Step 1: In `src/main/ipc/handlers.ts`, add logger import at top**

```typescript
import { createLogger } from '../utils/logger'
const log = createLogger('ipc')
```

Then replace every `console.log(...)` → `log.info(...)`, `console.warn(...)` → `log.warn(...)`, `console.error(...)` → `log.error(...)`.

- [ ] **Step 2: Repeat for each remaining file above** — add the import, create the logger, replace calls. Use the scope name matching the file's purpose (e.g., `'sql-collector'`, `'server-store'`, `'main'`, `'metrics-worker'`, `'rag-indexer'`, `'ag-collector'`, `'background'`, `'email-settings'`, `'auth'`, `'safe-storage'`).

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck:node
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/
git commit -m "refactor(logging): replace console.* with structured logger in main process"
```

---

### Task A4: Replace console.\* with logger — renderer

Target files:

1. `src/renderer/src/App.tsx` — 11 occurrences
2. `src/renderer/src/store/serversStore.ts` — 10 occurrences
3. `src/renderer/src/components/MetricsPanel.tsx` — 2 occurrences
4. `src/renderer/src/store/agStore.ts` — 2 occurrences
5. `src/renderer/src/pages/Settings.tsx` — 2 occurrences
6. `src/renderer/src/components/dialogs/ShrinkDialog.tsx` — 1 occurrence
7. `src/preload/index.ts` — 6 occurrences

**Files:** Modify each of the above; preload uses `createLogger` from `../renderer/src/utils/logger` (or inline a minimal version since preload has restricted imports).

- [ ] **Step 1: In `src/renderer/src/App.tsx`, add logger import**

```typescript
import { createLogger } from './utils/logger'
const log = createLogger('app')
```

Replace all `console.log/warn/error` → `log.info/warn/error`.

- [ ] **Step 2: Repeat for each remaining renderer file** with appropriate scope names.

- [ ] **Step 3: For `src/preload/index.ts`** — inline a minimal dev-only guard since preload cannot import from renderer:

```typescript
const _log = {
  info: (...a: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') console.log('[preload]', ...a)
  },
  warn: (...a: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') console.warn('[preload]', ...a)
  }
}
```

Replace the 6 console calls with `_log.info(...)`.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ src/preload/
git commit -m "refactor(logging): replace console.* with structured logger in renderer and preload"
```

---

### Task A5: Fix interval leaks in main process

**Files:**

- Modify: `src/main/index.ts`

**Context:** Two timers are never cleared on app quit:

1. `deferredPurge` setInterval (24h, line ~171)
2. Dev GC-logging timer (dev only, line ~234)

- [ ] **Step 1: Read `src/main/index.ts` lines 160-280 to find both timer variable names and `cleanupResources`**

Locate `deferredPurge` and the dev GC interval. Add them to `cleanupResources()`:

```typescript
// In cleanupResources(), alongside clearInterval(healthCheckIntervalId):
if (deferredPurgeIntervalId) clearInterval(deferredPurgeIntervalId)
if (devGcIntervalId) clearInterval(devGcIntervalId)
```

Ensure the variable declarations at module level use `let deferredPurgeIntervalId: ReturnType<typeof setInterval> | null = null` (not inline assignment).

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck:node
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "fix(main): clear deferredPurge and dev GC intervals on app quit"
```

---

### Task A6: Cache prepared statements in repositories

**Context:** Every call to `authService`, `metricsRepository`, `serverRepository`, `emailSettings`, `settings`, `ragRepository`, `dbCustomFields` recompiles SQL via `db.prepare(...)`. Cache at module level for a substantial perf win on hot paths.

**Files:**

- Modify: `src/main/authService.ts`
- Modify: `src/main/store/metricsRepository.ts`
- Modify: `src/main/store/serverRepository.ts`
- Modify: `src/main/store/emailSettings.ts`
- Modify: `src/main/store/settings.ts`
- Modify: `src/main/store/ragRepository.ts`

**Pattern to apply in each file:**

Before (current — inline prepare per call):

```typescript
export function getByToken(token: string) {
  const db = getDb()
  return db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
}
```

After (cached — prepare once, reuse):

```typescript
import { getDb } from './database'
import type { Database } from 'better-sqlite3'

let _db: ReturnType<typeof getDb>
let stmtGetByToken: ReturnType<Database['prepare']>

function db() {
  if (!_db) {
    _db = getDb()
    stmtGetByToken = _db.prepare('SELECT * FROM sessions WHERE token = ?')
    // ... init all statements for this module
  }
  return _db
}

export function getByToken(token: string) {
  db() // ensures statements are initialized
  return stmtGetByToken.get(token)
}
```

- [ ] **Step 1: Apply the caching pattern to `src/main/authService.ts`** — identify all 9 inline prepares and create module-level statement variables. Group them in a single lazy-init function `initStmts()`.

- [ ] **Step 2: Apply to `src/main/store/metricsRepository.ts`** — 6 inline prepares. Keep `batchSave` transaction but cache the inner insert statement.

- [ ] **Step 3: Apply to `src/main/store/serverRepository.ts`** — 7 inline prepares.

- [ ] **Step 4: Apply to `src/main/store/emailSettings.ts`**, `settings.ts`, `ragRepository.ts` — 4, 2, 6 prepares respectively.

- [ ] **Step 5: Run typecheck and tests**

```bash
npm run typecheck:node && npm test
```

Expected: no errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/
git commit -m "perf(db): cache prepared statements at module level in all repositories"
```

---

### Task A7: Shared `useDebouncedValue` hook

**Context:** `Inventory.tsx`, `HomeDashboard.tsx`, and `NoteEditor.tsx` each hand-roll a debounce timer. Extract to one hook.

**Files:**

- Create: `src/renderer/src/hooks/useDebouncedValue.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect } from 'react'

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
```

- [ ] **Step 2: Replace hand-rolled debounce in `src/renderer/src/pages/Inventory.tsx`**

Find the `useEffect` with `setTimeout` on the search input (lines ~499-524). Replace with:

```typescript
const debouncedSearch = useDebouncedValue(searchInput, 300)
// Remove the local timer useEffect
// Use debouncedSearch wherever the debounced value was used
```

- [ ] **Step 3: Replace in `src/renderer/src/components/HomeDashboard.tsx`** (lines ~406-417) — same pattern.

- [ ] **Step 4: Replace in `src/renderer/src/components/NoteEditor.tsx`** (lines ~26-33) — use `useDebouncedValue(noteText, 500)` and trigger save via `useEffect([debouncedNoteText])`.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useDebouncedValue.ts src/renderer/src/pages/Inventory.tsx src/renderer/src/components/HomeDashboard.tsx src/renderer/src/components/NoteEditor.tsx
git commit -m "refactor(hooks): extract useDebouncedValue, remove 3 hand-rolled debounce timers"
```

---

### Task A8: Shared `useIpcEvent` hook

**Context:** `App.tsx` sets up 5 IPC event listeners each in its own `useEffect` with the same subscribe/unsubscribe pattern. Extract to one hook.

**Files:**

- Create: `src/renderer/src/hooks/useIpcEvent.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useEffect } from 'react'

/**
 * Subscribes to an IPC push event and cleans up on unmount.
 * The handler must be stable (wrap in useCallback at the call site).
 */
export function useIpcEvent(
  subscribe: (handler: (...args: unknown[]) => void) => () => void,
  handler: (...args: unknown[]) => void
): void {
  useEffect(() => {
    return subscribe(handler)
  }, [subscribe, handler])
}
```

- [ ] **Step 2: Replace the 5 `useEffect` IPC listener patterns in `src/renderer/src/App.tsx`**

Before (current pattern, repeated 5 times):

```typescript
useEffect(() => {
  const unsub = window.sqlSentinel.onMetricsPush((data) => {
    /* handler */
  })
  return () => unsub()
}, []) // eslint-disable-line react-hooks/exhaustive-deps
```

After:

```typescript
const handleMetricsPush = useCallback(
  (data) => {
    /* handler */
  },
  [
    /* real deps */
  ]
)
useIpcEvent(window.sqlSentinel.onMetricsPush, handleMetricsPush)
```

This also eliminates the 5 `eslint-disable-line react-hooks/exhaustive-deps` suppressions.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useIpcEvent.ts src/renderer/src/App.tsx
git commit -m "refactor(hooks): extract useIpcEvent, remove eslint-disable suppressions in App.tsx"
```

---

### Task A9: Typed IPC wrapper layer

**Context:** 16 renderer files call `window.sqlSentinel.*` directly. Centralizing in `api/ipc.ts` means one place to add timeout handling, error normalization, and mock injection.

**Files:**

- Create: `src/renderer/src/api/ipc.ts`

- [ ] **Step 1: Create `src/renderer/src/api/ipc.ts`**

The file re-exports every `window.sqlSentinel` method as a typed function, adding a default 5s timeout:

```typescript
/** Typed wrapper around window.sqlSentinel IPC calls. Import from here, not window directly. */

const DEFAULT_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC timeout after ${ms}ms`)), ms)
    )
  ])
}

const api = window.sqlSentinel

// Servers
export const getServers = () => withTimeout(api.getServers())
export const addServer = (s: Parameters<typeof api.addServer>[0]) => withTimeout(api.addServer(s))
export const removeServer = (id: string) => withTimeout(api.removeServer(id))
export const updateServer = (s: Parameters<typeof api.updateServer>[0]) =>
  withTimeout(api.updateServer(s))

// Metrics
export const collectMetrics = (req: Parameters<typeof api.collectMetrics>[0]) =>
  withTimeout(api.collectMetrics(req), 30_000) // longer timeout for metric collection

// ... repeat for every method on window.sqlSentinel

// Push event pass-throughs (no timeout needed for subscriptions)
export const onMetricsPush = api.onMetricsPush.bind(api)
export const onAlarmPush = api.onAlarmPush?.bind(api)
// ... etc.
```

- [ ] **Step 2: Replace `window.sqlSentinel.*` calls in `src/renderer/src/store/serversStore.ts`** — import from `../../api/ipc` instead.

- [ ] **Step 3: Replace in `src/renderer/src/store/agStore.ts`**.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 5: Commit (partial — more files to migrate in component tasks)**

```bash
git add src/renderer/src/api/ipc.ts src/renderer/src/store/
git commit -m "feat(api): add typed IPC wrapper with timeout; migrate stores off window.sqlSentinel"
```

---

## PHASE B — Main Process Restructuring

### Task B1: Split `handlers.ts` into domain handler files

**Context:** `src/main/ipc/handlers.ts` is 760 LOC with 42 handlers. Split by domain without changing channel names or signatures.

**Files:**

- Create: `src/main/ipc/handlers/servers.ipc.ts`
- Create: `src/main/ipc/handlers/metrics.ipc.ts`
- Create: `src/main/ipc/handlers/alarms.ipc.ts`
- Create: `src/main/ipc/handlers/knowledge.ipc.ts`
- Create: `src/main/ipc/handlers/system.ipc.ts` (auth, settings, discovery, email)
- Create: `src/main/ipc/index.ts` (replaces handlers.ts as registration point)
- Delete: `src/main/ipc/handlers.ts` (after migration)

**Strategy:** Move handler functions grouped by IpcChannel prefix. Keep the `handle<R>` auth-guard wrapper in a shared `src/main/ipc/handleWrapper.ts`.

- [ ] **Step 1: Create `src/main/ipc/handleWrapper.ts`**

Extract the `handle<R>()` wrapper function (currently at handlers.ts line ~138) into its own file:

```typescript
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IpcChannel } from './types'
import { authService } from '../authService'
import { safeError } from '../utils/safeLog'
import { createLogger } from '../utils/logger'

const log = createLogger('ipc')

const AUTH_EXEMPT = new Set<string>([
  IpcChannel.AUTH_LOGIN,
  IpcChannel.AUTH_LOGOUT,
  IpcChannel.AUTH_CHECK,
  IpcChannel.SETTINGS_GET
])

export function handle<R>(
  channel: IpcChannel,
  fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!AUTH_EXEMPT.has(channel)) {
        const token = args[0] as { token?: string } | undefined
        if (!authService.validateToken(token?.token ?? '')) {
          return { ok: false, error: 'Unauthorized' }
        }
      }
      return await fn(event, ...args)
    } catch (err) {
      log.error(`Handler error on ${channel}:`, safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })
}
```

- [ ] **Step 2: Create `src/main/ipc/handlers/servers.ipc.ts`**

Move all `SERVERS_*` and `DISCOVERY_*` handlers from `handlers.ts`. Each handler should:

1. Call `handle(IpcChannel.X, async (_event, args) => { ... })`.
2. Delegate to a service (Task B2 creates these) rather than containing logic inline.

```typescript
import { handle } from '../handleWrapper'
import { IpcChannel } from '../types'
// For now: import the store functions directly (services refactor is Task B2)
import * as serverStore from '../../store/serverStore'

export function registerServerHandlers(): void {
  handle(IpcChannel.SERVERS_GET, async () => serverStore.getServers())
  handle(IpcChannel.SERVERS_ADD, async (_e, args) => serverStore.addServer(args as never))
  // ... all SERVERS_* channels
}
```

- [ ] **Step 3: Create `src/main/ipc/handlers/metrics.ipc.ts`** — move all `METRICS_*` handlers.

- [ ] **Step 4: Create `src/main/ipc/handlers/alarms.ipc.ts`** — move all `ALARMS_*` handlers.

- [ ] **Step 5: Create `src/main/ipc/handlers/knowledge.ipc.ts`** — move all `RAG_*`, `AI_*`, `KNOWLEDGE_*` handlers.

- [ ] **Step 6: Create `src/main/ipc/handlers/system.ipc.ts`** — move `AUTH_*`, `SETTINGS_*`, `EMAIL_*`, `DB_*`, `AG_*` handlers.

- [ ] **Step 7: Create `src/main/ipc/index.ts`**

```typescript
import { registerServerHandlers } from './handlers/servers.ipc'
import { registerMetricsHandlers } from './handlers/metrics.ipc'
import { registerAlarmHandlers } from './handlers/alarms.ipc'
import { registerKnowledgeHandlers } from './handlers/knowledge.ipc'
import { registerSystemHandlers } from './handlers/system.ipc'

export function registerIpcHandlers(): void {
  registerServerHandlers()
  registerMetricsHandlers()
  registerAlarmHandlers()
  registerKnowledgeHandlers()
  registerSystemHandlers()
}
```

- [ ] **Step 8: Update `src/main/index.ts`** to import from `./ipc/index` instead of `./ipc/handlers`.

- [ ] **Step 9: Run typecheck and verify app boots**

```bash
npm run typecheck:node && npm run dev
```

Expected: typecheck clean, app boots, all IPC channels respond normally.

- [ ] **Step 10: Delete old `src/main/ipc/handlers.ts`**

- [ ] **Step 11: Commit**

```bash
git add src/main/ipc/ src/main/index.ts
git commit -m "refactor(ipc): split monolithic handlers.ts into domain handler files"
```

---

### Task B2: Extract Service layer from IPC handlers

**Context:** IPC handlers currently contain business logic. Extract into service files so handlers become thin input→service→output delegators.

**Files:**

- Create: `src/main/services/ServerService.ts`
- Create: `src/main/services/MetricsService.ts`
- Create: `src/main/services/AlarmService.ts`
- Create: `src/main/services/KnowledgeService.ts`
- Modify: all handler files from Task B1

- [ ] **Step 1: Create `src/main/services/ServerService.ts`**

Move all server business logic (CRUD, normalization, discovery coordination) from `servers.ipc.ts`:

```typescript
import { createLogger } from '../utils/logger'
import * as serverStore from '../store/serverStore'

const log = createLogger('server-service')

/** Returns all stored servers, decrypted. */
export async function listServers() {
  return serverStore.getServers()
}

/** Adds a server after validation. Throws on duplicate host:port. */
export async function addServer(params: unknown) {
  // validation + store write
}

// ... all server business logic
```

- [ ] **Step 2: Create `src/main/services/MetricsService.ts`** — move metrics orchestration (not collection, that stays in metricsWorker).

- [ ] **Step 3: Create `src/main/services/AlarmService.ts`** — move alarm query/creation logic.

- [ ] **Step 4: Create `src/main/services/KnowledgeService.ts`** — move RAG/AI orchestration.

- [ ] **Step 5: Update each handler file to call services**

```typescript
// servers.ipc.ts — after service extraction
import { ServerService } from '../../services/ServerService'

export function registerServerHandlers(): void {
  handle(IpcChannel.SERVERS_GET, () => ServerService.listServers())
  handle(IpcChannel.SERVERS_ADD, (_e, args) => ServerService.addServer(args))
  // ...
}
```

- [ ] **Step 6: Run typecheck and tests**

```bash
npm run typecheck && npm test
```

Expected: no errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/ src/main/ipc/handlers/
git commit -m "refactor(architecture): extract Service layer, IPC handlers are now thin delegators"
```

---

## PHASE C — Renderer Component Splitting

### Task C1: Extract UI primitives

**Files:**

- Create: `src/renderer/src/components/ui/StatusDot.tsx`
- Create: `src/renderer/src/components/ui/TruncatedCell.tsx`

- [ ] **Step 1: Create `src/renderer/src/components/ui/StatusDot.tsx`**

Extract the status dot pattern used in HomeDashboard and Sidebar:

```typescript
import React, { memo } from 'react'
import type { SxProps } from '@mui/material'
import { Box } from '@mui/material'

interface StatusDotProps {
  /** green | yellow | red | grey */
  color: string
  size?: number
  glow?: boolean
  sx?: SxProps
}

export const StatusDot = memo(function StatusDot({ color, size = 8, glow, sx }: StatusDotProps) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
        ...(glow && { boxShadow: `0 0 6px 1px ${color}` }),
        ...sx,
      }}
    />
  )
})
```

- [ ] **Step 2: Create `src/renderer/src/components/ui/TruncatedCell.tsx`**

```typescript
import React, { memo } from 'react'
import { Tooltip, Typography } from '@mui/material'

interface TruncatedCellProps {
  text: string
  maxWidth?: number | string
}

export const TruncatedCell = memo(function TruncatedCell({ text, maxWidth = 200 }: TruncatedCellProps) {
  return (
    <Tooltip title={text} placement="top">
      <Typography
        noWrap
        sx={{ maxWidth, overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}
      >
        {text}
      </Typography>
    </Tooltip>
  )
})
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ui/
git commit -m "feat(ui): add reusable StatusDot and TruncatedCell primitives"
```

---

### Task C2: Split `HomeDashboard.tsx` (1251 → ≤ 300 LOC)

**Files:**

- Create: `src/renderer/src/components/features/home/useHomeDashboard.ts`
- Create: `src/renderer/src/components/features/home/KpiCard.tsx`
- Create: `src/renderer/src/components/features/home/ServerRow.tsx`
- Modify: `src/renderer/src/components/HomeDashboard.tsx` (shrink to shell)

- [ ] **Step 1: Create `useHomeDashboard.ts`** — extract all state, IPC calls, filtering, sorting logic from HomeDashboard. The hook returns:

```typescript
interface UseHomeDashboardReturn {
  servers: StoredServer[]
  filteredServers: StoredServer[]
  kpis: { total: number; online: number; offline: number; alarms: number }
  searchInput: string
  setSearchInput: (v: string) => void
  isRefreshing: boolean
  handleRefreshAll: () => void
}
```

- [ ] **Step 2: Extract `KpiCard.tsx`** — move the `memo`'d KpiCard sub-component (currently defined inline in HomeDashboard around line 336) into its own file. Define a clear `KpiCardProps` interface.

- [ ] **Step 3: Extract `ServerRow.tsx`** — move the `memo`'d ServerRow (line ~58) into its own file. Accept row data as typed props. Stable callbacks via `useCallback` in the hook, passed down.

- [ ] **Step 4: Rewrite `HomeDashboard.tsx`** to be a composition shell:

```typescript
import { useHomeDashboard } from './features/home/useHomeDashboard'
import { KpiCard } from './features/home/KpiCard'
import { ServerRow } from './features/home/ServerRow'

export default function HomeDashboard() {
  const { filteredServers, kpis, searchInput, setSearchInput, isRefreshing, handleRefreshAll } =
    useHomeDashboard()
  // Only JSX layout here — no logic
}
```

Target: HomeDashboard.tsx ≤ 250 LOC after split.

- [ ] **Step 5: Migrate inline `style={{...}}` to `sx` constants** — move the 92 inline style objects in the original HomeDashboard into `useMemo`-stabilized constants or styled components in the new files. This prevents memo invalidation in ServerRow.

- [ ] **Step 6: Migrate `window.sqlSentinel.*` calls** in useHomeDashboard to import from `../../api/ipc`.

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/features/home/ src/renderer/src/components/HomeDashboard.tsx
git commit -m "refactor(home): split HomeDashboard into hook + KpiCard + ServerRow (1251 → ≤300 LOC)"
```

---

### Task C3: Split `Sidebar.tsx` (1372 → ≤ 300 LOC)

**Context:** Sidebar conflates 5 concerns: tree state, search, DnD, virtualization (`useVirtualizer`), and visual style.

**Files:**

- Create: `src/renderer/src/components/features/sidebar/useSidebarTree.ts`
- Create: `src/renderer/src/components/features/sidebar/SidebarSearch.tsx`
- Create: `src/renderer/src/components/features/sidebar/SidebarTree.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx` (shrink to shell)

- [ ] **Step 1: Create `useSidebarTree.ts`** — extract:
  - AG group detection state
  - Machine group state
  - Expand/collapse state
  - DnD state (if not using external library)
  - Server filtering by search

Returns:

```typescript
interface UseSidebarTreeReturn {
  flatItems: VirtualItem[] // for react-virtual
  expandedAGs: Set<string>
  expandedMachines: Set<string>
  toggleAG: (id: string) => void
  toggleMachine: (id: string) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
}
```

- [ ] **Step 2: Create `SidebarSearch.tsx`** — the search input box, wrapped in `memo`. Pure presentational.

- [ ] **Step 3: Create `SidebarTree.tsx`** — the virtualized tree list using `useVirtualizer`. Accepts `flatItems` and render callbacks as props. Pure presentational.

- [ ] **Step 4: Rewrite `Sidebar.tsx`** as a composition shell ≤ 250 LOC.

- [ ] **Step 5: Move the 4 memo'd sub-components** (`GroupHeader`, `AgGroupHeader`, `ServerItem`, `MachineHeader`) to `SidebarTree.tsx`.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/features/sidebar/ src/renderer/src/components/Sidebar.tsx
git commit -m "refactor(sidebar): split Sidebar into hook + tree + search (1372 → ≤300 LOC)"
```

---

### Task C4: Split `Inventory.tsx` (1823 → ≤ 300 LOC)

**Context:** Largest file. Mixes: tree expansion, filters, search, DataGrid columns, CSV export, 101 inline styles, 29 `window.sqlSentinel` calls.

**Files:**

- Create: `src/renderer/src/components/features/inventory/useInventoryState.ts`
- Create: `src/renderer/src/components/features/inventory/InventoryFilters.tsx`
- Create: `src/renderer/src/components/features/inventory/InventoryGrid.tsx`
- Create: `src/renderer/src/components/features/inventory/InventoryToolbar.tsx`
- Modify: `src/renderer/src/pages/Inventory.tsx` (shrink to shell)

- [ ] **Step 1: Create `useInventoryState.ts`** — extract all state and IPC logic. Returns:

```typescript
interface UseInventoryStateReturn {
  rows: InventoryRow[]
  columns: GridColDef[]
  searchInput: string
  setSearchInput: (v: string) => void
  filters: InventoryFilters
  setFilter: (key: keyof InventoryFilters, value: unknown) => void
  expandedGroups: Set<string>
  toggleGroup: (id: string) => void
  handleExportCsv: () => void
  isLoading: boolean
}
```

- [ ] **Step 2: Create `InventoryFilters.tsx`** — hosting, AG, environment filter dropdowns. Pure presentational. Takes filter state + setFilter callback as props.

- [ ] **Step 3: Create `InventoryGrid.tsx`** — wraps `<DataGrid>` with the column definitions. Columns defined outside component (stable reference, no re-creation per render). Uses `TruncatedCell` for text columns.

- [ ] **Step 4: Create `InventoryToolbar.tsx`** — search bar + filter row + export button. Pure presentational.

- [ ] **Step 5: Rewrite `Inventory.tsx`** as a composition shell ≤ 200 LOC.

- [ ] **Step 6: Migrate all 29 `window.sqlSentinel.*` calls** in useInventoryState to import from `../../api/ipc`.

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/features/inventory/ src/renderer/src/pages/Inventory.tsx
git commit -m "refactor(inventory): split Inventory into hook + grid + filters + toolbar (1823 → ≤300 LOC)"
```

---

### Task C5: Split `MetricsPanel.tsx` (861 → ≤ 300 LOC)

**Files:**

- Create: `src/renderer/src/components/features/metrics/useMetricsData.ts`
- Create: `src/renderer/src/components/features/metrics/MetricsTabs.tsx`
- Modify: `src/renderer/src/components/MetricsPanel.tsx` (shrink to shell)

- [ ] **Step 1: Create `useMetricsData.ts`** — extract the 7 IPC calls + state (`useMetrics` hook usage, history loading, tab state). Fix the `eslint-disable react-hooks/exhaustive-deps` at line 477 by properly declaring dependencies or using a `useCallback` ref.

- [ ] **Step 2: Create `MetricsTabs.tsx`** — render the 4 tab sub-components (`TabPanoramica`, `TabDatabase`, etc.) as named exports from this file (they're currently defined inline).

- [ ] **Step 3: Rewrite `MetricsPanel.tsx`** as a shell that composes the hook + tabs. ≤ 250 LOC.

- [ ] **Step 4: Migrate `window.sqlSentinel.*` calls** to `api/ipc.ts`.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/features/metrics/ src/renderer/src/components/MetricsPanel.tsx
git commit -m "refactor(metrics): split MetricsPanel into hook + tabs (861 → ≤300 LOC)"
```

---

## PHASE D — Store Normalization

### Task D1: Fix `AgDashboard` visibility-aware polling

**Context:** `AgDashboard.tsx:221` has `setInterval(..., 60_000)` that fires even when the window is in the background, despite the main process already throttling. Add a renderer-side visibility pause.

**Files:**

- Create: `src/renderer/src/hooks/useVisibilityPoll.ts`
- Modify: `src/renderer/src/components/AgDashboard.tsx`

- [ ] **Step 1: Create `useVisibilityPoll.ts`**

```typescript
import { useEffect, useRef } from 'react'

/** Runs `callback` on `intervalMs`, pausing when the document is hidden. */
export function useVisibilityPoll(callback: () => void, intervalMs: number): void {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null

    function start() {
      if (id !== null) return
      id = setInterval(() => savedCallback.current(), intervalMs)
    }

    function stop() {
      if (id === null) return
      clearInterval(id)
      id = null
    }

    function onVisibility() {
      if (document.hidden) stop()
      else start()
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) start()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [intervalMs])
}
```

- [ ] **Step 2: Replace `setInterval` in `src/renderer/src/components/AgDashboard.tsx`**

Find the manual `setInterval` at line ~221:

```typescript
// Before:
const intervalId = setInterval(() => updateAgDetails(connection), 60_000)
// Somewhere: clearInterval(intervalId)

// After — remove the above and use:
useVisibilityPoll(() => {
  if (connection) updateAgDetails(connection)
}, 60_000)
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useVisibilityPoll.ts src/renderer/src/components/AgDashboard.tsx
git commit -m "fix(ag): pause AgDashboard polling when window is hidden"
```

---

### Task D2: Fix `agStore` circular import

**Context:** `agStore.ts` dynamically imports `serversStore` at runtime and calls `useServersStore.getState().updateServer(...)` — a circular store-to-store write.

**Files:**

- Modify: `src/renderer/src/store/agStore.ts`
- Modify: `src/renderer/src/store/serversStore.ts`

- [ ] **Step 1: Move `updateServer` from `agStore.ts` to a caller**

In `agStore.ts`, find the dynamic import + `updateServer` call. Replace it with emitting a Zustand action that the **caller** (component or hook) can apply to serversStore:

```typescript
// agStore: instead of importing serversStore, expose the updated data
// and let the component reconcile stores

// Add to agStore state:
pendingServerUpdates: Record<string, Partial<StoredServer>>

// Instead of calling serversStore.updateServer, push to pendingServerUpdates
```

Then in the component/hook that calls `agStore.updateAgDetails()`, subscribe to `pendingServerUpdates` and flush them to `serversStore`.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/
git commit -m "fix(store): remove circular agStore → serversStore import"
```

---

### Task D3: Eliminate the `serverAliases` key mismatch

**Context:** `groupsStore` stores `serverAliases` keyed by `"ip:port"` string, but servers use UUID `id`. This causes stale lookups when a server's IP changes.

**Files:**

- Modify: `src/renderer/src/store/groupsStore.ts`
- Modify: any component reading `serverAliases` by old key format

- [ ] **Step 1: Read `groupsStore.ts`** to understand the full alias shape and migration path.

- [ ] **Step 2: Change alias key from `"ip:port"` to UUID `id`** in the store type definition:

```typescript
// Before:
serverAliases: Record<string, string> // keyed by "ip:port"

// After:
serverAliases: Record<string, string> // keyed by server UUID id
```

- [ ] **Step 3: Add a migration function** that runs once if `electron-store` has old `"ip:port"` keys — convert them using the current `servers` list.

- [ ] **Step 4: Update all read sites** in components/hooks to use `server.id` as key instead of `` `${server.ip}:${port}` ``.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck:web
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/groupsStore.ts src/renderer/src/
git commit -m "fix(store): migrate serverAliases key from ip:port to UUID id"
```

---

## PHASE E — TypeScript Strictness

### Task E1: Enable `noImplicitAny` and fix `serverStore.ts`

**Context:** The `@electron-toolkit/tsconfig` disables `noImplicitAny`. `serverStore.ts` has 12 `any` casts, the most of any file.

**Files:**

- Modify: `tsconfig.node.json`
- Modify: `tsconfig.web.json`
- Modify: `src/main/store/serverStore.ts`
- Modify: `src/renderer/src/store/serversStore.ts`
- Modify: `src/main/ipc/handleWrapper.ts` (the `any[]` variadic args)

- [ ] **Step 1: Add `"noImplicitAny": true`** to both `tsconfig.node.json` and `tsconfig.web.json` under `compilerOptions`.

- [ ] **Step 2: Run typecheck to see all failures**

```bash
npm run typecheck 2>&1 | head -80
```

Note every file with errors. Fix them in priority order.

- [ ] **Step 3: Fix `src/main/store/serverStore.ts`** — replace the 12 `as any` casts with typed normalizer function:

```typescript
interface RawServerRow {
  id: string
  host: string
  port: number
  // ... all DB columns
  password_enc: string | null
}

function normalizeServerRow(row: RawServerRow): StoredServer {
  const addr = row.host
  return {
    ...row,
    host: addr
    // ip field dropped in normalizer — callers must use .host
  }
}
```

- [ ] **Step 4: Fix `src/renderer/src/store/serversStore.ts`** — the `(result: any)` and `(params: any)` in the normalizer. Define `NormalizedServerResponse` type.

- [ ] **Step 5: Fix `src/main/ipc/handleWrapper.ts`** — change `any[]` args to `unknown[]`:

```typescript
export function handle<R>(
  channel: IpcChannel,
  fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<R> | R
): void {
```

- [ ] **Step 6: Fix remaining `any` occurrences** in other files (ragIndexer `pdfParse as any` → use type assertion with proper type; preload `(srv as any)` → proper type guard).

- [ ] **Step 7: Run typecheck — must be zero errors**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.node.json tsconfig.web.json src/main/ src/renderer/
git commit -m "fix(types): enable noImplicitAny, eliminate 27 any usages"
```

---

## PHASE F — Cleanup

### Task F1: Remove dead code — `serverRepository.ts` vs `serverStore.ts`

**Context:** Both `src/main/store/serverRepository.ts` and `src/main/store/serverStore.ts` appear to persist server data, but only `serverStore.ts` is actively used. `serverRepository.ts` may be dead code.

**Files:**

- Audit: `src/main/store/serverRepository.ts`

- [ ] **Step 1: Verify no active imports**

```bash
grep -r "serverRepository" src/ --include="*.ts" --include="*.tsx"
```

- [ ] **Step 2: If zero active imports**, delete `src/main/store/serverRepository.ts`.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove dead serverRepository (replaced by serverStore)"
```

---

### Task F2: Verify and remove unused dependencies

**Context:** `react-router-dom` and `zod` are declared in `package.json` but usage was not confirmed in the analysis scan.

- [ ] **Step 1: Search for usage**

```bash
grep -r "react-router-dom\|from 'zod'" src/ --include="*.ts" --include="*.tsx"
```

- [ ] **Step 2: If `react-router-dom` is unused**, remove it:

```bash
npm uninstall react-router-dom
```

If used, document where.

- [ ] **Step 3: If `zod` is unused**, remove it:

```bash
npm uninstall zod
```

If used, document where.

- [ ] **Step 4: Move `@types/mssql` to devDependencies** in `package.json`:

```bash
npm install --save-dev @types/mssql
npm uninstall @types/mssql  # removes from dependencies
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): move @types/mssql to devDependencies, remove unused deps"
```

---

### Task F3: IpcResult envelope consistency

**Context:** Most handlers return `IpcResult<T>` but `SERVERS_*` handlers return flat values (explicitly noted in comments at handlers.ts lines 274, 290, 305). Standardize to always return `IpcResult<T>`.

**Files:**

- Modify: `src/main/ipc/handlers/servers.ipc.ts`
- Modify: `src/renderer/src/api/ipc.ts` (unwrap on the renderer side)

- [ ] **Step 1: Wrap server handler returns in `IpcResult`**

Each server handler currently doing:

```typescript
return serverStore.getServers() // returns StoredServer[] directly
```

Change to:

```typescript
const servers = await ServerService.listServers()
return { ok: true, data: servers }
```

- [ ] **Step 2: Update `api/ipc.ts`** to unwrap `IpcResult` envelope uniformly for all calls.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/ src/renderer/src/api/
git commit -m "fix(ipc): standardize IpcResult envelope across all server handlers"
```

---

## PHASE G — Final Verification

### Task G1: Full test and typecheck pass

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck
```

Expected: **zero errors**.

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Expected: **zero warnings**.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: **all tests pass**.

- [ ] **Step 4: Manual smoke test** — run `npm run dev` and verify:
  - App boots without console errors
  - Server inventory loads
  - HomeDashboard KPIs render correctly
  - Auto-refresh works (metrics update at interval)
  - Manual refresh works
  - Alarms drawer opens and shows data
  - AI chat responds
  - Dark/light mode toggle works
  - AgDashboard loads when an AG server is selected
  - Settings page loads

- [ ] **Step 5: Final commit + CHANGELOG entry**

```bash
# Update CHANGELOG.md with refactoring summary
git add CHANGELOG.md
git commit -m "docs(changelog): document complete refactoring (Phases A-G)"
```

---

## Priority Order (if implementation must be partial)

| Priority | Task                     | Why first                                                                |
| -------- | ------------------------ | ------------------------------------------------------------------------ |
| 1        | A1-A4 (Loggers)          | Zero risk, eliminates 106 noisy console calls, needed by all other tasks |
| 2        | A5 (Interval leaks)      | 3-line fix, prevents real memory/resource leak                           |
| 3        | A6 (Prepared stmts)      | High-perf win with low risk, hot path in every poll cycle                |
| 4        | A7 (useDebouncedValue)   | Simple, removes 3 copies of identical code                               |
| 5        | A8 (useIpcEvent)         | Removes 5 eslint suppressions, fixes stale closure risk                  |
| 6        | A9 (api/ipc.ts)          | Unblocks all component migrations, adds timeout safety                   |
| 7        | B1 (Split handlers.ts)   | Makes codebase navigable, prerequisite for B2                            |
| 8        | B2 (Services)            | Separates concerns cleanly                                               |
| 9        | C1-C5 (Component splits) | Biggest file-size wins, most impactful for readability                   |
| 10       | D1-D3 (Store fixes)      | Medium risk, depends on component work being stable                      |
| 11       | E1 (noImplicitAny)       | Most risk, should be last before final verification                      |
| 12       | F1-F3 (Cleanup)          | Dead code removal, dep cleanup                                           |
