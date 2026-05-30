# CLAUDE.md

Guidance for working in this repository. Read this before making changes.

## What this is

**SQL Sentinel** — an Electron desktop app (React + TypeScript) for monitoring
fleets of Microsoft SQL Server instances. It discovers servers, polls health and
performance metrics, raises alerts, manages incidents, and embeds an AI DBA
assistant (LangChain/LangGraph over Claude or Ollama) with a RAG knowledge base
and human-approved remediation actions.

Primary target platform is **Windows** (DPAPI credential encryption, a Windows
Service for background collection, PowerShell tooling). macOS/Linux are supported
for development via a forked child process.

## Commands

The shell is **PowerShell** (use `$env:VAR`, `$null`, backtick continuation).

| Task | Command |
| --- | --- |
| Dev (Electron + Vite + service) | `npm run dev` |
| Run tests | `npm test` |
| Watch tests | `npm run test:watch` |
| Typecheck (all 3 projects) | `npm run typecheck` |
| Lint | `npm run lint` |
| Format | `npm run format` |
| Build (typecheck + service + bundle) | `npm run build` |
| Package for Windows | `npm run build:win` |

- **Tests run through `scripts/vitest-runner.cjs`**, not `vitest` directly. It
  shells out to **git bash** with `node --experimental-vm-modules` because plain
  Node v24 breaks Vitest's ESM VM evaluator. If tests fail to start, confirm git
  bash exists at one of the paths in that script (or set `$env:BASH`).
- A single test file: `npm test -- src/main/__tests__/authService.test.ts`.
- `better-sqlite3` is a native binary incompatible with plain Node — it is mocked
  globally via `src/__tests__/setup/mockSqlite.ts`.

## Process / module architecture

Four TypeScript build targets, each with its own tsconfig:

- **`tsconfig.node.json`** → `src/main` (Electron main) + `src/preload`
- **`tsconfig.web.json`** → `src/renderer` (React UI)
- **`tsconfig.service.json`** → `src/service` (standalone Windows Service)

### Main process (`src/main`)
- `index.ts` — app lifecycle, window creation, security hardening (CSP header,
  navigation scheme allow-list, single-instance lock), health-check loop, power
  suspend/resume handling, startup migrations, graceful shutdown.
- `metricsWorker.ts` — the polling engine. Priority queue (active/idle/offline),
  exponential backoff, staggered scheduling, batched metric persistence, and
  **coalesced IPC** (`metrics:batchUpdated`) to avoid renderer re-render storms.
- `collectors/` — T-SQL collectors (`sqlCollector`, `agCollector`, `dbAdmin`)
  and `connectionPool` (cached `mssql` pools). **See the collector conventions
  below — there is a `tsql-collector-review` skill that auto-applies here.**
- `ai/` — `langGraphAgent` (the assistant), `providers/` (claude/ollama),
  `executeReadOnly` (SELECT-only guard), `actionTools`/`incidents` (remediation
  proposals requiring approval), `feedbackIndex`/`embedder`/`responseCache` (RAG).
- `store/sqlserver/` — **SQL Server is the primary storage backend** (servers
  registry, metrics history, users, settings, knowledge base, AI feedback).
  `connection.ts` owns the storage pool; `database.ts` runs schema init.
- `ipc/` — typed IPC handlers, grouped by domain, registered in `ipc/index.ts`.

### Preload (`src/preload/index.ts`)
- Bridges main↔renderer over `contextBridge`. Every renderer-callable method is a
  thin `ipcRenderer.invoke(IpcChannel.X, …)` wrapper. Channels are the
  `IpcChannel` enum in `src/main/ipc/types.ts`.
- Has a parallel **mock API** activated by `VITE_MOCK_MODE === 'true'` for UI work
  without a live SQL Server. Keep the real and mock surfaces in sync.

### Renderer (`src/renderer/src`)
- React 19 + MUI v7 + Zustand stores + recharts. `WorkerContext` consumes the
  batched metrics IPC and applies a single Zustand `set()` per flush.
- Pages in `pages/`, feature components in `components/features/`.

### Service (`src/service`)
- Standalone background collector. On Windows it runs as an installed Windows
  Service (`node-windows`, `scripts/install-service.cjs`); on dev/macOS `index.ts`
  forks it as a child process. Built separately with esbuild
  (`scripts/build-service.mjs`). Talks to the app over WebSocket
  (`src/shared/serviceProtocol.ts`). It reuses `src/main/store` and
  `src/main/metricsWorker` — shared, not duplicated.

## Conventions

- **IPC results**: most handlers return `IpcResult<T>` (`{ ok, data }` / error).
  A few `servers.*` handlers return flat values — match the existing handler's
  shape rather than assuming.
- **T-SQL collectors** (enforced by the `tsql-collector-review` skill):
  parameterize all inputs (never string-concat), use **snake_case column
  aliases** (the renderer types expect them), set query timeouts, assume
  least-privilege logins, and do not depend on PowerShell or UDP/1434.
- **Credentials are encrypted at rest** with Electron `safeStorage` (DPAPI).
  Servers store `encryptedPassword`; repositories decrypt transparently on read.
  If the OS keyring is unavailable the app logs a `[SECURITY]` warning and falls
  back to plaintext — don't remove that sentinel.
- **Logging**: use `createLogger(scope)` from `src/main/utils/logger`. Redact
  errors crossing process/log boundaries with `safeError` from `utils/safeLog`
  (strips absolute user paths). Preload suppresses payloads in production.
- **AI safety invariants**: the assistant is SELECT-only; T-SQL must come from
  predefined/knowledge/feedback blocks (never invented); remediation happens only
  through approval-gated tools, never inline DML/DDL. Preserve these when editing
  prompts or tools in `src/main/ai`.
- Comments and some UI strings are in Italian; match the surrounding language of
  the file you're editing.

## Gotchas

- Don't add IPC channels without (1) the `IpcChannel` enum entry, (2) a handler
  registered via `ipc/index.ts`, and (3) both the real and mock preload wrappers.
- Module-level state in main-process files resets between tests because Vitest
  runs with `isolate: true` — rely on that rather than manual teardown.
- The renderer never reaches the network or SQL Server directly; everything goes
  through IPC. Keep that boundary intact (contextIsolation, no nodeIntegration).
- Storage (SQL Server pool) must be initialized before the server registry or
  migrations — see the ordering in `index.ts` `app.whenReady()`.
