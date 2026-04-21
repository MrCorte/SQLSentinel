# Changelog — SQL Sentinel

All relevant changes are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed — 2026-04-20 (UI Dark Accent restyling)
- **Design tokens**: added gradient strings (`primaryGradient`, `successGradient`, `warningGradient`, `errorGradient`), glow shadow tokens (`dotGlowSuccess/Error/Warning`) and `borderDark` in `tokens.ts`
- **MUI theme**: thin border `rgba(255,255,255,0.08)` on Paper elevation0/1 in dark mode; border on `filled` Chip via `tokens.color.dividerDark`; darker table headers (`#0f1f3d`); inset accent stripe on the active sidebar item
- **StatusDot** (Sidebar): added green/red glow `boxShadow` on server status dots
- **KpiCard** (MetricsPanel): `borderColor` uses a theme callback to apply a 20% accent tint in dark mode
- **Legend dots** (HomeDashboard): consistent glow on all server status legend dots (Online/Offline/Unreachable)
- **ReplicaCard PRIMARY** (AgDashboard): blue glow outline `0 0 0 1px rgba(0,120,212,0.25)` to distinguish the primary replica

### Fixed — 2026-04-20 (bug audit)
- **BUG-01** `metricsWorker`: `metrics.backupStatus` accessed without null-guard in `evaluateAlerts()` — silent crash that disabled all subsequent alerts; fix: `(metrics.backupStatus ?? [])`
- **BUG-02** `index.ts`: REVERTED — `sandbox: false` is required because `@electron-toolkit/preload` is a Node.js module; removing it breaks the preload with `Error: module not found: @electron-toolkit/preload`; the security boundary is guaranteed by `contextIsolation: true` + `nodeIntegration: false`
- **BUG-03** `dbAdmin.ts`: `DBCC SHRINKFILE` was using `sqEscape()` + string interpolation for the file name — replaced with bracket escaping `[${name.replace(/]/g,']]')}]`; removed now-unused `sqEscape` function
- **BUG-04** `settings.ts`: `parseInt()` not validated for `NaN` — added `safeInt()` helper with fallback; `setTimeout(fn, NaN)` would never fire on a corrupted DB
- **BUG-05** `handlers.ts`: added `resetAgent()` call in the `SERVERS_UPDATE` and `SERVERS_REMOVE_BY_ID` handlers — the LangGraph singleton was never reset after server changes, causing stale context in AI responses
- **BUG-06** `index.ts`: replaced `mainWindow!.isDestroyed()` and `mainWindow!.webContents.send()` with optional chaining `mainWindow?.webContents.send()` — the non-null assertion could crash in an async Promise chain after the window had already been destroyed
- **BUG-07** `ServerHistoryChart.tsx`: `memHistory[i]` aligned by index — if `cpuHistory` and `memHistory` had different lengths (live update), RAM data was mapped to the wrong timestamp; fix: alignment via `Map<ts, value>`
- **BUG-08** `metricsRepository.ts`: `findHistory(0)` produced `datetime('now', '0 days')` returning only today's records instead of all; fix: explicit branch for `days === 0` with no time filter
- **BUG-09** `AIPanel.tsx`: in-flight `aiAgentAsk` not cancelled on unmount — added `mountedRef` to prevent state update on unmounted component

### Security — 2026-03-31 (credentials encryption at rest)
- **Password encryption**: SQL Server passwords are no longer written as plaintext in the `electron-store` JSON file on disk — uses Electron's `safeStorage` (Windows DPAPI / macOS Keychain / Linux Secret Service) to encrypt at rest with `encryptedPassword` in base64
- **Automatic migration**: on first launch the app detects plaintext passwords in the existing JSON file and migrates them transparently via `migrateEncryptCredentials()` — zero manual intervention required
- The renderer still receives `password` via IPC in memory (local in-process channel, acceptable threat model for a desktop app)

### Performance — 2026-03-31 (metrics IPC batching)
- **`METRICS_BATCH_UPDATED`**: new IPC channel that groups all updates from a polling cycle into a single message — down from 120 separate IPC calls with 200+ servers to 1–2 messages per cycle
- **`enqueueBatchPush` + `flushMetricsBatch`**: individual job pushes are queued and sent via microtask flush (`Promise.resolve().then()`), compatible with Vitest fake timers
- **`applyDeltaBatch()`** in `metricsStore`: single Zustand transaction for all batch updates — reduces renderer re-renders
- **`pushSnapshotBatch()`** in `WorkerContext`: updates both the Zustand store and `historyMapRef` in a single pass for all servers in the batch

### Fixed — 2026-03-31 (system DB filter in backup alerts)
- **`SYSTEM_DBS` filter**: added explicit set `{master, tempdb, model, msdb, distribution}` in the `backup_overdue` check as defense-in-depth — the `distribution` database (SQL Server Replication) has `database_id > 4` and was not filtered by the SQL query, generating false positives

### Added — 2026-03-31 (DB View — database-centric asset inventory)
- **DB View in Inventory**: Server View / DB View toggle on the Inventory page — one row per database per server, grouped by server (collapsible header)
- **New T-SQL fields**: `compatibilityLevel`, `isEncrypted` (TDE), `isReadOnly`, `owner`, `createDate` added to the `sys.databases` collector query; available throughout the app
- **DB View columns**: DATABASE | SERVER | ALIAS | STATUS | RECOVERY | COMPAT (→ "SQL 2019") | TDE (🔒/🔓) | DATA | LOG | LAST FULL | LAST LOG | OWNER | CREATED
- **DB View KPI cards**: Total DBs · Online · Offline · Full Recovery · TDE Active · Without Backup · Compat < 2016
- **DB View filters**: recovery model (FULL/SIMPLE/BULK_LOGGED) · TDE (all/encrypted/not encrypted) · compat level · offline only · without backup >24h only
- **DB View CSV export**: `buildDbViewCsvRows()` in csvExportUtils — 17 columns including all new technical fields
- **`compatLevelToSqlVersion()`**: `sqlVersionUtils.ts` helper maps the raw compat level (80–160) to a human-readable SQL 2000–2022 version string
- **AG role in DB View**: server header shows "★ PRIMARY" / "○ SECONDARY" chip for AG replicas — clarifies why the same DB appears multiple times for different servers in an availability group

### Fixed — 2026-03-31 (production hardening)
- **`DatabaseInfo` backward compat**: the 5 new fields (`compatibilityLevel`, `isEncrypted`, `isReadOnly`, `owner`, `createDate`) are now `optional` — existing snapshots (SQLite) do not break deserialization
- **CSV DB View compat level**: `buildDbViewCsvRows` emits an empty string instead of `'Compat 0'` when the compat level is not available
- **Tray icon dev mode**: icon path corrected from `../../../resources` to `../../resources` — resolves `unhandledRejection: Failed to load image from path`
- **`sqlCollector.test.ts`**: updated `DB_ROW` mock with the 5 new fields; added assertions for `compatibilityLevel`, `isEncrypted`, `isReadOnly`, `owner`, `createDate`

### Changed — 2026-03-31 (instant server loading — stale-while-revalidate)
- **Dashboard stale-while-revalidate**: when switching servers the UI immediately shows data already in `metricsStore.metricsMap` (pre-populated from SQLite at boot or from worker pushes) while the silent background fetch completes — returning to an already-visited server is instant
- **Non-blocking LinearProgress**: during a silent refresh a thin bar appears at the top of the content (sticky, `zIndex 10`) instead of blocking the UI; `CircularProgress` appears only on the very first load (no cached data)
- **Local metrics reset on server change** (`useMetrics`): local `metrics` is reset to `null` on every `ip:port` change — eliminates the bug where the previous server's metrics were briefly visible while loading the new one

### Added — 2026-03-27 (metrics history persistence on SQLite)
- **Boot restore**: on startup the app automatically loads the last 20 snapshots per server from SQLite — CPU/memory charts and KPI values are immediately available without waiting for the first polling cycle (~60s)
- **Progressive persistence**: every 5 successful polls (~5 min at 60s interval) the snapshot is queued in-memory and written to SQLite in a single transaction every 5 min (`batchSave`)
- **Retention cleanup**: on startup, snapshots older than the retention time configured in Settings are automatically deleted
- **`METRICS_HISTORY_BULK` IPC**: new bulk channel that returns the entire in-memory history in a single call to the renderer
- **`seedFromHistory`** in metricsStore: pre-populates `metricsMap`, `summaries` and `historyMap` (sparklines) for all servers in a single Zustand operation
- **`seedHistory`** in WorkerContext: pre-populates `historyMapRef` (detail charts) by converting `ServerMetrics[]` to `MetricsHistoryPoint[]`
- **`findLastN` / `batchSave`** in metricsRepository: optimized `ORDER BY collected_at DESC LIMIT N` query + multi-row transactional insert

### Changed — 2026-03-27 (post-analysis optimizations)
- **AG sync observability**: `detectAndSyncReplicaRoles` no longer silently swallows errors; logs `console.warn` for visibility on servers not in an AG or with insufficient permissions
- **Inventory throttle**: subscription to `metricsMap` throttled to 1s (HomeDashboard pattern) — safeguard for future use when Inventory and Dashboard might be mounted simultaneously
- **previousMetrics cleanup**: after 50 consecutive failures on a server the entry in `previousMetrics` is removed (prevents ~1 MB/server accumulation for long-offline servers)

### Changed — 2026-03-27 (stability and performance for 200+ servers)
- **Poll timeout**: each polling job now has a 90s timeout (`Promise.race`); if SQL Server does not respond within 90s the job terminates with an error instead of hanging indefinitely
- **BATCH_SIZE**: increased from 10 to 30 concurrent connections; with 200 servers the full cycle drops from ~30 min to ~40s under normal conditions
- **Global error handlers**: `process.on('unhandledRejection')` and `uncaughtException` in the main process — unhandled async errors are now logged instead of passing silently
- **FILE_SAVE_CSV**: added try/catch — disk-full or permission-denied errors return `{ ok: false }` instead of crashing the handler
- **WorkerContext**: removed `historyVersion` from the context value — eliminates up to 200 re-renders/cycle across all consumers; `getHistory` reads from the always-up-to-date ref
- **HomeDashboard**: subscription to `metricsMap` throttled to 1 re-render/s (down from 200/cycle with 200 servers); `KpiCard` wrapped in `React.memo`
- **Sidebar**: `filteredServers`, `serversByGroupId` and `ungrouped` wrapped in `useMemo` — eliminates O(n log n) sort on every keystroke during search
- **MetricsPanel**: DataGrid top-query rows array memoized — eliminates full grid re-render on every update

### Added — 2026-03-24 (local authentication)
- **Login system**: local authentication with credentials stored in SQLite (`users` table, password hashed with bcrypt 12 rounds)
- **Default admin user**: on first installation `admin / Admin1234!` is created with a mandatory password change requirement
- **In-memory session**: 8-hour expiry with sliding expiry; no disk persistence — re-login required after restart
- **Mandatory password change**: non-dismissible modal dialog on first login (`must_change_password` field)
- **Password validation**: minimum 8 characters, at least 1 uppercase letter and 1 number
- **IPC auth guard**: all sensitive IPC handlers require a valid session; return `UNAUTHORIZED` otherwise
- **LoginPage**: form with password visibility toggle, dark mode, error messages
- **Logout**: button in the navbar; session invalidated in the main process
- **Global UNAUTHORIZED handler**: `unhandledrejection` detects expired sessions and redirects to LoginPage

### Performance — 2026-03-24 (200+ server scalability)
- **SQLite WAL flush + PRAGMA optimize**: `wal_checkpoint(PASSIVE)` at startup to reclaim space; `PRAGMA optimize` at shutdown to update query planner statistics
- **React.memo**: `TabPanoramica`, `TabDatabase`, `WaitPercentCell` wrapped with `memo` to avoid re-renders when props do not change
- **Lazy loading DisksTab**: `DisksTab` loaded with `React.lazy` + `Suspense`; the Disks tab bundle is downloaded only on first open
- **Inventory search debounce**: text search debounced 300ms; `filteredRows` is not recalculated on every keystroke — reduces load on inventories with 200+ servers

### Added — 2026-03-24 (autostart)
- **Start with Windows**: toggle in the Background & Tray settings card; uses Electron's `app.setLoginItemSettings` (writes to `HKCU\...\Run`); disabled in dev (would register electron.exe instead of the installed exe); source of truth is the OS — no copy stored in SQLite

### Fixed — 2026-03-24 (mock mode — UNAUTHORIZED on servers:getAll)
- **UNAUTHORIZED in mock mode**: `bridgeApi.servers.*` was hardcoded to `realApi` (real IPC) even with `VITE_MOCK_MODE=true`; the IPC guard required a real session that does not exist in mock mode; fixed by using `api` (mockApi or realApi based on the flag) — `mockApi.servers` is pure in-memory, no risk of electron-store contamination

### Fixed — 2026-03-24 (auth — UNAUTHORIZED on hot-reload in dev)
- **Session lost after hot-reload**: the in-memory `currentSession` variable was cleared when Vite reloaded the `authService.ts` module; the renderer was still logged in but every authenticated IPC received `UNAUTHORIZED`
- **Fix**: sessions persisted in SQLite (`sessions` table); `getSession()` retrieves from DB if in-memory is null; logout deletes the record; sliding expiry also updates the DB; `AuthSession` now has a `token` field

### Fixed — 2026-03-24 (NoteEditor — notes never persisted)
- **Server note not saved bug**: `ServerDashboard` passed `ip:port` as `serverId` to `MetricsPanel`/`NoteEditor`, but `serverStore.update()` looks up by UUID → `idx` always `-1` → nothing written to disk; introduced `serverDbId` (UUID) separate from `serverId` (ip:port) and correctly routed it through to `NoteEditor`

### Fixed — 2026-03-24 (NoteEditor — notes shared across servers)
- **Same notes for all servers bug**: `NoteEditor` displayed the last visited server's notes when switching to a server with empty notes; fixed by adding `serverId` to the dependencies of both `useEffect` calls and adding `key={serverId}` on the component to force remount on server change

### Added — 2026-03-24 (server notes)
- **Server notes field**: free-text field (max 1000 characters) persisted in electron-store per server
- **NoteEditor**: component with 1s debounce autosave and "Saved" indicator; visible in the server dashboard Overview tab
- **Notes column in Inventory**: cell with Tooltip for extended text; included in CSV export as the last column

### Fixed — 2026-03-24 (dark mode — Dashboard container)
- **Dashboard outer container**: `bgcolor: tokens.color.bgApp` → `background.default`; server title/alias and rename input now use `text.primary`/`text.secondary`
- **StatoCell (MetricsPanel)**: `border: \`1px solid ${borderColor}\`` corrected to `border: '1px solid'` + `borderColor` in sx (was invalid CSS for the default case)

### Fixed — 2026-03-24 (dark mode — token cleanup)
- **Dark palette updated**: background `#0f172a`/`#1e293b`, text `#f1f5f9`/`#94a3b8`, divider `#334155` (slate palette)
- **`tokens.color.*` replaced with MUI palette keys**: `AgDashboard`, `AlertsDrawer`, `DisksTab`, `HomeDashboard`, `Inventory`, `MemoryChart`, `MetricsPanel`, `ServerStatusChip` now use `background.paper`, `background.default`, `text.primary`, `text.secondary`, `divider` — all cards and tables adapt to the theme
- **Hardcoded colors removed**: `SpaceBar`, `DisksTab`, `MetricsPanel`, `Dashboard`, `Inventory` now use MUI palette keys (`text.secondary`, `action.hover`, `background.default`, `divider`) instead of fixed hex values; colored Inventory row tints adapted for dark/light via `alpha()` and sx callbacks

### Added — 2026-03-24 (dark mode)
- **Dark theme**: Light / Dark / System support via MUI `palette.mode`; toggle in Settings → Appearance
- **Theme persistence**: preference saved in the `settings` table (key `theme_mode`); restored on startup
- **System mode**: automatically follows the OS preference (`prefers-color-scheme`); listens for real-time changes
- **Navbar and scrollbar**: adapted to the active theme via MUI palette keys and CssBaseline overrides

### Added — 2026-03-24 (email alerting)
- **Email notifications**: WARNING and CRITICAL alerts send HTML emails via SMTP when detected; can be disabled from Settings → Email Notifications
- **Email dedup**: 15-minute cooldown per (server, category) pair to prevent spam
- **SMTP configuration**: host, port, user, password, TLS/STARTTLS toggle; persisted in the `settings` table as key-value pairs
- **Recipient list**: up to 20 email addresses with validation and removal from the UI
- **Test email**: button in Settings sends a test email with status displayed inline
- **HTML template**: email with colored header by severity level (🔴 CRITICAL / 🟡 WARNING)

### Added — 2026-03-23 (tray background service)
- **Tray icon**: app now hides to the system tray on window close (X) instead of quitting; double-clicking the icon or selecting "Open SQL Sentinel" from the context menu reopens the window; "Exit" in the menu fully closes the app
- **Background polling**: the worker keeps running with the window hidden; configurable between *Light* mode (customizable interval, only 4 critical queries, history cap 3) and *Full* mode (unchanged intervals)
- **System notifications**: CRITICAL alerts send Windows toast notifications when the window is hidden; 15-min cooldown per (server, category) pair; resets on acknowledgement; can be disabled from Settings
- **Tray context menu**: shows N servers online / M offline, background polling toggle, Exit
- **Performance**: `METRICS_UPDATED` IPC push skipped when no window is visible; thundering herd avoided by staggering `nextRun` over `[now, now+N/2]`; history cap reduced to 3 in light mode; `topQueries`, `waitStats`, `databaseFiles` cleared in light mode
- **Settings**: new "Background & Tray" section with 4 parameters (`backgroundEnabled`, `backgroundMode`, `backgroundIntervalMinutes`, `backgroundNotifications`)

### Fixed — 2026-03-23 (CSV export — dialog parent window)
- **`showSaveDialog` without parent window**: both `EXPORT_INVENTORY_CSV` and `FILE_SAVE_CSV` handlers in `handlers.ts` used `win ?? undefined!` as parent — if `BrowserWindow.fromWebContents` returns `null`, the dialog was called with `undefined` as the first argument and did not open on Windows; replaced with the fallback chain `BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]` which always guarantees a valid window

### Fixed — 2026-03-23 (CSV export — mock mode bypass)
- **Root cause — `VITE_MOCK_MODE=true` in `.env.development`**: in dev mode the `bridgeApi` in the preload used `api` (= `mockApi`) for all export functions; `mockApi.saveCsv` and `mockApi.exportInventoryCsv` returned `{ ok: true, data: null }` without opening any dialog → no export worked
- **Fix**: `exportCustomFields`, `exportInventory`, `exportAlerts`, `exportInventoryCsv`, `saveCsv` in `bridgeApi` now always use `realApi` (mock bypass), identical to the pattern already adopted for `servers.*`; file/dialog operations require real IPC regardless of dev mode

### Fixed — 2026-03-23 (inventory CSV export)
- **Bug 1 — dialog did not open**: `EXPORT_INVENTORY_CSV` handler in `handlers.ts` called `dialog.showSaveDialog({...})` without a parent window (the `_e` parameter was ignored); replaced with `const win = BrowserWindow.fromWebContents(event.sender)` and `dialog.showSaveDialog(win ?? undefined!, {...})` — aligned to the correct `FILE_SAVE_CSV` pattern
- **Bug 2 — wrong separator**: `buildCsvContent` in `csvUtils.ts` used `,` as the column separator; changed to `;` (Excel standard); updated the `csvExport.test.ts` test that verified the separator
- **Bug 3 — filters not respected**: `handleExportCsv` in `Inventory.tsx` always exported the full inventory (`inventory`); now when `hasActiveFilters` is true, it computes an `allowedServerIds: Set<string>` from the fully expanded filtered rows using the same predicates as `filteredRows` (but ignores collapse state to include hidden children); `buildInventoryCsvRows` in `csvExportUtils.ts` now accepts an optional `allowedServerIds?: Set<string>` parameter and skips servers not in the set

### Removed — 2026-03-23 (duplicate chart on server dashboard)
- **Duplicate "CPU / Memory History" chart removed** from the Overview tab: only the `ServerHistorySection` chart positioned above the tabs (always visible) remains, reading from the `metricsStore` ring buffer; the `MemoryChart` component and its fallback message ("Chart will be available…") have been removed from `TabPanoramica`
- `MetricsPanel`: removed `history: MetricsHistoryPoint[]` prop and `MemoryChart` / `MetricsHistoryPoint` imports; `TabPanoramica` now accepts only `metrics`
- `ServerDashboard`: removed `history` prop (no longer propagated to `MetricsPanel`)
- `Dashboard.tsx`: removed `getHistory` destructuring from `useWorker()`, the `history` variable and its related `console.log`

### Changed — 2026-03-23 (AG header dual-click zone)
- **`AgGroupHeader` in Sidebar**: separated the two click behaviours on the AG row; the chevron (`IconButton` with `e.stopPropagation()`) handles expand/collapse only, while the name + badge area has `onClick={onSelect}` and navigates to the AG Dashboard; `onClick` prop replaced by `onToggleCollapse` + `onSelect`; `onSelectAg` in `VirtualServerList` is now used (removed `_` prefix)

### Added — 2026-03-23 (SQL Server version filter)
- **"Version" filter** in Inventory: dynamic dropdown showing the distinct versions detected among connected servers (e.g. "SQL Server 2019", "SQL Server 2022"); positioned after the Referent filter, combined with AND against all existing filters, Reset button clears it
- **`getSqlServerVersion(version)`** in `inventoryUtils.ts`: utility that extracts the human-readable major version from any format (full `@@VERSION` string or pure numeric `ProductVersion`) via regex `\b(\d{2})\.\d+\.\d+`; mapping: 11=2012, 12=2014, 13=2016, 14=2017, 15=2019, 16=2022; fallback `SQL Server (vN)` for unknown versions
- `versionOptions` computed with `useMemo` from replicas and standalone servers in `inventory.groups`; appears in the filter bar only when at least one version is detected
- The filter acts on every row in the virtual table (standalone, ag-replica, ag-cluster header, machine-header) by comparing `getSqlServerVersion(row.version) === selectedVersion`; AG and machine headers show the version of the PRIMARY / first instance
- `isHierarchical` updated to include `filterVersion === 'all'` in the indentation check

### Fixed — 2026-03-20 (AG secondary grouping)
- **Cause 1 — agName propagation to SECONDARY replicas**: `agStore.detectAgsForServer()` now calls `updateServer()` for ALL replicas found (not just the current server); each replica receives `agGroupId + agName + agRole`; this way when the PRIMARY is added, the SECONDARY already in the store is updated automatically
- **Cause 1 bis — main process worker**: added `detectAndSyncReplicaRoles()` in `agCollector.ts`; queries `sys.availability_replicas` after each successful poll, finds the corresponding servers in electron-store and updates `agGroupId + agName + agRole`; changes written via `serverStore.update()` and pushed to the renderer via new push channel `SERVER_CONFIG_UPDATED`
- **Cause 2 — sidebar grouping case-insensitive**: the sidebar now groups servers by `agName` (trim + toLowerCase) instead of `agGroupId`; a server is considered an AG member if `agName?.trim()` is non-empty; `agGroupsInThisGroup` uses the same match to find applicable AG headers; the SECONDARY now appears under its AG header even when `agGroupId` is not yet set
- `StoredServer`: added `agName?: string` field in `preload/index.d.ts` and `serverStore.ts`
- `IpcChannel.SERVER_CONFIG_UPDATED` (`server:configUpdated`): new main→renderer push channel; registered in `preload/index.ts` (realApi + mockApi stub + bridgeApi); signature in `preload/index.d.ts` (`onServerConfigUpdated`)
- `App.tsx`: new `useEffect` that listens to `onServerConfigUpdated` and applies `updateServer()` for each updated server
- `mocks/servers.mock.ts`: added `agName` to mock servers with `agGroupId` (mock-s01, mock-s02, mock-s07, mock-s08)

### Fixed — 2026-03-20 (mock bugs 2)
- `App.tsx`: removed the `if (USE_MOCK) return` guard from the `loadServers` effect — `loadServers()` now always runs, even with `VITE_USE_MOCK=true`; servers added manually are saved to electron-store and reloaded on restart
- `useMockData`: added `if (existing.length > 0) return` check — mocks are seeded ONLY if the store is empty (no real servers configured); if the user has added real servers they take priority and the mocks are not loaded
- Server addition flow guaranteed unchanged in mock mode: `AddServerDialog` → IPC `server:add` → electron-store → `serversStore` → sidebar, without interference from the mock loader

### Fixed — 2026-03-20 (mock bugs)
- `useMockData`: changed from `[initialized]` to `[]` deps — seeding happens on mount without waiting for `loadServers()` (which is never called in mock mode)
- `useMockData`: `useServersStore.setState` now sets `initialized: true` together with the mock servers, so waiting for `loadServers()` is no longer necessary
- `useMockData`: `serverGroups` and `serverAliases` are now MERGED (`{ ...state.serverGroups, ...MOCK_SERVER_GROUPS }`) instead of replaced — real server group assignments are no longer wiped from localStorage when `VITE_USE_MOCK=true` is used
- `App.tsx`: added `if (USE_MOCK) return` guard in the `loadServers` effect — in mock mode real loading from electron-store is completely skipped, so mock servers are not overwritten
- `App.tsx`: added `if (USE_MOCK) return` guard in the `workerSyncServers` effect — in mock mode mock IPs (10.0.x.x) are not passed to the worker

### Added — 2026-03-20 (quinquies)
- Realistic mock data sets to test all Inventory filters (`VITE_USE_MOCK=true` in `.env.development`)
  - `src/renderer/src/mocks/servers.mock.ts` — 12 mock servers (`MOCK_SERVERS`, `MOCK_SERVER_GROUPS`, `MOCK_SERVER_ALIASES`, `MOCK_METRICS_MAP`, `MOCK_AG_GROUPS`); coverage: 3 environments (Prod/Coll/Dev), 2 AG clusters, 3 machine-headers (SQLPROD03, SQLPROD04, SQLDEV01), 4 referents (Andrea Cortesi / Mario Rossi / Luca Bianchi / Sara Verdi + null), cloud/on-premise hosting, 3 unreachable servers
  - `src/renderer/src/hooks/useMockData.ts` — hook that seeds `serversStore`, `groupsStore` (serverGroups + serverAliases + expandedAGs + expandedMachines), `metricsStore` (metricsMap) and `agStore` (agGroups) after `serversStore.initialized === true`; no-op when `VITE_USE_MOCK !== 'true'`
  - `App.tsx`: `useMockData()` called in `AppInner` (before any other hook)
  - `env.d.ts`: added `VITE_USE_MOCK: string` to `ImportMetaEnv`
  - `.env.development`: added `VITE_USE_MOCK=true`
  - `.env.production` (new): `VITE_USE_MOCK=false`

### Added — 2026-03-20
- HomeDashboard: "Refresh metrics" button in the header (top-right, next to the timestamp) — same style as the button already present in Inventory (MUI Button `variant="contained"`, `RefreshIcon`, spinner during refresh, disabled while in progress)
- Hook `useRefreshAllServers` (`src/renderer/src/hooks/useRefreshAllServers.ts`) — refresh-all logic extracted from Inventory into a shared hook; returns `{ refreshing, lastRefresh, handleRefresh }`; used by both Inventory and HomeDashboard to avoid duplication

### Added — 2026-03-20 (quater)
- Inventory: "Alias" and "Referent" filters in the filter bar
  - "All aliases" dropdown — options computed with `useMemo` from `serverAliases` values; visible only when at least one alias is defined; filters servers where `serverAliases[ip:port] === value`
  - "All referents" dropdown — options computed from `metricsMap.databases[].referente`; visible only when at least one referent is defined; filters servers where at least one DB has `referente === value`
  - Both filters are combined with AND against all existing filters; they only act on leaf rows (`standalone`, `ag-replica`) — cluster and machine headers are never shown without matching children
  - When active, AG clusters and machine groups are forcibly expanded (`effectiveExpanded`, `effectiveExpandedMachines`) so all leaf rows are available for filtering
  - Reset button clears both new filters; `hasActiveFilters` updated accordingly
  - Fix: `hasHierarchy` in `sortedRows` now requires the presence of header rows (depth=0, type `ag-cluster` or `machine-header`) to prevent orphaned depth=1 rows from being silently lost from the output

### Added — 2026-03-20 (ter)
- **Multi-instance**: support for grouping multiple SQL Server instances on the same physical machine
  - `StoredServer.machineName` (optional) — automatically populated from `SERVERPROPERTY('MachineName')` on "Test connection" in the add server form; backward-compatible: falls back to `host` for already-saved servers
  - Sidebar: instances sharing the same `machineName` (2+) are grouped under a collapsible "🖥 MACHINE (N instances)" header — same logic as AG groups; machines with a single instance do not show the header; expansion persisted in `groupsStore.expandedMachines`; AG takes priority over machine (AG members do not enter the machine group)
  - Inventory: new MACHINE column; collapsible `machine-header` for machines with 2+ instances; "OK/OFFLINE" status on the machine header; aggregated instance count in KPI cards; `effectiveExpandedMachines` forces automatic expansion with the "Standalone" filter
  - `groupsStore`: added `expandedMachines: string[]` + `toggleMachineCollapse()` (persisted in localStorage)

### Added — 2026-03-20 (bis)
- Add server form: "Port" field repositioned on the same row as "IP / Hostname" (`Stack direction="row"`); "Instance Name" moved to a separate row below; added hint text below the Port field with instructions for static port on named instance with SQL Browser disabled
- Conditional port display: the port is shown next to the host (e.g. `192.168.1.10:2433`) only when it differs from 1433, both in the sidebar (`getServerDisplayName`) and in the SERVER column of the Inventory; port 1433 is not displayed (implicit)

### Fixed — 2026-03-20
- Inventory: "AG Primary" / "AG Secondary" filter returned 0 results when AG clusters were collapsed — `ag-replica` rows are now generated for all clusters (regardless of expanded state) when `filterType` is `ag-primary` or `ag-secondary`, via `effectiveExpanded = new Set(allClusterKeys)` passed to `buildRows`


- Sidebar: eliminated double rendering of standalone servers — the `agServersInGroup` / `standaloneServers` split is now mutually exclusive based on `agGroupId != null`; the AG children loop uses `agServersInGroup.filter(s => s.agGroupId === ag.id)` instead of `ag.serverIds.includes(s.id)`, preventing servers without `agGroupId` (matched only by hostname heuristic) from appearing both inside the AG group and outside as standalone
- Sidebar: standalone servers no longer absorbed into an AG group; a server is considered an "AG member" only if it has a populated `agGroupId` (confirmed by its own detection), not by heuristic name match in `agStore` alone

### Changed — 2026-03-20
- `database.ts`: added `PRAGMA synchronous = NORMAL` — reduces fsyncs from 2 to 1 per transaction, safe with WAL mode, ~2x faster than `FULL` (default)
- `database.ts`: added `PRAGMA cache_size = -8192` — page cache increased to 8 MB (default: 2 MB)
- `database.ts`: added `PRAGMA temp_store = MEMORY` — temporary tables allocated in RAM
- `database.ts`: added index `idx_metrics_cleanup ON metrics_snapshots(collected_at)` — covers the `DELETE WHERE collected_at < ?` query in `metricsRepository.cleanup()` which cannot use the composite `(server_id, collected_at)` index due to the absence of a `server_id` filter; the two indexes remain complementary: the composite for `findLatest`/`findHistory`, the standalone for purge

### Analysis — 2026-03-20
- Full SQLite schema audit via MCP: identified 6 optimizations across 4 tables
- `db_custom_fields.id` is an opaque concatenated PK (`server_id/db_name`) — proposed migration to separate columns `(server_id, db_name)` + `idx_db_custom_server` index for export/merge queries
- `metrics_snapshots`: FK `REFERENCES servers(id)` unusable (SQLite `servers` table always empty — servers managed via electron-store); proposed migration to drop the FK and unblock the table
- `metrics_snapshots`: composite index `(server_id, collected_at DESC)` does not cover `cleanup()` (no `server_id` in WHERE) — proposed dedicated `idx_metrics_collected_at` for purge
- `metrics_snapshots.collected_at TEXT`: possible migration to `REAL` epoch to reduce storage and speed up range comparisons
- Missing PRAGMAs: `synchronous=NORMAL` (safe with WAL, ~2x faster), `cache_size=-8192` (8 MB), `temp_store=MEMORY`
- Architectural debt: `servers` SQLite + `serverRepository.ts` are dead code — servers managed exclusively via electron-store (`serverStore.ts`); same for `metricsRepository.ts` (worker uses in-memory Map)
- All migration SQL documented with executable scripts

### Changed — 2026-03-19 18:30
- Inventory: KPI cards updated dynamically based on active filters; `filteredStats` useMemo derived from `filteredRows` (zero extra passes); Server/Standalone/AG Cluster/Database/Online/Offline counters reflect only rows visible after filtering
- Inventory: text indicator "Filtered results: N of M servers" visible below KPI cards when at least one filter is active; hidden when no filter is applied

### Changed — 2026-03-19 18:00
- Sidebar: AG groups collapsible — clicking the header toggles expand/collapse; chevron `›` rotates 90° when expanded; default all collapsed on first launch
- groupsStore: added `expandedAGs: string[]` (JSON-serializable array, empty = all collapsed) + action `toggleAgCollapse(agName)`
- Sidebar: `SidebarItem { kind: 'ag' }` now carries `isExpanded: boolean`; AG server rows inserted into flatItems only when the group is expanded
- Sidebar: `AgGroupHeader` receives `isExpanded` prop; click calls `onToggleAgCollapse` (not navigation)

### Added — 2026-03-19 17:20
- AddServerDialog: "Test connection" button that calls detectServerInfo via IPC; auto-fills alias (if empty) with MachineName and instanceName with InstanceName ('' for default instance); visual states idle/loading/success/error with green Chip or error message
- sqlCollector: new `detectServerInfo(connection)` function — runs `SELECT SERVERPROPERTY('MachineName'), SERVERPROPERTY('InstanceName')` on a dedicated connection with finally/close; returns `{ machineName, instanceName: null }` for default instance
- collectors/types.ts: `ServerInfo` interface `{ machineName: string, instanceName: string | null }`
- ipc/types.ts: channel `DETECT_SERVER_INFO = 'servers:detectInfo'`; re-export `ServerInfo`
- ipc/handlers.ts: `DETECT_SERVER_INFO` handler that calls `detectServerInfo` and returns `IpcResult<ServerInfo>`
- preload/index.ts: `detectServerInfo` added to realApi, mockApi (stub with 800ms delay) and bridgeApi
- preload/index.d.ts: `ServerInfo` interface and `detectServerInfo` signature in `SqlSentinelAPI`

### Changed — 2026-03-19 16:30
- Inventory: AG cluster rows expandable with child replicas (ag-cluster/ag-replica hierarchy), Expand All/Collapse All, hierarchical sorting that keeps replicas under their parent cluster, counter shows only depth=0 rows

### Changed — 2026-03-19 15:50
- Inventory: replaced environment-based section structure with a flat virtualized table (@tanstack/react-virtual); filter bar with search/environment/type/status/hosting; clickable column sorting with ▲▼ indicators; empty state for filters with no results

### Fixed — 2026-03-19 15:10
- AgDashboard: ReplicaCard shows server alias (from groupsStore.serverAliases) instead of raw IP; raw IP visible in caption only if different from displayName
- AgDashboard: ✅/❌ icon placed before text in the Connection row (was inverted)

### Fixed — 2026-03-19 14:40
- ServerHistoryChart: Tooltip formatter correctly typed as `(value, name) => [string, string]`; handled `value: ValueType | undefined` case with `typeof value === 'number'` guard

### Added — 2026-03-19 13:00
- ServerHistoryChart: new Recharts component (LineChart) for CPU/Memory history per server; uses historyMap from metricsStore; empty state for unreachable server or no samples; ReferenceLine at 80% for CPU threshold; Tooltip also shows absolute MB from memory
- ServerDashboard: ServerHistoryChart integrated between KPI cards and database table
- metricsStore: memPercent calculation (memoryUsedMb/totalMemoryMb×100) before push into ring buffer; fix for memory data expressed in % instead of MB
- metricsStore: `resetHistory(serverId?)` action to clear ring buffer

### Added — 2026-03-19 11:30
- constants/hosting.tsx: `ServerHostingType`, `HOSTING_OPTIONS` (with MUI icons), `HOSTING_BADGE` (label + color for on-premise/cloud)
- StoredServer: `hostingType` field (on-premise | cloud), optional for backward compatibility
- serverRepository: migration `ALTER TABLE hosting_type` with idempotent try/catch; INSERT/UPDATE map hosting_type; getAll normalizes the value
- AddServerDialog: "Infrastructure type" Select with Storage/Cloud icons
- Sidebar: ON-PREM/CLOUD Chip badge next to server name
- ServerDashboard: inline hostingType edit with Select on badge click; saved via updateServer IPC
- HomeDashboard: Infrastructure column in server table with colored Chip
- csvExportUtils: "Infrastructure Type" column in inventory CSV export

### Added — 2026-03-19 10:00
- metricsStore: two-tier store — summaries (all servers, ~128B) + fullMetrics (active server only, complete); setSummary, setActiveServerId, evictFullMetrics
- metricsStore: historyMap with ring buffer cpuHistory/memoryHistory cap 60 points (active server) / 10 points (idle); atomic CPU+memory push in the same set()
- alertsStore: automatic purge in addAlert — MAX_ALERTS=500, MAX_ALERT_AGE_MS=7 days; filter on detectedAt
- database.ts: `purgeOldMetrics()` with 30-day retention on metrics_snapshots; scheduled at boot + every 24h
- database.ts: composite index (server_id, collected_at DESC) on metrics_snapshots; replaces the two single-column indexes
- main/index.ts: IPC `APP_BACKGROUND`/`APP_FOREGROUND` on window blur/focus; GC logging every 60s in dev mode with `global.gc` guard
- appStore: `isBackground` field to track foreground/background state

### Fixed — 2026-03-19 09:00
- main/index.ts: GC cast from `NodeJS.Global` (removed in @types/node v20+) to `globalThis & { gc?: () => void }`
- memoryBounds.test.ts: removed duplicate import of ServerMetrics (lines 16 and 34)

### Added — 2026-03-19 08:00
- mockSqlite.ts: in-memory mock of better-sqlite3 for Vitest (avoids NODE_MODULE_VERSION mismatch between Electron 39 and Node v24); simulates INSERT ON CONFLICT upsert, DELETE with date filter, SELECT with ISO string range
- vitest.config.ts: setupFiles with mockSqlite.ts for all tests
- Test suite: 102/102 tests passing across 8 files (pollingManager, deltaComputation, memoryBounds, homeDashboard, csvExport, sqlCollector, store)

### Fixed — 2026-03-19 07:30
- deltaComputation.test.ts: replaced `vi.runAllTimersAsync()` (caused infinite loop in the scheduler) with `drainJobCycle()` (10× `await Promise.resolve()`); timer advancement corrected to 300_001ms (INTERVAL_IDLE_MS=300_000)
- memoryBounds.test.ts: `runNCycles()` corrected for first cycle without advance + subsequent cycles with 300_001ms; fixed shift() test that used `runNCycles(1)` after reset
- homeDashboard.test.tsx: added `// @vitest-environment jsdom` to fix `document is not defined` on Windows (backslash path separator ignored by environmentMatchGlobs)
- homeDashboard.test.tsx: `getByText` → `getAllByText` for multiple elements in the DOM
- csvExport.test.ts: fixed import path `../../../main/csvUtils` (was `../../main/csvUtils`)
- sqlCollector.test.ts: fixed SQL routing — check `backupset` before `sys.databases` to avoid incorrect match on the JOIN

### Added — 2026-03-19 06:00
- README.md: full documentation — features, architecture, installation, first launch, building from source, project structure
