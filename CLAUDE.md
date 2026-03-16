# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

SQLSentinel is an Electron 39 + React 19 + TypeScript desktop app for monitoring SQL Server instances reachable from a local Windows VM. Built for a DBA context where PowerShell is disabled on target servers and SQL Server Browser Service (UDP 1434) is disabled — TCP direct connections on port 1433 only.

## Commands

```bash
npm run dev          # Development with hot reload (HMR)
npm run build        # Typecheck + production build
npm run typecheck    # TypeScript validation only (no emit)
npm run lint         # ESLint with cache
npm run format       # Prettier formatting
npm run build:win    # Windows installer (.exe + NSIS)
```

No test runner is configured yet (`npm run test` is a placeholder).

## Architecture

### Electron Process Split

- **Main process** (`src/main/`) — all Node.js/SQL logic runs here. `sandbox: false` is required (needed for mssql/tedious native driver).
- **Preload** (`src/preload/index.ts`) — exposes typed IPC bridge to renderer via `contextBridge`. `contextIsolation: true`, `nodeIntegration: false` always.
- **Renderer** (`src/renderer/src/`) — pure React UI, communicates with main only via `window.api` (the contextBridge API).

The renderer **must never** import Node.js modules directly. All SQL Server interaction goes through typed IPC channels in `src/main/ipc/`.

### TypeScript Config Split

There are two tsconfig files for different environments:
- `tsconfig.node.json` — main process + preload (Node.js types, composite mode)
- `tsconfig.web.json` — renderer (browser types, JSX react-jsx)
- `@renderer/*` path alias resolves to `src/renderer/src/*`

### Planned Module Structure (not yet implemented)

```
src/main/
  discovery/   — TCP scanner (net.Socket, 500ms timeout, port 1433 + 1434 + configurable range)
  ipc/         — typed ipcMain channel definitions
  collectors/  — T-SQL metric queries via mssql
  store/       — SQLite persistence via better-sqlite3

src/renderer/src/
  pages/Discovery/   — network scan UI
  pages/Dashboard/   — aggregated metrics + recharts graphs
```

### Stack Details

- **UI:** MUI v5 + MUI X Data Grid 8 + Emotion
- **SQL Driver:** mssql v12 (tedious) — direct TCP, always parameterized queries
- **Local storage:** better-sqlite3 — metrics history
- **Charts:** recharts 3
- **Routing:** React Router 7

## Critical Environment Constraints

- PowerShell is **disabled** on all SQL Server targets — never use PowerShell-based discovery
- SQL Server Browser (UDP 1434) is **disabled** — no UDP broadcast discovery
- Named instances with dynamic ports are **not auto-discoverable** — always allow manual `host:port:instance` entry
- TCP scan timeout: **500ms** per host

## Code Conventions

- TypeScript strict, no implicit `any`
- T-SQL column aliases: `snake_case`
- File naming: camelCase for React components, kebab-case for utilities
- All SQL errors logged without exposing credentials
- Explicit timeouts on every SQL connection
- Document all changes/additions in `documentazione.md`

## Formatting

Prettier config (`.prettierrc.yaml`): single quotes, no semicolons, print width 100, no trailing commas, LF line endings.
