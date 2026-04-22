# SQLSentinel — Change Documentation

## PHASE 1 — Discovery Module (2026-03-16)

### Files created

#### `src/main/discovery/types.ts`

TypeScript definitions for the discovery module:

- `DiscoveredServer` — result of a single TCP probe (ip, port, reachable, responseTimeMs, discoveredAt)
- `ScanOptions` — input parameters for `scanSubnet` (cidr, ports, timeoutMs, concurrency)
- `ScanProgress` — scan progress state for the UI (total, completed, found)

#### `src/main/discovery/cidrUtils.ts`

CIDR expansion utility:

- `expandCidr(cidr)` — converts CIDR notation (e.g. `192.168.1.0/24`) into an array of all IPs in the range, including network and broadcast addresses. Uses bitwise operators on 32-bit unsigned integers. Throws on malformed CIDR.

#### `src/main/discovery/tcpScanner.ts`

Asynchronous TCP scanner:

- `scanHost(ip, port, timeoutMs)` — single TCP probe via `net.Socket`. Never throws exceptions: always returns a `DiscoveredServer`. The `settled` flag ensures `cleanup()` is called exactly once even if multiple events (error + timeout) overlap.
- `scanSubnet(options, onProgress?)` — scans all ip×port combinations in the provided CIDR. Uses a worker pool (shared-index pattern) to cap concurrency at `options.concurrency` simultaneous probes (recommended default: 50). Returns only reachable servers. Calls `onProgress` after each probe to update the UI.

Constraints respected:

- TCP `net.Socket` only — no PowerShell, no UDP, no SQL Server Browser
- Explicit timeout on each socket via `socket.setTimeout()`
- Explicit socket cleanup via `socket.destroy()` on completion

#### `src/main/discovery/tcpScanner.test.ts`

Vitest tests with `net.Socket` mocked (no real connections):

- Reachable host → `connect` event → `reachable: true`
- Unreachable host → `error` event → `reachable: false`
- Timeout → `timeout` event → `reachable: false`
- Double-fire (error + timeout) → `destroy` called exactly once
- Verifies `setTimeout` receives the correct `timeoutMs` value

#### `vitest.config.ts`

Vitest configuration for main process tests:

- `environment: 'node'` (required for Node.js modules such as `net`)
- `include: ['src/main/**/*.test.ts']`

### Changes to existing files

#### `package.json`

Added scripts:

- `"test": "vitest run"` — single run (CI)
- `"test:watch": "vitest"` — watch mode for development

### Test commands

```bash
npm run test          # single run
npm run test:watch    # watch mode
```

---

## PHASE 2 — IPC Module (2026-03-16)

### Files created

#### `src/main/ipc/types.ts`

IPC channel definitions and request/response types:

- `IpcChannel` (enum) — channel names as typed strings. `enum` used instead of `const enum` to avoid cross-file inlining issues with esbuild/electron-vite.
- `IpcResult<T>` — unified envelope `{ ok: true; data: T } | { ok: false; error: string }`. Guarantees the renderer never receives raw stack traces.
- Request types: `ManualServerRequest`, `RemoveServerRequest`
- Response types: aliases `ScanSubnetResponse`, `AddServerManualResponse`, `GetServersResponse`, `RemoveServerResponse`

#### `src/main/ipc/handlers.ts`

`ipcMain.handle()` handler registration for all channels:

- `SCAN_SUBNET` — calls `scanSubnet()`, sends progress via `event.sender.send(SCAN_PROGRESS, ...)`, returns only reachable servers.
- `ADD_SERVER_MANUAL` — runs `scanHost()` (2s timeout) to populate `reachable`/`responseTimeMs`, then persists the server.
- `GET_SERVERS` — returns a copy of the in-memory store.
- `REMOVE_SERVER` — filters the store by `ip:port` key.
- Temporary in-memory store (`knownServers` array) — will be replaced by SQLite in PHASE 4.
- Errors logged via `console.error` with only `err.message`, never a stack trace to the renderer.

### Modified files

#### `src/preload/index.ts`

Exposes a typed `sqlSentinel` object via `contextBridge.exposeInMainWorld('sqlSentinel', ...)`:

- `scanSubnet(options)` → `ipcRenderer.invoke(SCAN_SUBNET)`
- `onScanProgress(callback)` → `ipcRenderer.on(SCAN_PROGRESS, ...)`, returns cleanup `() => void`
- `addServerManual(req)` → `ipcRenderer.invoke(ADD_SERVER_MANUAL)`
- `getServers()` → `ipcRenderer.invoke(GET_SERVERS)`
- `removeServer(req)` → `ipcRenderer.invoke(REMOVE_SERVER)`

#### `src/preload/index.d.ts`

Added `window.sqlSentinel: SqlSentinelAPI` declaration. Types re-declared inline (not imported from `src/main/`) because this file is compiled with `tsconfig.web.json` which does not include the main process. Exported types (`DiscoveredServer`, `ScanOptions`, `ScanProgress`, etc.) are importable from the renderer via relative path.

#### `src/main/index.ts`

Added import and call to `registerIpcHandlers()` inside the `app.whenReady()` callback.

### Files created (renderer)

#### `src/renderer/src/hooks/useDiscovery.ts`

React hook for the Discovery page:

- State: `servers: DiscoveredServer[]`, `isScanning: boolean`, `progress: ScanProgress | null`, `error: string | null`
- `scan(options)` — calls `window.sqlSentinel.scanSubnet()`, subscribes to progress events, handles listener cleanup in the `finally` block.
- Imports types from `src/preload/index.d.ts` (relative path `../../../preload/index`) — works because `tsconfig.web.json` includes `src/preload/*.d.ts`.

---

## PHASE 3 — Collectors Module (2026-03-16)

### Files created

#### `src/main/collectors/types.ts`

Types for SQL Server metrics:

- `ServerConnection` — credentials and connection coordinates. `instanceName` is display-only: not passed to the driver because SQL Browser is disabled and the port is always explicit.
- `InstanceInfo` — version, edition, used RAM, CPU%, uptime
- `DatabaseInfo` — name, status, recovery model, data/log sizes
- `SessionInfo` — active sessions with blocking, wait type, CPU, logical reads
- `QueryInfo` — top queries by elapsed time (text, execution count, CPU/IO averages)
- `BackupInfo` — last Full/Diff/Log backup per database
- `ServerMetrics` — aggregate of all the above types with a timestamp

#### `src/main/collectors/sqlCollector.ts`

Main collector:

- `buildConfig(conn)` — builds `mssql.config`. `connectTimeout` in `options` (via IOptions), `requestTimeout` directly on config. `instanceName` is NOT passed to the driver.
- Auth: `type: 'ntlm'` (Windows Auth) or `type: 'default'` (SQL Auth), as required by the `tds.ConnectionAuthentication` interface.
- `collectMetrics(connection)` — opens a pool, runs 5 queries in `Promise.all()`, each query with an independent `.catch()` → a failing query does not block the others. Pool is always closed in the `finally` block.
- Errors logged with only `err.message`, never stack traces or credentials.

**T-SQL queries implemented (snake_case aliases):**

- `queryInstanceInfo` — `sys.dm_os_process_memory` CROSS JOIN `sys.dm_os_sys_info` + subquery on `sys.dm_os_ring_buffers` for CPU%
- `queryDatabases` — `sys.databases` INNER JOIN `sys.master_files` GROUP BY, DECIMAL(18,2) for sizes
- `querySessions` — `sys.dm_exec_requests WHERE session_id > 50`
- `queryTopQueries` — `sys.dm_exec_query_stats` CROSS APPLY `sys.dm_exec_sql_text`, TOP 20 by total elapsed time
- `queryBackupStatus` — `msdb.dbo.backupset` GROUP BY database_name, type='D'/'I'/'L', last 7 days

#### `src/main/collectors/sqlCollector.test.ts`

4 tests with `mssql` mocked via factory `vi.mock('mssql', () => ({ connect: vi.fn() }))`:

- Successful connection → verifies full mapping of all fields
- Failed connection → `rejects.toThrow('Login failed')`
- Timeout → `rejects.toThrow('Connection timeout')`
- Partial query failure (backup denied on msdb) → `backupStatus: []`, other queries OK, `close()` always called

---

## PHASE 4 — Store Module (2026-03-16)

### Files created

#### `src/main/store/types.ts`

- `StoredServer` — record persisted in SQLite. `encryptedPassword` marked with a "never log" comment.
- `MetricsSnapshot` — raw snapshot with `metricsJson: string` (serialized ServerMetrics).

#### `src/main/store/database.ts`

- `initDb(path) / getDb() / closeDb()` pattern — the path is passed from outside (main process uses `app.getPath('appData')`, tests use `':memory:'`). No Electron dependency in this module.
- `defaultDbPath(appDataPath)` — helper to build the production path (`%APPDATA%/sqlsentinel/data.db`).
- Schema DDL: `servers` table with UNIQUE on `(ip, port)`, `metrics_snapshots` table with FK CASCADE, indexes on `server_id` and `collected_at`.
- WAL mode and `foreign_keys = ON` set via `PRAGMA`.

#### `src/main/store/serverRepository.ts`

- `upsert(server)` — `INSERT ... ON CONFLICT(ip, port) DO UPDATE SET ...`. Does not update `id` or `added_at` on conflict. Returns the actual record (resolves the pre-existing id).
- `findAll()`, `findById(id)`, `remove(id)`, `updateLastSeen(id, date)`, `updateLastMetrics(id, date)`.
- `ServerRow` → `StoredServer` mapping: INTEGER → boolean for `use_windows_auth`, ISO 8601 TEXT → Date for date fields.

#### `src/main/store/metricsRepository.ts`

- `save(serverId, metrics)` — `JSON.stringify(metrics)` + UUID generated with `randomUUID()`.
- `findLatest(serverId)` — `ORDER BY collected_at DESC LIMIT 1`, deserializes with a reviver to restore `Date` objects from ISO 8601 strings.
- `findHistory(serverId, limitDays)` — uses SQLite's `datetime('now', '-N days')`.
- `cleanup(retentionDays)` — `DELETE WHERE collected_at < datetime('now', '-N days')`.

#### `src/main/store/store.test.ts`

- `initDb(':memory:')` in `beforeEach`, `closeDb()` in `afterEach` — each test starts from an empty schema.
- **serverRepository**: insert, upsert (no duplicates per ip:port), findById, remove, updateLastSeen, boolean/Date conversion.
- **metricsRepository**: save+findLatest, Date deserialization, most recent snapshot across multiple records, findHistory, cleanup (verifies deletion of old records and retention of recent ones).

---

## PHASE 5 — Discovery UI Page (2026-03-16)

### Files created

#### `src/renderer/src/components/ServerStatusChip.tsx`

Reusable MUI Chip. Props: `reachable: boolean | null`, `responseTimeMs?: number`. Three states: green "Reachable Xms" / red "Unreachable" / grey "Unknown" (null).

#### `src/renderer/src/components/AddServerDialog.tsx`

MUI Dialog with a complete form: IP/Hostname (required), Port (1-65535, default 1433), Instance Name (optional), Windows Auth / SQL Auth toggle, Username+Password fields when SQL Auth. Inline validation with `helperText`. `useEffect` to pre-populate ip/port when opened from a table row.

#### `src/renderer/src/pages/Discovery.tsx`

Main page with:

- Warning alert for dynamic named instances
- Scan form: CIDR, ports (comma-separated, parsed + CIDR format validation), concurrency (1-200)
- `determinate` LinearProgress during scan with label "X/Y hosts scanned, Z found"
- DataGrid with 6 columns: IP, Port, Status (ServerStatusChip), Response ms, Discovery type (chip), Actions ("+ Monitor")
- `getRowId={(row) => \`${row.ip}:${row.port}\``— no`id` field required on the data
- AddServerDialog opened both from "Add Manually" (empty form) and from a row (pre-populated)

### Modified files

#### `src/renderer/src/hooks/useDiscovery.ts`

- Added `DiscoveryRow` type (extends `DiscoveredServer` with `discoveryType: 'auto-tcp' | 'manual'`)
- Added `AddServerParams` type (includes credentials for future use in PHASE 6)
- `scan` now produces `DiscoveryRow[]`, preserving pre-existing manual servers on ip:port conflict
- Added `addServer(params)` function that calls `window.sqlSentinel.addServerManual` and updates the list

#### `src/renderer/src/App.tsx`

Replaced the Electron demo template with `<Discovery />`. No router — single page for PHASE 5/6.

---

## PHASE 6 — Monitoring Dashboard (2026-03-16)

### Files created

#### `src/renderer/src/hooks/useMetrics.ts`

Hook for metrics collection and history:

- `useMetrics(connection)` — takes `CollectMetricsRequest | null` as input.
- State: `metrics: ServerMetrics | null`, `isLoading`, `error`, `history: MetricsHistoryPoint[]`, `autoRefreshSeconds`, `setAutoRefreshSeconds`.
- `refresh()` — calls `window.sqlSentinel.collectMetrics()`, appends a point to the history (max 60 points).
- Auto-refresh via `setInterval` with `useEffect` cleanup; resets when the selected server (`ip:port`) changes.
- `MetricsHistoryPoint`: `{ timestamp, memoryUsedMb, cpuUsagePercent }` for charts.

#### `src/renderer/src/components/MemoryChart.tsx`

recharts chart with dual Y-axis: Memory (MB) on the left, CPU (%) on the right. `isAnimationActive: false` for performance with frequent updates.

#### `src/renderer/src/components/MetricsPanel.tsx`

5 MUI tabs to display all metrics:

- **Overview**: InfoCard for version, edition, memory, CPU, uptime + `MemoryChart` (visible with ≥2 samples).
- **Databases**: DataGrid with name, status, recovery model, data/log sizes.
- **Sessions**: DataGrid with `blockingSessionId` highlighted in red (MUI Chip error) if > 0.
- **Backups**: DataGrid with cells colored red if backup is > 24h old or `null`.
- **Top Queries**: DataGrid with query text in monospace, `_idx` as synthetic row ID (QueryInfo has no natural key).

#### `src/renderer/src/pages/Dashboard.tsx`

Main page with sidebar + right-area layout:

- Left sidebar (220px): server list from `getServers()`, active selection, `ServerStatusChip` for each entry.
- Right area: toolbar with server label, auto-refresh Select (30s/60s/2min/5min/disabled), "Refresh metrics" button with CircularProgress.
- Windows Auth by default for metrics collection (extended credentials planned for a future phase).
- Informational messages for empty state / no server selected.

### Modified files

#### `src/main/ipc/types.ts`

- Added `COLLECT_METRICS = 'metrics:collect'` to `IpcChannel`.
- Added `CollectMetricsRequest` (full connection credentials).
- Added `CollectMetricsResponse = IpcResult<ServerMetrics>`.
- Re-exported `ServerMetrics` from `../collectors/types`.

#### `src/main/ipc/handlers.ts`

- Import `collectMetrics` from `../collectors/sqlCollector`.
- Added `COLLECT_METRICS` handler: calls `collectMetrics()` with the request parameters, returns `IpcResult<ServerMetrics>`. Error logged with `err.message` only.

#### `src/preload/index.ts`

- Added `collectMetrics` to the `sqlSentinel` object exposed via contextBridge.
- Re-exported `CollectMetricsRequest`, `ServerMetrics`, `InstanceInfo`, `DatabaseInfo`, `SessionInfo`, `QueryInfo`, `BackupInfo`.

#### `src/preload/index.d.ts`

- Inline declarations for `CollectMetricsRequest`, `InstanceInfo`, `DatabaseInfo`, `SessionInfo`, `QueryInfo`, `BackupInfo`, `ServerMetrics`.
- Added `collectMetrics(req: CollectMetricsRequest): Promise<IpcResult<ServerMetrics>>` to `SqlSentinelAPI`.

#### `src/renderer/src/App.tsx`

Replaced direct `<Discovery />` with 2-tab MUI navigation: "Discovery" and "Dashboard". Discovery uses `overflow: auto`, Dashboard uses `overflow: hidden` (scroll managed by the internal layout).

---

## 2026-03-17 — MetricsWorker, Alert System, Notification Badge

### New files

#### `src/main/metricsWorker.ts`

Worker running in the main process (Electron) via `setInterval`. Responsibilities:

- Periodic metrics collection for all configured servers (via `collectMetrics`).
- Per-server history with a rolling buffer of 20 snapshots (`Map<serverId, ServerMetrics[]>`).
- Push to the renderer via `BrowserWindow.getAllWindows()[0].webContents.send()`:
  - `IpcChannel.METRICS_UPDATED` — `{ serverId, metrics }` on each successful collection.
  - `IpcChannel.ALERT_NEW` — `Alert` when a new alert is generated.
- Alerting engine with thresholds:
  - **CPU > 90%** → CRITICAL | **> 70%** → WARNING (category `cpu_high`)
  - **Blocked sessions ≥ 5** → CRITICAL | **≥ 1** → WARNING (category `blocking_sessions`)
  - **Database OFFLINE** → CRITICAL (category `database_offline`)
  - **Full backup missing or > 24h old** → WARNING (category `backup_overdue`)
- Alert deduplication: does not generate a new alert if an open (unacknowledged) alert already exists with the same `serverId:category:severity`.
- Public API: `startWorker(req)`, `stopWorker()`, `getAlerts()`, `acknowledgeAlert(id)`, `getHistory(ip, port)`.
- Interval: min 30s, max 300s.

#### `src/renderer/src/components/AlertsDrawer.tsx`

MUI Drawer anchored to the right (width 400px) with an alert list. Features:

- Open alerts shown first (CRITICAL above WARNING, via sort).
- Acknowledged alerts in a separate section with reduced opacity.
- "Ack" button for each open alert → calls `acknowledgeAlert`.
- Colored icon by severity (ErrorOutlineIcon / WarningAmberIcon).
- Category chip + serverId + message + timestamp.

### Modified files

#### `src/main/ipc/types.ts`

Added IPC channels:

- `METRICS_UPDATED`, `ALERT_NEW` (push-only main → renderer)
- `WORKER_START`, `WORKER_STOP`, `ALERTS_GET_ALL`, `ALERTS_ACKNOWLEDGE`

Added types: `AlertCategory`, `AlertSeverity`, `Alert`, `WorkerStartRequest`, `AcknowledgeAlertRequest`.

#### `src/main/ipc/handlers.ts`

Registered 4 new handlers: `WORKER_START`, `WORKER_STOP`, `ALERTS_GET_ALL`, `ALERTS_ACKNOWLEDGE`.

#### `src/preload/index.d.ts`

Added: `Alert`, `WorkerStartRequest`, `AcknowledgeAlertRequest`.
`SqlSentinelAPI` extended with: `workerStart`, `workerStop`, `getAlerts`, `acknowledgeAlert`, `onMetricsUpdated`, `onAlertNew`.

#### `src/preload/index.ts`

Real (IPC) implementations and mocks for the 6 new API methods. Mock `getAlerts()` returns 3 preset alerts (CRITICAL + 2 WARNING). Mock `onMetricsUpdated` and `onAlertNew` return no-op unsubscribe functions.

#### `src/renderer/src/hooks/useMetrics.ts`

- Removed `autoRefreshSeconds`/`setAutoRefreshSeconds` and the associated internal `setInterval` (now managed by the worker in the main process).
- Added `pushMetrics(m: ServerMetrics)` to inject metrics received via push from the worker.
- Refactored history update into an `addHistoryPoint` helper shared by `refresh` and `pushMetrics`.

#### `src/renderer/src/pages/Dashboard.tsx`

- `autoRefreshSeconds` is now local component state.
- `useEffect` that calls `workerStart`/`workerStop` when `autoRefreshSeconds` or the selected server changes.
- `useEffect` that subscribes to `onMetricsUpdated` and filters by current `serverId` → calls `pushMetrics`.
- Removed `autoRefreshSeconds` and `setAutoRefreshSeconds` imports from `useMetrics`.

#### `src/renderer/src/App.tsx`

- `alerts: Alert[]` state loaded at startup from `getAlerts()`.
- Subscription to `onAlertNew` to add alerts in real time.
- `handleAcknowledge(alertId)` calls `acknowledgeAlert` and updates local state.
- MUI `IconButton` with `Badge` in the tab bar: shows the count of unacknowledged CRITICAL alerts, color `error`.
- Clicking the badge opens `AlertsDrawer`.

---

## PHASE 5 — Server Persistence + Unreachability Alerts (2026-03-17)

### Files created

#### `src/main/store/serverStore.ts`

Persistent store for monitored servers via `electron-store@8` (JSON on disk).

- `StoredServer` — main type with: `id` (UUID), `ip`, `port`, `instanceName?`, `useWindowsAuth`, `username?`, `password?`, `addedAt` (ISO 8601), `lastSeen?`, `unreachable?`, `unreachableSince?`.
- Public API: `getAll()`, `getById(id)`, `getByIpPort(ip, port)`, `add(params)`, `update(id, patch)`, `remove(id)`, `upsertByIpPort(params)`.
- The JSON file is saved as `sql-sentinel-data.json` in the Electron app data directory.
- `add()` prevents duplicates by ip:port.
- `upsertByIpPort()` used by the `ADD_SERVER_MANUAL` flow: inserts or updates without duplicates.

#### `src/renderer/src/store/serversStore.ts`

Zustand store on the renderer side (no persist middleware — electron-store is the source of truth).

- `servers: StoredServer[]` — in-memory list, initialized by `loadServers()`.
- `addServer`, `removeServer`, `updateServer` — call IPC and update local state.
- `initialized: boolean` — indicates whether `loadServers()` has completed.

### Modified files

#### `src/main/ipc/types.ts`

Added IPC channels to the `IpcChannel` enum:

- `SERVERS_GET_ALL`, `SERVERS_ADD`, `SERVERS_UPDATE`, `SERVERS_REMOVE_BY_ID`
- `SERVER_UNREACHABLE`, `SERVER_RECOVERED` (push main → renderer)

Added types/interfaces: `ServerAddResult`, `UpdateServerRequest`, `ServerUnreachableEvent`.
Re-export of `StoredServer` from `serverStore`.

#### `src/main/ipc/handlers.ts`

- Removed `let knownServers: DiscoveredServer[]` (in-memory state).
- Import `* as serverStore` from the new store.
- `toDiscovered(s: StoredServer): DiscoveredServer` — backward-compatible adapter for legacy channels.
- `ADD_SERVER_MANUAL` now calls `serverStore.upsertByIpPort()` to persist.
- `GET_SERVERS` now serves from `serverStore.getAll().map(toDiscovered)`.
- `REMOVE_SERVER` looks up by ip:port via `serverStore.getByIpPort()`, then removes by ID.
- New handlers: `SERVERS_GET_ALL`, `SERVERS_ADD`, `SERVERS_UPDATE`, `SERVERS_REMOVE_BY_ID`.
- `EXPORT_INVENTORY` updated to use `serverStore.getAll()`.

#### `src/main/index.ts`

- `mainWindow` ref moved to module scope (required for pushing events from the health check).
- `healthCheckAll()` — TCP probe loop (via `scanHost`) over all saved servers every 60s:
  - If server recovered: updates `unreachable: false`, `lastSeen`, pushes `server:recovered`.
  - If server unreachable: updates `unreachable: true`, `unreachableSince`, pushes `server:unreachable`.
  - First run 5s after app startup.

#### `src/preload/index.ts`

- Re-export of `ServerAddResult`, `UpdateServerRequest`, `ServerUnreachableEvent` from `../main/ipc/types`.
- Mock `mockStoredServers[]` with 2 preset servers.
- `servers.*` API (real + mock): `getAll`, `add`, `update`, `remove`.
- `onServerUnreachable` / `onServerRecovered` (real + mock).

#### `src/preload/index.d.ts`

Added interfaces: `StoredServer`, `ServerAddResult`, `UpdateServerRequest`, `ServerUnreachableEvent`.
`SqlSentinelAPI` extended with `servers.*` and `onServerUnreachable`/`onServerRecovered`.

#### `src/renderer/src/components/Sidebar.tsx`

- `servers` and `selectedServer` types changed from `DiscoveredServer` to `StoredServer`.
- `StatusDot` uses prop `unreachable?: boolean` (previously `reachable: boolean | null`):
  - CSS pulse animation (keyframes `@mui/system`) when `unreachable === true` (1.5s ease-in-out, opacity 1→0.25→1).
- Tooltip shows "Unreachable since {date}" when unreachable.
- React key uses `s.id` (UUID) instead of `serverLabel(s)`.
- Selection comparison uses `selectedServer.id === s.id`.

#### `src/renderer/src/App.tsx`

- `loadServers()` called on mount from `useServersStore`.
- Subscription to `onServerUnreachable` → `updateServer(serverId, { unreachable: true, unreachableSince })`.
- Subscription to `onServerRecovered` → `updateServer(serverId, { unreachable: false, lastSeen })`.

#### `src/renderer/src/pages/Dashboard.tsx`

- Removed local `servers: DiscoveredServer[]` state → uses `useServersStore`.
- `selectedServer` typed as `StoredServer | null`.
- `toCollectRequest()` updated to use `useWindowsAuth`, `username`, `password` from `StoredServer`.
- `handleRemoveServer` calls `removeServer(server.id)` from the store.
- Auto-selects first server when the store is initialized.
- Syncs `selectedServer` if updated in the store (e.g. `unreachable` changes).
- **Unreachability banner**: red panel below the toolbar when the selected server is `unreachable`:
  - Shows "Server unreachable — last contact: {localized date}".
  - "Retry now" button: calls `collectMetrics` directly; if successful → updates store (`unreachable: false`, `lastSeen`) and injects the metrics into the panel.

## hostingType field (on-premise | cloud) — 2026-03-19

### Purpose

Allows classifying each SQL server as on-premise or cloud, with a visual badge and inline editing.

### Modified files

#### `src/main/store/serverStore.ts`

- Added `export type ServerHostingType = 'on-premise' | 'cloud'`
- Added optional field `hostingType?: ServerHostingType` to `StoredServer`
- Backward-compatible: existing servers without the field default to `'on-premise'`

#### `src/renderer/src/types/index.ts`

- Added `hostingType?: 'on-premise' | 'cloud'` to `ServerSummary`

#### `src/renderer/src/constants/hosting.tsx` — NEW

- `ServerHostingType` — re-exported type
- `HOSTING_OPTIONS` — `[{ value, label, icon }]` array for MUI Select
- `HOSTING_BADGE` — `Record<ServerHostingType, { label, color }>` map for badges

#### `src/renderer/src/components/AddServerDialog.tsx`

- Added `hostingType: ServerHostingType` to `AddServerFormData` and `EMPTY_FORM`
- Added `<Select>` "Infrastructure type" after the Group field

#### `src/renderer/src/components/Sidebar.tsx`

- Import `Chip` from MUI, import `HOSTING_BADGE`
- `ServerItem`: `<Chip>` badge ON-PREM / CLOUD next to the alias (flexShrink: 0)

#### `src/renderer/src/components/ServerDashboard.tsx`

- Import `useState`, `Select`, `MenuItem`, `Chip`, `Tooltip`, `Box`
- Import `useServersStore`, `HOSTING_OPTIONS`, `HOSTING_BADGE`
- Added header with clickable badge: click opens a `<Select>` for inline editing; onBlur closes without saving

#### `src/renderer/src/components/HomeDashboard.tsx`

- Import `HOSTING_BADGE`
- Added `INFRASTRUCTURE` column to the server table (between ENVIRONMENT and TYPE)
- `<span>` badge with color and label for each row

#### `src/renderer/src/utils/inventoryUtils.ts`

- `buildServerSummary`: added `hostingType: srv.hostingType` to the return value

#### `src/renderer/src/utils/csvExportUtils.ts`

- Added `Infrastructure Type` column (index 16) in all 4 row variants (standalone placeholder, standalone per-DB, AG placeholder, AG per-DB)

#### `src/renderer/src/pages/Inventory.tsx`

- Added `'Infrastructure Type'` to the `headers` array for CSV export
