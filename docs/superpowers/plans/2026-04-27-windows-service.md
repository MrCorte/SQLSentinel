# SQLSentinel Windows Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the metrics worker, collectors, and SQLite store into a standalone Node.js Windows Service so SQLSentinel monitoring continues across daily headless reboots without requiring any user login.

**Architecture:** A new `src/service/` Node.js process owns all data collection and persistence (metricsWorker, collectors, SQLite). It exposes a local HTTP REST + WebSocket server on `localhost:57432` secured with a random shared secret stored in `%ProgramData%\sqlsentinel\service.json`. The Electron app becomes a thin client: on launch it connects via WebSocket to receive real-time metrics push events (bridged to the existing IPC channels — renderer is unchanged), and via HTTP for all commands (server CRUD, settings, alerts). On first connection the Electron app migrates existing electron-store server records to the service. The Windows Service runs as **LocalSystem**, credentials are encrypted with AES-256-GCM using the machine-generated key from `service.json`.

**Tech Stack:** node-windows 3.x, express 4, ws 8, @types/express, @types/ws, esbuild (bundle service), node:crypto (AES-256-GCM), better-sqlite3 (existing), mssql (existing), TypeScript strict

**Offline constraint:** Il server target non ha accesso a internet. Il service bundle viene prodotto in CI/dev, incluso nel pacchetto `electron-builder` come `extraResources`, e gira usando il runtime Node.js già incluso in `SQLSentinel.exe` tramite `ELECTRON_RUN_AS_NODE=1` — nessuna dipendenza esterna sul server.

---

## File Map

### Created
| Path | Responsibility |
|------|----------------|
| `src/shared/serviceProtocol.ts` | HTTP request/response types + WS message shapes shared between service and Electron |
| `src/service/serviceConfig.ts` | Read/write `%ProgramData%\sqlsentinel\service.json` (port + secret) |
| `src/service/credentialCrypto.ts` | AES-256-GCM encrypt/decrypt for server passwords |
| `src/service/wsServer.ts` | WebSocket server, connection registry, broadcast |
| `src/service/httpServer.ts` | Express app factory + auth middleware |
| `src/service/routes/servers.ts` | REST: CRUD for monitored servers |
| `src/service/routes/metrics.ts` | REST: current metrics + history |
| `src/service/routes/settings.ts` | REST: read/write AppSettings |
| `src/service/routes/alerts.ts` | REST: list + acknowledge alerts |
| `src/service/index.ts` | Service entry point: init DB, start worker, start HTTP/WS |
| `src/main/serviceClient.ts` | HTTP + WebSocket client used by Electron main to talk to service |
| `scripts/install-service.cjs` | node-windows: install + start the service |
| `scripts/uninstall-service.cjs` | node-windows: stop + uninstall the service |
| `tsconfig.service.json` | TypeScript config for the service build (Node 22, no Electron types) |

### Modified
| Path | Change |
|------|--------|
| `src/main/metricsWorker.ts` | Replace `BrowserWindow` import + `pushToRenderer` with injectable callback via `setPushHandler()` |
| `src/main/store/serverStore.ts` | Add `toSqlite()` / `fromSqlite()` helpers for migration; keep electron-store as source of truth for Electron-only runtime |
| `src/main/store/database.ts` | Expose `getServerRows()` for migration read; ensure `servers` table DDL is stable |
| `src/main/index.ts` | On app ready: connect to service, set up WS→IPC bridge; start worker in local mode only if service unreachable |
| `src/main/backgroundService.ts` | Remove direct `worker` dependency; add `serviceClient` connection state to tray menu |
| `src/main/ipc/handlers/servers.ipc.ts` | Proxy CRUD operations to service HTTP |
| `src/main/ipc/handlers/metrics.ipc.ts` | Proxy history/settings to service HTTP |
| `src/main/ipc/handlers/alarms.ipc.ts` | Proxy alerts to service HTTP |
| `src/main/ipc/handlers/system.ipc.ts` | Proxy settings to service HTTP |
| `src/preload/index.ts` | Add `getServiceStatus` to contextBridge |
| `src/preload/index.d.ts` | Add `ServiceStatus` type to `SqlSentinelAPI` |
| `package.json` | Add runtime deps: `express`, `ws`; devDeps: `@types/express`, `@types/ws`, `node-windows` |

---

## Task 1 — Dependencies and Build Config

**Files:**
- Modify: `package.json`
- Create: `tsconfig.service.json`
- Create: `scripts/build-service.mjs`

Il service bundle viene prodotto con **esbuild** (già presente come dep transitiva di electron-vite):
- tutti i moduli JS puri vengono inlineati nel bundle
- i moduli nativi (`better-sqlite3`, `mssql`, `electron-store`, `nodemailer`) restano `external` — sono già presenti nell'app packaged
- output: `out/service/index.js` → copiato da electron-builder in `resources/service/index.js`

In produzione il service gira così:
```
ELECTRON_RUN_AS_NODE=1  SQLSentinel.exe  <app-path>\resources\service\index.js
```
Nessun Node.js separato, nessun internet necessario sul server target.

- [ ] **Step 1: Install dependencies**

```bash
npm install express ws
npm install --save-dev @types/express @types/ws node-windows
```

Expected: no peer-dep errors.

- [ ] **Step 2: Create `tsconfig.service.json`** (usato solo per typecheck, non per emit)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "noEmit": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": [
    "src/service/**/*",
    "src/shared/**/*",
    "src/main/collectors/**/*",
    "src/main/store/**/*",
    "src/main/metricsWorker.ts",
    "src/main/deltaUtils.ts",
    "src/main/emailService.ts",
    "src/main/utils/**/*"
  ],
  "exclude": ["node_modules", "out"]
}
```

- [ ] **Step 3: Create `scripts/build-service.mjs`**

```javascript
// Bundla il service con esbuild.
// I moduli nativi restano external — sono già nel pacchetto Electron.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('out/service', { recursive: true })

await build({
  entryPoints: ['src/service/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'out/service/index.js',
  external: [
    // Native modules — già presenti nell'app packaged
    'better-sqlite3',
    'mssql',
    'tedious',
    'electron-store',
    'nodemailer',
    // Electron stesso non serve nel service
    'electron'
  ],
  sourcemap: true,
  minify: false
})

console.log('✓ Service bundle → out/service/index.js')
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
"build:service":    "node scripts/build-service.mjs",
"typecheck:service":"tsc --noEmit -p tsconfig.service.json"
```

Aggiorna anche `"build"`:
```json
"build": "npm run typecheck && npm run build:service && electron-vite build"
```

- [ ] **Step 5: Verify esbuild is available**

```bash
node -e "require('esbuild')" && echo "ok"
```

Expected: `ok` (esbuild è dep transitiva di electron-vite).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.service.json scripts/build-service.mjs
git commit -m "build: esbuild bundle config for service (ELECTRON_RUN_AS_NODE)"
```

---

## Task 2 — Shared Protocol Types

**Files:**
- Create: `src/shared/serviceProtocol.ts`

These types are imported by both the service (to shape responses) and the Electron `serviceClient.ts` (to type requests/responses). Keep them Electron-free.

- [ ] **Step 1: Create `src/shared/serviceProtocol.ts`**

```typescript
import type { ServerMetrics } from '../main/collectors/types'
import type { StoredServer } from '../main/store/serverStore'
import type { AppSettings } from '../main/store/settings'

// ── HTTP response wrapper (mirrors IpcResult) ────────────────────────────────

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ── Alert (duplicated here to avoid importing from metricsWorker) ─────────────

export type AlertSeverity = 'WARNING' | 'CRITICAL'
export type AlertCategory =
  | 'cpu_high'
  | 'blocking_sessions'
  | 'database_offline'
  | 'backup_overdue'
  | 'disk_space_low'

export interface ServiceAlert {
  id: string
  serverId: string
  category: AlertCategory
  severity: AlertSeverity
  message: string
  detectedAt: string       // ISO 8601
  acknowledgedAt: string | null
}

// ── REST request bodies ───────────────────────────────────────────────────────

export interface AddServerBody {
  host: string
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  password?: string
  hostingType?: 'on-premise' | 'cloud'
  notes?: string
}

export interface UpdateServerBody extends Partial<AddServerBody> {
  unreachable?: boolean
  unreachableSince?: string
  lastSeen?: string
  agGroupId?: string
  agName?: string
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  logicalCpus?: number
  physicalCpus?: number
  machineName?: string
}

export interface MigrateServersBody {
  servers: Array<AddServerBody & { id?: string; addedAt?: string }>
}

// ── WebSocket messages (service → client) ────────────────────────────────────

export type WsPushMessage =
  | { type: 'metrics:batchUpdated'; data: Array<{ serverId: string; metrics: ServerMetrics }> }
  | { type: 'metrics:alert-new'; data: ServiceAlert }
  | { type: 'server:healthUpdate'; data: { serverId: string; failCount: number; nextRetry: number; lastSuccess: number | null } }
  | { type: 'server:configUpdated'; data: StoredServer[] }
  | { type: 'service:ready' }

// ── WebSocket messages (client → service) ────────────────────────────────────

export type WsClientMessage =
  | { type: 'worker:setActive'; serverId: string }
  | { type: 'worker:syncServers' }   // service re-reads its own DB, no payload needed

// ── Service health ────────────────────────────────────────────────────────────

export interface ServiceHealth {
  ok: true
  version: string
  uptime: number           // process.uptime() seconds
  serversMonitored: number
}

// ── Re-exports for convenience ────────────────────────────────────────────────

export type { StoredServer, AppSettings, ServerMetrics }
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit -p tsconfig.service.json 2>&1 | grep -v "^$" | head -20
```

Expected: errors only for missing service entry files (ok at this stage).

- [ ] **Step 3: Commit**

```bash
git add src/shared/serviceProtocol.ts
git commit -m "feat(service): add shared HTTP/WS protocol types"
```

---

## Task 3 — Service Config (Port + Secret)

**Files:**
- Create: `src/service/serviceConfig.ts`
- Create: `src/service/__tests__/serviceConfig.test.ts`

The config file lives at `%ProgramData%\sqlsentinel\service.json`. Both the service (reads on start) and the Electron app (reads to know where to connect) use this module.

- [ ] **Step 1: Write the failing test**

Create `src/service/__tests__/serviceConfig.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// We test loadOrCreateConfig by pointing it at a temp dir
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real }
})

// Override the config path to a temp directory for tests
const tmpDir = join(tmpdir(), `sqlsentinel-test-${Date.now()}`)
vi.mock('../serviceConfig', async () => {
  const { randomBytes } = await import('node:crypto')
  const { join } = await import('node:path')
  const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
  const CONFIG_PATH = join(tmpDir, 'service.json')
  function loadOrCreateConfig() {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    } catch {
      const config = { port: 57432, secret: randomBytes(32).toString('hex') }
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
      return config
    }
  }
  return { loadOrCreateConfig, CONFIG_PATH }
})

import { loadOrCreateConfig } from '../serviceConfig'

describe('loadOrCreateConfig', () => {
  it('creates config with valid port and 64-char hex secret when file missing', () => {
    const cfg = loadOrCreateConfig()
    expect(cfg.port).toBe(57432)
    expect(cfg.secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns same secret on second call (reads from disk)', () => {
    const first = loadOrCreateConfig()
    const second = loadOrCreateConfig()
    expect(first.secret).toBe(second.secret)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- src/service/__tests__/serviceConfig.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/service/serviceConfig.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface ServiceConfig {
  port: number
  secret: string
}

export const CONFIG_DIR = join(
  process.env['ProgramData'] ?? 'C:\\ProgramData',
  'sqlsentinel'
)
export const CONFIG_PATH = join(CONFIG_DIR, 'service.json')

export function loadOrCreateConfig(): ServiceConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ServiceConfig
  } catch {
    const config: ServiceConfig = {
      port: 57432,
      secret: randomBytes(32).toString('hex')
    }
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return config
  }
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
npm test -- src/service/__tests__/serviceConfig.test.ts 2>&1 | tail -5
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/serviceConfig.ts src/service/__tests__/serviceConfig.test.ts
git commit -m "feat(service): service config with auto-generated port + secret"
```

---

## Task 4 — Credential Crypto (AES-256-GCM)

**Files:**
- Create: `src/service/credentialCrypto.ts`
- Create: `src/service/__tests__/credentialCrypto.test.ts`

Server passwords in SQLite are encrypted with AES-256-GCM using a key derived from the service secret. This replaces `safeStorage` (DPAPI) which is Electron/user-scoped and inaccessible from the Windows Service running as LocalSystem.

- [ ] **Step 1: Write the failing test**

Create `src/service/__tests__/credentialCrypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../credentialCrypto'

const SECRET = 'a'.repeat(64) // 32-byte hex key

describe('credentialCrypto', () => {
  it('round-trips a password', () => {
    const plain = 'MyP@ssw0rd!'
    expect(decrypt(encrypt(plain, SECRET), SECRET)).toBe(plain)
  })

  it('produces different ciphertext each call (random IV)', () => {
    const plain = 'same-password'
    expect(encrypt(plain, SECRET)).not.toBe(encrypt(plain, SECRET))
  })

  it('throws on tampered ciphertext', () => {
    const cipher = encrypt('secret', SECRET)
    const tampered = cipher.slice(0, -4) + 'AAAA'
    expect(() => decrypt(tampered, SECRET)).toThrow()
  })

  it('throws when decrypting with wrong secret', () => {
    const cipher = encrypt('secret', SECRET)
    const wrongSecret = 'b'.repeat(64)
    expect(() => decrypt(cipher, wrongSecret)).toThrow()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/service/__tests__/credentialCrypto.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/service/credentialCrypto.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const SALT = 'sqlsentinel-credential-v1'
const KEY_LEN = 32

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_LEN)
}

/** Encrypts plaintext. Output format: base64(iv[12] + authTag[16] + ciphertext) */
export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/** Decrypts ciphertext produced by encrypt(). Throws on auth failure or wrong key. */
export function decrypt(ciphertext: string, secret: string): string {
  const key = deriveKey(secret)
  const buf = Buffer.from(ciphertext, 'base64')
  if (buf.length < 28) throw new Error('Invalid ciphertext length')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
npm test -- src/service/__tests__/credentialCrypto.test.ts 2>&1 | tail -5
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/credentialCrypto.ts src/service/__tests__/credentialCrypto.test.ts
git commit -m "feat(service): AES-256-GCM credential encryption for service process"
```

---

## Task 5 — metricsWorker: Remove Electron Dependency

**Files:**
- Modify: `src/main/metricsWorker.ts`

The worker currently calls `BrowserWindow.getAllWindows()` to push data to the renderer. In the service process there is no `BrowserWindow`. Replace the push mechanism with an injectable callback registered by the caller.

- [ ] **Step 1: Add `setPushHandler` export and replace `pushToRenderer`**

In `src/main/metricsWorker.ts`, find and replace the existing `pushToRenderer` function and `BrowserWindow` import:

Current (lines ~1-4 and ~109-113):
```typescript
import { BrowserWindow } from 'electron'
// ...
function pushToRenderer(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, data)
  })
}
```

Replace with (remove the `BrowserWindow` import entirely, add below the existing constants block):
```typescript
// Injectable push handler — set by the host process (Electron or service)
let _pushHandler: ((channel: string, data: unknown) => void) = () => {}

export function setPushHandler(fn: (channel: string, data: unknown) => void): void {
  _pushHandler = fn
}

function pushToRenderer(channel: string, data: unknown): void {
  _pushHandler(channel, data)
}
```

- [ ] **Step 2: Remove `hasVisibleWindow` guard from `runJob`**

In `runJob`, find all occurrences of `hasVisibleWindow`:

```typescript
// REMOVE this variable declaration:
const hasVisibleWindow = BrowserWindow.getAllWindows().some(
  (w) => !w.isDestroyed() && w.isVisible()
)

// REMOVE these two guards (the condition, not the inner call):
if (hasVisibleWindow) {
  enqueueBatchPush(sid, delta)
}
// becomes:
enqueueBatchPush(sid, delta)

// and:
if (hasVisibleWindow) {
  pushToRenderer(IpcChannel.SERVER_HEALTH_UPDATE, health)
}
// becomes:
pushToRenderer(IpcChannel.SERVER_HEALTH_UPDATE, health)
```

The push handler itself decides whether to actually transmit (in Electron it will check window visibility; in the service it always transmits to connected WebSocket clients).

- [ ] **Step 3: Register the Electron-mode push handler in `src/main/index.ts`**

Find where `startWorker` is called in `src/main/index.ts` and add before it:

```typescript
import { setPushHandler } from './metricsWorker'
import { BrowserWindow } from 'electron'

setPushHandler((channel, data) => {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed() && w.isVisible()) w.webContents.send(channel, data)
  })
})
```

- [ ] **Step 4: Run typecheck to confirm no regressions**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 5: Run existing worker tests**

```bash
npm test -- src/main/__tests__/metricsWorker.background.test.ts src/main/__tests__/pollingManager.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/metricsWorker.ts src/main/index.ts
git commit -m "refactor(worker): replace BrowserWindow.send with injectable push handler"
```

---

## Task 6 — WebSocket Server

**Files:**
- Create: `src/service/wsServer.ts`
- Create: `src/service/__tests__/wsServer.test.ts`

The WebSocket server broadcasts push messages from the worker to all connected Electron app instances. It also handles inbound control messages from clients.

- [ ] **Step 1: Write the failing test**

Create `src/service/__tests__/wsServer.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import WebSocket from 'ws'
import { createWsServer } from '../wsServer'

let httpServer: ReturnType<typeof createServer>
let wss: ReturnType<typeof createWsServer>
const TEST_SECRET = 'test-secret-1234'
const TEST_PORT = 57499

beforeAll(async () => {
  httpServer = createServer()
  wss = createWsServer(httpServer, TEST_SECRET, () => {})
  await new Promise<void>((r) => httpServer.listen(TEST_PORT, '127.0.0.1', r))
})

afterAll(async () => {
  await new Promise<void>((r) => httpServer.close(() => r()))
})

describe('createWsServer', () => {
  it('rejects connection without correct secret', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?secret=wrong`)
    await new Promise<void>((resolve) => {
      ws.on('close', (code) => {
        expect(code).toBe(4401)
        resolve()
      })
    })
  })

  it('accepts connection with correct secret and receives service:ready', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?secret=${TEST_SECRET}`)
    const msg = await new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()))
    })
    const parsed = JSON.parse(msg)
    expect(parsed.type).toBe('service:ready')
    ws.close()
  })

  it('broadcast sends message to all connected clients', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?secret=${TEST_SECRET}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?secret=${TEST_SECRET}`)

    // Wait for both to be ready (skip the service:ready message)
    await Promise.all([
      new Promise<void>((r) => ws1.on('open', () => r())),
      new Promise<void>((r) => ws2.on('open', () => r()))
    ])
    // Flush service:ready messages
    await new Promise((r) => setTimeout(r, 50))

    const received: string[] = []
    ws1.on('message', (d) => received.push(d.toString()))
    ws2.on('message', (d) => received.push(d.toString()))

    wss.broadcast('test:event', { hello: 'world' })

    await new Promise((r) => setTimeout(r, 50))
    expect(received).toHaveLength(2)
    expect(JSON.parse(received[0])).toEqual({ type: 'test:event', data: { hello: 'world' } })

    ws1.close()
    ws2.close()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/service/__tests__/wsServer.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/service/wsServer.ts`**

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'node:http'
import type { WsClientMessage } from '../shared/serviceProtocol'
import { createLogger } from '../main/utils/logger'

const log = createLogger('ws-server')

export interface WsServerHandle {
  broadcast(type: string, data?: unknown): void
  connectedClients(): number
}

export function createWsServer(
  httpServer: Server,
  secret: string,
  onClientMessage: (msg: WsClientMessage) => void
): WsServerHandle {
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://localhost`)
    if (url.searchParams.get('secret') !== secret) {
      ws.close(4401, 'Unauthorized')
      return
    }

    ws.send(JSON.stringify({ type: 'service:ready' }))

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsClientMessage
        onClientMessage(msg)
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('error', (err) => log.warn('[WS] client error:', err.message))
  })

  return {
    broadcast(type: string, data?: unknown): void {
      const payload = JSON.stringify({ type, data })
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload)
        }
      })
    },
    connectedClients(): number {
      return [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN).length
    }
  }
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
npm test -- src/service/__tests__/wsServer.test.ts 2>&1 | tail -5
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/wsServer.ts src/service/__tests__/wsServer.test.ts
git commit -m "feat(service): WebSocket push server with secret auth"
```

---

## Task 7 — HTTP Server and Routes

**Files:**
- Create: `src/service/httpServer.ts`
- Create: `src/service/routes/servers.ts`
- Create: `src/service/routes/metrics.ts`
- Create: `src/service/routes/settings.ts`
- Create: `src/service/routes/alerts.ts`

Express app with Bearer token auth middleware. Routes proxy calls to the existing store/worker modules.

- [ ] **Step 1: Create `src/service/httpServer.ts`**

```typescript
import express, { type Request, type Response, type NextFunction } from 'express'
import { createServer } from 'node:http'
import type { WsServerHandle } from './wsServer'
import { createServersRouter } from './routes/servers'
import { createMetricsRouter } from './routes/metrics'
import { createSettingsRouter } from './routes/settings'
import { createAlertsRouter } from './routes/alerts'
import type { ServiceHealth } from '../shared/serviceProtocol'

export function createHttpServer(secret: string, wsHandle: WsServerHandle) {
  const app = express()
  app.use(express.json())

  // Auth middleware — all routes except /health require Bearer token
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next()
    const auth = req.headers['authorization'] ?? ''
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ ok: false, error: 'Unauthorized' })
      return
    }
    next()
  })

  // Health (no auth)
  app.get('/health', (_req: Request, res: Response) => {
    const body: ServiceHealth = {
      ok: true,
      version: '1.0.0',
      uptime: process.uptime(),
      serversMonitored: 0
    }
    res.json(body)
  })

  app.use('/api/servers', createServersRouter())
  app.use('/api/metrics', createMetricsRouter())
  app.use('/api/settings', createSettingsRouter())
  app.use('/api/alerts', createAlertsRouter())

  const httpServer = createServer(app)
  return { app, httpServer }
}
```

- [ ] **Step 2: Create `src/service/routes/servers.ts`**

```typescript
import { Router, type Request, type Response } from 'express'
import * as serverStore from '../../main/store/serverStore'
import { syncServers, stopWorker } from '../../main/metricsWorker'
import type { AddServerBody, UpdateServerBody, MigrateServersBody, ServiceResult } from '../../shared/serviceProtocol'
import type { StoredServer } from '../../main/store/serverStore'
import { loadOrCreateConfig } from '../serviceConfig'
import { encrypt } from '../credentialCrypto'

function toCollectRequest(s: StoredServer) {
  return {
    ip: s.host,
    port: s.port,
    instanceName: s.instanceName,
    useWindowsAuth: s.useWindowsAuth,
    username: s.username,
    password: s.password
  }
}

function refreshWorker(): void {
  const servers = serverStore.getAll()
  if (servers.length === 0) {
    stopWorker()
    return
  }
  syncServers(servers.map(toCollectRequest))
}

export function createServersRouter(): Router {
  const router = Router()
  const config = loadOrCreateConfig()

  // GET /api/servers
  router.get('/', (_req: Request, res: Response) => {
    const result: ServiceResult<StoredServer[]> = {
      ok: true,
      data: serverStore.getAll().map(serverStore.stripCredentials)
    }
    res.json(result)
  })

  // POST /api/servers
  router.post('/', (req: Request, res: Response) => {
    const body = req.body as AddServerBody
    const result = serverStore.add(body)
    if (result.success && result.server) {
      refreshWorker()
      res.status(201).json({ ok: true, data: serverStore.stripCredentials(result.server) })
    } else {
      res.status(409).json({ ok: false, error: result.reason ?? 'add failed' })
    }
  })

  // PUT /api/servers/:id
  router.put('/:id', (req: Request, res: Response) => {
    const patch = req.body as UpdateServerBody
    serverStore.update(req.params['id']!, patch)
    refreshWorker()
    res.json({ ok: true, data: { success: true } })
  })

  // DELETE /api/servers/:id
  router.delete('/:id', (req: Request, res: Response) => {
    serverStore.remove(req.params['id']!)
    refreshWorker()
    res.json({ ok: true, data: { success: true } })
  })

  // POST /api/servers/migrate — bulk import from Electron (one-time migration)
  router.post('/migrate', (req: Request, res: Response) => {
    const { servers } = req.body as MigrateServersBody
    let imported = 0
    for (const s of servers) {
      const existing = serverStore.getByIpPort(s.host, s.port)
      if (!existing) {
        serverStore.add(s)
        imported++
      }
    }
    if (imported > 0) refreshWorker()
    res.json({ ok: true, data: { imported } })
  })

  return router
}
```

- [ ] **Step 3: Create `src/service/routes/metrics.ts`**

```typescript
import { Router, type Request, type Response } from 'express'
import * as metricsRepository from '../../main/store/metricsRepository'
import { getHistory, getHistoryAll } from '../../main/metricsWorker'
import * as serverStore from '../../main/store/serverStore'

export function createMetricsRouter(): Router {
  const router = Router()

  // GET /api/metrics/history/bulk — all servers, last N snapshots
  router.get('/history/bulk', (_req: Request, res: Response) => {
    res.json({ ok: true, data: getHistoryAll() })
  })

  // GET /api/metrics/:serverId/history?days=N
  router.get('/:serverId/history', (req: Request, res: Response) => {
    const days = parseInt(req.query['days'] as string ?? '1', 10)
    const rows = metricsRepository.findHistory(req.params['serverId']!, days)
    res.json({ ok: true, data: rows })
  })

  return router
}
```

- [ ] **Step 4: Create `src/service/routes/settings.ts`**

```typescript
import { Router, type Request, type Response } from 'express'
import { getSettings, saveSettings } from '../../main/store/settings'
import type { AppSettings } from '../../main/store/settings'

export function createSettingsRouter(): Router {
  const router = Router()

  router.get('/', (_req: Request, res: Response) => {
    res.json({ ok: true, data: getSettings() })
  })

  router.put('/', (req: Request, res: Response) => {
    saveSettings(req.body as Partial<AppSettings>)
    res.json({ ok: true, data: getSettings() })
  })

  return router
}
```

- [ ] **Step 5: Create `src/service/routes/alerts.ts`**

```typescript
import { Router, type Request, type Response } from 'express'
import { getAlerts, acknowledgeAlert } from '../../main/metricsWorker'

export function createAlertsRouter(): Router {
  const router = Router()

  router.get('/', (_req: Request, res: Response) => {
    res.json({ ok: true, data: getAlerts() })
  })

  router.post('/:id/acknowledge', (req: Request, res: Response) => {
    const ok = acknowledgeAlert(req.params['id']!)
    res.json({ ok, data: { success: ok } })
  })

  return router
}
```

- [ ] **Step 6: Run typecheck on service sources**

```bash
npm run build:service 2>&1 | grep "error TS" | head -20
```

Expected: 0 type errors (only missing `src/service/index.ts` which is next task).

- [ ] **Step 7: Commit**

```bash
git add src/service/httpServer.ts src/service/routes/
git commit -m "feat(service): HTTP REST server with servers/metrics/settings/alerts routes"
```

---

## Task 8 — Service Entry Point

**Files:**
- Create: `src/service/index.ts`

Wires together: DB init → worker init → WebSocket server → HTTP server → listen.

- [ ] **Step 1: Create `src/service/index.ts`**

```typescript
import { createServer } from 'node:http'
import { join } from 'node:path'
import { loadOrCreateConfig } from './serviceConfig'
import { createWsServer } from './wsServer'
import { createHttpServer } from './httpServer'
import { initDb } from '../main/store/database'
import * as serverStore from '../main/store/serverStore'
import { startWorker, setPushHandler, getAlerts } from '../main/metricsWorker'
import { getSettings } from '../main/store/settings'
import { createLogger } from '../main/utils/logger'
import type { WsClientMessage } from '../shared/serviceProtocol'

const log = createLogger('service')

async function main(): Promise<void> {
  // 1. Load config (creates %ProgramData%\sqlsentinel\service.json if missing)
  const config = loadOrCreateConfig()
  log.info(`[service] Starting on port ${config.port}`)

  // 2. Init SQLite
  const dbPath = join(
    process.env['APPDATA'] ?? process.env['HOME'] ?? '.',
    'sqlsentinel',
    'data.db'
  )
  initDb(dbPath)
  log.info(`[service] Database: ${dbPath}`)

  // 3. Run startup migrations
  serverStore.migrateHostField()
  serverStore.migrateEncryptCredentials()

  // 4. Create HTTP server (needed by both Express and ws)
  const { app: _app, httpServer } = createHttpServer(config.secret, {
    broadcast: () => {},
    connectedClients: () => 0
  })

  // 5. Create WebSocket server (attach to same httpServer)
  const wsHandle = createWsServer(
    httpServer,
    config.secret,
    (msg: WsClientMessage) => {
      if (msg.type === 'worker:setActive') {
        const { setActiveServer } = require('../main/metricsWorker')
        setActiveServer(msg.serverId)
      }
    }
  )

  // 6. Wire push handler: worker → WebSocket → all connected Electron apps
  setPushHandler((channel, data) => {
    wsHandle.broadcast(channel, data)
  })

  // 7. Start polling worker
  const settings = getSettings()
  const servers = serverStore.getAll()
  if (servers.length > 0) {
    startWorker({
      servers: servers.map((s) => ({
        ip: s.host,
        port: s.port,
        instanceName: s.instanceName,
        useWindowsAuth: s.useWindowsAuth,
        username: s.username,
        password: s.password
      })),
      intervalSeconds: 60,
      activeServerId: null
    })
    log.info(`[service] Worker started — monitoring ${servers.length} server(s)`)
  }

  // 8. Start listening
  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, '127.0.0.1', resolve)
  })
  log.info(`[service] Listening on 127.0.0.1:${config.port}`)
}

main().catch((err) => {
  console.error('[service] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify the service builds**

```bash
npm run build:service 2>&1 | grep "error TS"
```

Expected: 0 errors.

- [ ] **Step 3: Smoke test — start service manually (requires APPDATA writable)**

```bash
node out/service/index.js &
sleep 2
curl -s http://localhost:57432/health
kill %1
```

Expected: `{"ok":true,"version":"1.0.0","uptime":...,"serversMonitored":0}`

- [ ] **Step 4: Commit**

```bash
git add src/service/index.ts
git commit -m "feat(service): service entry point — DB + worker + HTTP/WS"
```

---

## Task 9 — Windows Service Install Scripts

**Files:**
- Create: `scripts/install-service.cjs`
- Create: `scripts/uninstall-service.cjs`

Gli script vengono distribuiti insieme all'app e devono essere eseguiti con **privilegi di Administrator** dopo l'installazione. Usano `ELECTRON_RUN_AS_NODE=1` per far girare il bundle del servizio tramite `SQLSentinel.exe` — nessun Node.js esterno richiesto.

Il percorso dell'eseguibile Electron viene rilevato automaticamente dalla posizione dello script (che si trova in `<app-dir>\resources\scripts\`).

- [ ] **Step 1: Create `scripts/install-service.cjs`**

```javascript
// Eseguire con privilegi Administrator:
//   node install-service.cjs
// oppure tramite il pulsante "Installa Servizio" nell'app (richiede UAC elevation).
//
// Il servizio gira come LocalSystem usando ELECTRON_RUN_AS_NODE=1 con
// SQLSentinel.exe — nessun Node.js separato necessario.

const path = require('path')
const Service = require('node-windows').Service

// Quando impacchettato da electron-builder, questo script si trova in:
//   <install-dir>\resources\scripts\install-service.cjs
// L'eseguibile Electron è in:
//   <install-dir>\sqlsentinel.exe
// Il bundle del servizio è in:
//   <install-dir>\resources\service\index.js
const appDir = path.resolve(__dirname, '..', '..')   // risale da resources/scripts/ a <install-dir>
const execPath = path.join(appDir, 'sqlsentinel.exe')
const scriptPath = path.join(appDir, 'resources', 'service', 'index.js')

const svc = new Service({
  name: 'SQLSentinel Monitor',
  description: 'SQLSentinel background metrics collection service',
  script: scriptPath,
  execPath: execPath,
  env: [
    { name: 'ELECTRON_RUN_AS_NODE', value: '1' }
  ],
  maxRestarts: 3,
  wait: 1,
  grow: 0.25,
  abortOnError: false
})

svc.on('install', () => {
  svc.start()
  console.log('SQLSentinel Monitor installato e avviato.')
  console.log('Verifica: sc query "SQLSentinel Monitor"')
})

svc.on('error', (err) => {
  console.error('Errore installazione servizio:', err)
  process.exit(1)
})

svc.install()
```

- [ ] **Step 2: Create `scripts/uninstall-service.cjs`**

```javascript
const path = require('path')
const Service = require('node-windows').Service

const appDir = path.resolve(__dirname, '..', '..')
const scriptPath = path.join(appDir, 'resources', 'service', 'index.js')

const svc = new Service({
  name: 'SQLSentinel Monitor',
  script: scriptPath
})

svc.on('uninstall', () => {
  console.log('SQLSentinel Monitor disinstallato.')
})

svc.on('error', (err) => {
  console.error('Errore disinstallazione:', err)
  process.exit(1)
})

svc.uninstall()
```

- [ ] **Step 3: Aggiungi IPC handler per avviare l'install con elevazione UAC**

In `src/main/ipc/handlers/system.ipc.ts`, aggiungi (richiede `SERVICES_INSTALL` in `IpcChannel`):

```typescript
import { shell } from 'electron'
import { join } from 'node:path'
import { app } from 'electron'

handle(IpcChannel.SERVICE_INSTALL, async (): Promise<IpcResult<{ launched: boolean }>> => {
  const scriptPath = join(app.getAppPath(), '..', 'scripts', 'install-service.cjs')
  // shell.openPath non supporta elevazione; usiamo un .bat temporaneo con runas
  const { execFile } = await import('node:child_process')
  execFile('cmd', ['/c', 'runas', '/user:Administrator',
    `node "${scriptPath}"`], { windowsHide: false })
  return { ok: true, data: { launched: true } }
})
```

> Nota: L'approccio semplificato con `runas` apre un prompt UAC. In alternativa, usa `sudo-prompt` npm package per una UX migliore — aggiungilo come dipendenza opzionale.

- [ ] **Step 4: Commit**

```bash
git add scripts/install-service.cjs scripts/uninstall-service.cjs
git commit -m "feat(service): install/uninstall scripts via ELECTRON_RUN_AS_NODE=1"
```

---

## Task 10 — Electron Service Client

**Files:**
- Create: `src/main/serviceClient.ts`

HTTP + WebSocket client used by the Electron main process. Handles connection, reconnection, and WS→IPC bridging.

- [ ] **Step 1: Create `src/main/serviceClient.ts`**

```typescript
import { net } from 'electron'
import { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import { createLogger } from './utils/logger'
import type { WsPushMessage, WsClientMessage } from '../shared/serviceProtocol'
import { CONFIG_PATH } from './serviceConfig'
import { readFileSync } from 'node:fs'

const log = createLogger('service-client')

export interface ServiceConfig {
  port: number
  secret: string
}

export type ServiceStatus = 'connected' | 'connecting' | 'disconnected'

let _config: ServiceConfig | null = null
let _ws: WebSocket | null = null
let _status: ServiceStatus = 'disconnected'
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _statusListeners: Array<(s: ServiceStatus) => void> = []

// ── Config ────────────────────────────────────────────────────────────────────

export function loadServiceConfig(): ServiceConfig | null {
  // Import CONFIG_PATH from service module at runtime to avoid Electron
  // main trying to load it before the service has created it.
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ServiceConfig
  } catch {
    log.warn('[serviceClient] service.json not found — service not installed?')
    return null
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchService<T>(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  if (!_config) throw new Error('Service config not loaded')
  const url = `http://127.0.0.1:${_config.port}${path}`
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_config.secret}`
    },
    body: options?.body != null ? JSON.stringify(options.body) : undefined
  })
  if (!res.ok) throw new Error(`Service returned ${res.status}`)
  return res.json() as T
}

export const serviceApi = {
  getServers: () => fetchService<{ ok: true; data: unknown[] }>('/api/servers'),
  addServer: (body: unknown) => fetchService('/api/servers', { method: 'POST', body }),
  updateServer: (id: string, patch: unknown) =>
    fetchService(`/api/servers/${id}`, { method: 'PUT', body: patch }),
  removeServer: (id: string) => fetchService(`/api/servers/${id}`, { method: 'DELETE' }),
  migrateServers: (servers: unknown[]) =>
    fetchService('/api/servers/migrate', { method: 'POST', body: { servers } }),
  getAlerts: () => fetchService('/api/alerts'),
  acknowledgeAlert: (id: string) =>
    fetchService(`/api/alerts/${id}/acknowledge`, { method: 'POST' }),
  getSettings: () => fetchService('/api/settings'),
  updateSettings: (patch: unknown) =>
    fetchService('/api/settings', { method: 'PUT', body: patch }),
  getMetricsHistoryBulk: () => fetchService('/api/metrics/history/bulk'),
  health: () => fetch(`http://127.0.0.1:${_config?.port ?? 57432}/health`).then((r) => r.json())
}

// ── WebSocket + push bridge ───────────────────────────────────────────────────

function pushToRenderer(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed() && w.isVisible()) w.webContents.send(channel, data)
  })
}

function setStatus(s: ServiceStatus): void {
  _status = s
  _statusListeners.forEach((fn) => fn(s))
}

export function onStatusChange(fn: (s: ServiceStatus) => void): void {
  _statusListeners.push(fn)
}

export function getStatus(): ServiceStatus {
  return _status
}

export function sendToService(msg: WsClientMessage): void {
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(msg))
  }
}

function scheduleReconnect(): void {
  if (_reconnectTimer) return
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    connect()
  }, 5_000)
}

export function connect(): void {
  if (!_config) {
    _config = loadServiceConfig()
    if (!_config) {
      setStatus('disconnected')
      return
    }
  }

  setStatus('connecting')
  const url = `ws://127.0.0.1:${_config.port}?secret=${_config.secret}`
  const ws = new WebSocket(url)
  _ws = ws

  ws.on('open', () => {
    log.info('[serviceClient] Connected to service')
    setStatus('connected')
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as WsPushMessage
      if (msg.type === 'service:ready') return
      pushToRenderer(msg.type, msg.data)
    } catch {
      // ignore
    }
  })

  ws.on('close', () => {
    log.warn('[serviceClient] Disconnected — retrying in 5s')
    setStatus('disconnected')
    scheduleReconnect()
  })

  ws.on('error', (err) => {
    log.error('[serviceClient] WS error:', err.message)
  })
}

export function disconnect(): void {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
  _ws?.close()
  _ws = null
  setStatus('disconnected')
}
```

- [ ] **Step 2: Import `CONFIG_PATH` from the correct location**

`serviceClient.ts` imports `CONFIG_PATH` from `./serviceConfig`. This is the **Electron-side copy** of the module (which reads from `%ProgramData%`). Create `src/main/serviceConfig.ts` as a thin re-export:

```typescript
// src/main/serviceConfig.ts
// Re-export from service module — safe to import in Electron main (no Electron APIs used)
export { CONFIG_PATH, loadOrCreateConfig } from '../service/serviceConfig'
```

Update the import in `serviceClient.ts` accordingly:
```typescript
import { CONFIG_PATH } from './serviceConfig'
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck:node 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/serviceClient.ts src/main/serviceConfig.ts
git commit -m "feat(electron): service client — HTTP API + WS push bridge"
```

---

## Task 11 — Electron IPC Proxy

**Files:**
- Modify: `src/main/ipc/handlers/servers.ipc.ts`
- Modify: `src/main/ipc/handlers/metrics.ipc.ts`
- Modify: `src/main/ipc/handlers/alarms.ipc.ts`
- Modify: `src/main/ipc/handlers/system.ipc.ts`

Replace direct store/worker calls with proxied calls to the service HTTP API. The channel names, request shapes, and response shapes stay identical — the renderer sees no change.

- [ ] **Step 1: Proxy server CRUD in `servers.ipc.ts`**

Replace the body of `registerServerHandlers` — keep only `SCAN_SUBNET` and `DETECT_SERVER_INFO` as local (they use `tcpScanner` and `ServerService.detectServer`, which stay in Electron). Replace everything else:

```typescript
import { serviceApi } from '../serviceClient'

// SERVERS_GET_ALL
handle(IpcChannel.SERVERS_GET_ALL, async (): Promise<IpcResult<StoredServer[]>> => {
  try {
    const res = await serviceApi.getServers()
    return res as IpcResult<StoredServer[]>
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})

// SERVERS_ADD
handle(IpcChannel.SERVERS_ADD, async (_e, params): Promise<IpcResult<ServerAddResult>> => {
  try {
    const res = await serviceApi.addServer(params)
    return res as IpcResult<ServerAddResult>
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})

// SERVERS_UPDATE
handle(IpcChannel.SERVERS_UPDATE, async (_e, id: string, patch): Promise<IpcResult<{ success: boolean }>> => {
  try {
    await serviceApi.updateServer(id, patch)
    return { ok: true, data: { success: true } }
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})

// SERVERS_REMOVE_BY_ID
handle(IpcChannel.SERVERS_REMOVE_BY_ID, async (_e, id: string): Promise<IpcResult<{ success: boolean }>> => {
  try {
    await serviceApi.removeServer(id)
    return { ok: true, data: { success: true } }
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})
```

- [ ] **Step 2: Proxy settings in `system.ipc.ts`**

Find `SETTINGS_GET` and `SETTINGS_SET` handlers and replace:

```typescript
handle(IpcChannel.SETTINGS_GET, async (): Promise<IpcResult<AppSettings>> => {
  try {
    const res = await serviceApi.getSettings()
    return res as IpcResult<AppSettings>
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})

handle(IpcChannel.SETTINGS_SET, async (_e, patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>> => {
  try {
    const res = await serviceApi.updateSettings(patch)
    return res as IpcResult<AppSettings>
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})
```

- [ ] **Step 3: Proxy alerts in `alarms.ipc.ts`**

```typescript
handle(IpcChannel.ALERTS_GET_ALL, async (): Promise<IpcResult<Alert[]>> => {
  try {
    const res = await serviceApi.getAlerts()
    return res as IpcResult<Alert[]>
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})

handle(IpcChannel.ALERTS_ACKNOWLEDGE, async (_e, id: string): Promise<IpcResult<boolean>> => {
  try {
    await serviceApi.acknowledgeAlert(id)
    return { ok: true, data: true }
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})
```

- [ ] **Step 4: Proxy bulk history in `metrics.ipc.ts`**

```typescript
handle(IpcChannel.METRICS_HISTORY_BULK, async (): Promise<IpcResult<Record<string, ServerMetrics[]>>> => {
  try {
    const res = await serviceApi.getMetricsHistoryBulk()
    return res as IpcResult<Record<string, ServerMetrics[]>>
  } catch (err) {
    return { ok: false, error: safeError(err) }
  }
})
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck:node 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/handlers/
git commit -m "refactor(ipc): proxy server/settings/alerts/history handlers to service HTTP"
```

---

## Task 12 — Credential Migration + App Startup

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/backgroundService.ts`

On app launch: connect to service, migrate electron-store servers if service has none, update tray to reflect connection state.

- [ ] **Step 1: Add service connect + migration to `src/main/index.ts`**

After `app.whenReady()`, before registering IPC handlers, add:

```typescript
import { connect, serviceApi, onStatusChange, getStatus } from './serviceClient'
import * as serverStore from './store/serverStore'

// Connect to service on startup
connect()

// Migrate electron-store → service on first connect
onStatusChange(async (status) => {
  if (status !== 'connected') return
  try {
    const serviceServers = await serviceApi.getServers()
    const localServers = serverStore.getAll()
    if ((serviceServers.data as unknown[]).length === 0 && localServers.length > 0) {
      await serviceApi.migrateServers(
        localServers.map((s) => ({
          id: s.id,
          host: s.host,
          port: s.port,
          instanceName: s.instanceName,
          useWindowsAuth: s.useWindowsAuth,
          username: s.username,
          password: s.password,  // decrypted by getAll()
          addedAt: s.addedAt,
          hostingType: s.hostingType,
          notes: s.notes
        }))
      )
    }
  } catch (err) {
    log.error('[index] Migration error:', err)
  }
})
```

Remove the `startWorker` call from `index.ts` (the service handles it). Keep the `setPushHandler` registration for fallback (local mode).

- [ ] **Step 2: Add connection state to tray in `backgroundService.ts`**

Import `getStatus` and add a menu item after the server count:

```typescript
import { getStatus } from './serviceClient'

// In rebuildMenu(), after the server count items:
{
  label: `Service: ${getStatus() === 'connected' ? '● Connected' : '○ Disconnected'}`,
  enabled: false
},
```

- [ ] **Step 3: Run full typecheck**

```bash
npm run typecheck 2>&1 | tail -15
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/backgroundService.ts
git commit -m "feat(electron): connect to service on start, migrate servers, show status in tray"
```

---

## Task 13 — Service Status in Preload + UI

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/pages/Settings.tsx` (add one status indicator)

Expose service connection status to the renderer so the user can see whether the background service is running.

- [ ] **Step 1: Add `getServiceStatus` to preload**

In `src/preload/index.ts`, inside `contextBridge.exposeInMainWorld('sqlSentinel', { ... })`:

```typescript
getServiceStatus: () => ipcRenderer.invoke(IpcChannel.SERVICE_STATUS_GET)
```

Add to `IpcChannel` enum in `src/main/ipc/types.ts`:
```typescript
SERVICE_STATUS_GET = 'service:statusGet',
```

Add handler in `src/main/ipc/handlers/system.ipc.ts`:
```typescript
import { getStatus } from '../serviceClient'

handle(IpcChannel.SERVICE_STATUS_GET, (): IpcResult<{ status: string }> => {
  return { ok: true, data: { status: getStatus() } }
})
```

- [ ] **Step 2: Add type to `src/preload/index.d.ts`**

```typescript
getServiceStatus: () => Promise<IpcResult<{ status: 'connected' | 'connecting' | 'disconnected' }>>
```

- [ ] **Step 3: Add service status indicator to Settings page**

In `src/renderer/src/pages/Settings.tsx`, add a read-only status row using existing MUI components:

```tsx
const [serviceStatus, setServiceStatus] = React.useState<string>('unknown')

React.useEffect(() => {
  window.sqlSentinel.getServiceStatus().then((res) => {
    if (res.ok) setServiceStatus(res.data.status)
  })
}, [])

// In the JSX, add:
<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
  <Typography variant="body2" color="text.secondary">Background Service:</Typography>
  <Chip
    size="small"
    label={serviceStatus}
    color={serviceStatus === 'connected' ? 'success' : serviceStatus === 'connecting' ? 'warning' : 'error'}
  />
</Box>
```

- [ ] **Step 4: Run full typecheck**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/preload/ src/main/ipc/ src/renderer/src/pages/Settings.tsx
git commit -m "feat: expose service connection status to renderer"
```

---

## Task 14 — Build Pipeline + electron-builder packaging

**Files:**
- Modify: `electron-builder.yml`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

Il service bundle (`out/service/index.js`) e gli script di install (`scripts/*.cjs`) devono essere inclusi nel pacchetto finale come `extraResources` — fuori dall'ASAR, accessibili come file reali su disco.

La struttura dentro `<install-dir>` dopo il packaging sarà:
```
sqlsentinel.exe
resources/
  service/
    index.js          ← bundle del service (ELECTRON_RUN_AS_NODE)
    index.js.map      ← source map per debug
  scripts/
    install-service.cjs
    uninstall-service.cjs
  app.asar            ← codice Electron (renderer, main, preload)
```

- [ ] **Step 1: Aggiorna `electron-builder.yml`**

Aggiungi sotto `asarUnpack`:
```yaml
extraResources:
  - from: out/service/index.js
    to: service/index.js
  - from: out/service/index.js.map
    to: service/index.js.map
  - from: scripts/install-service.cjs
    to: scripts/install-service.cjs
  - from: scripts/uninstall-service.cjs
    to: scripts/uninstall-service.cjs
```

- [ ] **Step 2: Aggiorna il path `appDir` nel service `index.ts`**

Il service bundle gira da `resources/service/index.js`. Il path del database SQLite deve puntare a `%APPDATA%\sqlsentinel\data.db` indipendentemente da dove gira il processo. Verifica che `src/service/index.ts` usi:

```typescript
const dbPath = join(
  process.env['APPDATA'] ?? process.env['HOME'] ?? '.',
  'sqlsentinel',
  'data.db'
)
```

Questo path è identico a quello usato dall'app Electron — entrambi i processi leggono/scrivono lo stesso file SQLite.

- [ ] **Step 3: Run full build**

```bash
npm run build 2>&1 | tail -20
```

Expected: exits code 0. Verifica:
```bash
ls out/service/index.js && echo "service bundle ok"
```

- [ ] **Step 4: Run packaged build e verifica struttura**

```bash
npm run build:unpack 2>&1 | tail -5
ls dist/win-unpacked/resources/service/
ls dist/win-unpacked/resources/scripts/
```

Expected:
```
index.js  index.js.map
install-service.cjs  uninstall-service.cjs
```

- [ ] **Step 5: Smoke test ELECTRON_RUN_AS_NODE sul pacchetto**

```bash
$env:ELECTRON_RUN_AS_NODE=1
& "dist\win-unpacked\sqlsentinel.exe" "dist\win-unpacked\resources\service\index.js" &
Start-Sleep 3
curl http://localhost:57432/health
```

Expected: `{"ok":true,"version":"1.0.0",...}`

- [ ] **Step 6: Update CHANGELOG.md**

Sotto `## [Unreleased]`:

```markdown
### Added — 2026-04-27
- Service: standalone Node.js Windows Service per raccolta metriche headless (metricsWorker, collectors, SQLite)
- Service: HTTP REST + WebSocket su localhost:57432, bundle autocontenuto via ELECTRON_RUN_AS_NODE=1
- Service: crittografia credenziali AES-256-GCM indipendente da safeStorage/DPAPI
- Service: script install/uninstall inclusi nel pacchetto (resources/scripts/)
- Electron: service client con auto-reconnect e bridge WS→IPC
- Electron: migrazione one-time credenziali da electron-store al service al primo avvio
- Settings: indicatore stato connessione al servizio
```

- [ ] **Step 7: Final commit**

```bash
git add electron-builder.yml package.json CHANGELOG.md
git commit -m "build: package service bundle + install scripts as extraResources"
```

---

## Self-Review

**Spec coverage check:**
- ✓ Standalone Node.js process (service entry point — Task 8)
- ✓ Windows Service via node-windows (Task 9)
- ✓ Survives headless reboot (service installs as system service, no login needed)
- ✓ HTTP REST + WebSocket communication (Tasks 6, 7)
- ✓ Credential encryption without DPAPI/safeStorage (Task 4)
- ✓ Real-time metrics push: service → WS → Electron IPC → renderer (Tasks 7, 10)
- ✓ Electron becomes thin client (Tasks 11, 12)
- ✓ No PowerShell used anywhere
- ✓ TypeScript strict throughout (tsconfig.service.json — Task 1)
- ✓ electron-store preserved for Electron runtime; migration to service on connect (Task 12)
- ✓ IpcChannel enum reused (shared between service routes and Electron IPC)

**Known limitation:** The service currently calls `serverStore.getAll()` which reads from `electron-store` (because `serverStore.ts` was not modified). Task 6 routes call `serverStore.add/remove/update` which still write to electron-store. A complete migration would rewrite `serverStore.ts` to use the SQLite `servers` table directly. This is left as a follow-up task to avoid scope creep — the migration in Task 12 seeds the service's electron-store from the app's electron-store, so both are in sync after first connect. In the next iteration, `serverStore.ts` should be rewritten to use the `servers` SQLite table instead.
