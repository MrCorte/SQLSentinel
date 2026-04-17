# SQLSentinel

## Stack
- Electron 39 + React 19 + TypeScript strict
- MUI v5 + MUI X Data Grid 8 + Emotion
- mssql v12 (tedious) — TCP direct, parameterized queries only
- better-sqlite3 (SQLite metrics history)
- recharts 3, React Router 7, Zustand stores
- electron-vite, Prettier, ESLint

## Commands
- `npm run dev` — dev + HMR
- `npm run build` — typecheck + prod build
- `npm run typecheck` — tsc no emit
- `npm run build:win` — Windows .exe + NSIS

## Critical Constraints
- PowerShell **DISABLED** on all targets — no PS-based discovery
- SQL Server Browser UDP 1434 **DISABLED** — TCP port 1433 only
- Named instances: dynamic ports not discoverable — always support manual `host:port:instance`
- TCP scan timeout: 500ms

## Architecture
- Main (`src/main/`) — all SQL/Node logic, `sandbox: false`
- Preload (`src/preload/index.ts`) — contextBridge typed API as `window.sqlSentinel`
- Renderer (`src/renderer/src/`) — React only, no Node imports, IPC via `window.sqlSentinel`
- `contextIsolation: true`, `nodeIntegration: false` always

## Key Paths
- `src/main/ipc/` — typed IPC channels
- `src/main/collectors/` — T-SQL metric queries
- `src/main/store/` — SQLite persistence
- `src/main/discovery/` — TCP scanner
- `src/renderer/src/store/` — Zustand stores
- `src/renderer/src/hooks/` — shared hooks
- `src/preload/index.d.ts` — shared types (StoredServer, etc.)
- `tsconfig.node.json` / `tsconfig.web.json` — split TS configs

## Conventions
- File naming: camelCase components, kebab-case utilities
- T-SQL aliases: `snake_case`
- Prettier: single quotes, no semicolons, width 100, no trailing commas, LF
- Log SQL errors without credentials
- Document changes in `CHANGELOG.md`
