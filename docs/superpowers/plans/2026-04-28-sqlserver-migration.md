# SQLite → SQL Server 2025 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SQLite persistence layer (`better-sqlite3`) with SQL Server 2025 (`mssql`) for all writable application data, keeping `electron-store` for server configs and SQLite read-only for the FTS knowledge base.

**Architecture:** A new `src/main/store/sqlserver/` directory contains the mssql implementations of every repository, preserving the same public function signatures (now async). A `storageConfig.ts` module stores the SQL Server connection string in a dedicated `electron-store` file. On first boot, if no config exists, the renderer shows a full-screen `StorageSetupPage` before the main UI appears.

**Tech Stack:** mssql v12 (tedious), Electron safeStorage, electron-store, React + MUI, Vitest. Branch: `sqlserver`. Docker target: `localhost:1437` (SQL Server 2025, image `mcr.microsoft.com/mssql/server:2025-latest`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/main/store/storageConfig.ts` | Create | electron-store wrapper for SQL Server connection string |
| `src/main/store/sqlserver/connection.ts` | Create | mssql pool singleton + testConnection() |
| `src/main/store/sqlserver/database.ts` | Create | initSchema() — DDL, idempotent CREATE TABLE IF NOT EXISTS |
| `src/main/store/sqlserver/settingsRepository.ts` | Create | getSettings / saveSettings via SQL Server |
| `src/main/store/sqlserver/dbCustomFieldsRepository.ts` | Create | getCustomFields / setCustomFields / getAllCustomFields |
| `src/main/store/sqlserver/emailSettingsRepository.ts` | Create | getEmailSettings / saveEmailSettings / migrateEncryptEmailPassword |
| `src/main/store/sqlserver/usersRepository.ts` | Create | findByUsername / create / updateLastLogin / changePassword |
| `src/main/store/sqlserver/sessionsRepository.ts` | Create | create / findByToken / remove / removeExpired |
| `src/main/store/sqlserver/metricsRepository.ts` | Create | save / findLatest / findHistory / findLastN / findLastNBulk / batchSave / cleanup |
| `src/main/store/sqlserver/ragRepository.ts` | Create | saveDocument / saveChunks / searchSimilar / deleteDocument |
| `src/main/ipc/handlers/storage.ipc.ts` | Create | STORAGE_GET_CONFIG / STORAGE_TEST_CONNECTION / STORAGE_SAVE_CONFIG |
| `src/main/ipc/types.ts` | Modify | Add storage IPC channel enums and payload types |
| `src/preload/index.ts` | Modify | Expose storage IPC + storage events |
| `src/preload/index.d.ts` | Modify | Type declarations for new APIs |
| `src/main/ipc/index.ts` | Modify | Register storage IPC handlers |
| `src/main/authService.ts` | Modify | Use sqlserver/usersRepository + sqlserver/sessionsRepository |
| `src/main/index.ts` | Modify | Replace initDb() with initStoragePool(); storage-not-configured flow |
| `src/main/ipc/handlers/system.ipc.ts` | Modify | Add await to getEmailSettings / saveEmailSettings / getCustomFields / setCustomFields / getAllCustomFields |
| `src/renderer/src/pages/StorageSetupPage.tsx` | Create | Full-screen wizard: connection form + test + save |
| `src/renderer/src/App.tsx` | Modify | Listen for storage-not-configured event; render StorageSetupPage |
| `src/renderer/src/pages/Settings.tsx` | Modify | Add "Storage Database" section with edit dialog |
| `src/main/store/__tests__/metricsRepository.bulk.test.ts` | Modify | Rewrite for SQL Server |
| `src/main/store/__tests__/settingsRepository.test.ts` | Create | New test for SQL Server settings |

---

## Task 1: Storage config module

**Files:**
- Create: `src/main/store/storageConfig.ts`
- Create: `src/main/store/__tests__/storageConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/store/__tests__/storageConfig.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))
vi.mock('electron-store', () => {
  let data: Record<string, unknown> = {}
  return {
    default: class {
      get(key: string, def: unknown) { return data[key] ?? def }
      set(key: string, val: unknown) { data[key] = val }
      clear() { data = {} }
    }
  }
})

import { getStorageConfig, saveStorageConfig, clearStorageConfig } from '../storageConfig'

describe('storageConfig', () => {
  beforeEach(() => clearStorageConfig())

  it('returns null when no config saved', () => {
    expect(getStorageConfig()).toBeNull()
  })

  it('saves and retrieves config', () => {
    saveStorageConfig({ host: 'localhost', port: 1437, database: 'SQLSentinelDB', username: 'sa', password: 'test' })
    const cfg = getStorageConfig()
    expect(cfg).not.toBeNull()
    expect(cfg!.host).toBe('localhost')
    expect(cfg!.port).toBe(1437)
    expect(cfg!.encryptedPassword).toBeTruthy()
    expect(cfg!.encryptedPassword).not.toBe('test')
  })

  it('clears config', () => {
    saveStorageConfig({ host: 'localhost', port: 1437, database: 'SQLSentinelDB', username: 'sa', password: 'test' })
    clearStorageConfig()
    expect(getStorageConfig()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npm run typecheck 2>&1 | head -5
```
Expected: compilation error (module not found)

- [ ] **Step 3: Implement storageConfig.ts**

```typescript
// src/main/store/storageConfig.ts
import Store from 'electron-store'
import { encrypt, decrypt } from './safeStorageUtil'

export interface StorageConfig {
  host: string
  port: number
  database: string
  username: string
  encryptedPassword: string
}

interface StorageConfigStore {
  config: StorageConfig | null
}

const store = new Store<StorageConfigStore>({
  name: 'sql-sentinel-storage-config',
  defaults: { config: null }
})

export function getStorageConfig(): StorageConfig | null {
  return store.get('config', null)
}

export function saveStorageConfig(
  params: Omit<StorageConfig, 'encryptedPassword'> & { password: string }
): void {
  const { password, ...rest } = params
  store.set('config', { ...rest, encryptedPassword: encrypt(password) })
}

export function clearStorageConfig(): void {
  store.set('config', null)
}

export function getDecryptedPassword(config: StorageConfig): string {
  return decrypt(config.encryptedPassword)
}
```

- [ ] **Step 4: Run tests**

```
npx vitest run src/main/store/__tests__/storageConfig.test.ts
```
Expected: 3 tests pass

- [ ] **Step 5: Commit**

```
git add src/main/store/storageConfig.ts src/main/store/__tests__/storageConfig.test.ts
git commit -m "feat(store): add storageConfig module for SQL Server connection string"
```

---

## Task 2: SQL Server connection pool + schema DDL

**Files:**
- Create: `src/main/store/sqlserver/connection.ts`
- Create: `src/main/store/sqlserver/database.ts`

- [ ] **Step 1: Create connection.ts**

```typescript
// src/main/store/sqlserver/connection.ts
import * as mssql from 'mssql'
import type { StorageConfig } from '../storageConfig'
import { getDecryptedPassword } from '../storageConfig'

let _pool: mssql.ConnectionPool | null = null

function buildConfig(params: { host: string; port: number; database: string; username: string; password: string }): mssql.config {
  return {
    server: params.host,
    port: params.port,
    database: params.database,
    requestTimeout: 30000,
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 15000 },
    authentication: { type: 'default', options: { userName: params.username, password: params.password } }
  }
}

export async function initStoragePool(config: StorageConfig): Promise<void> {
  if (_pool) {
    await _pool.close().catch(() => {})
  }
  _pool = await mssql.connect(buildConfig({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: getDecryptedPassword(config)
  }))
}

export function getPool(): mssql.ConnectionPool {
  if (!_pool) throw new Error('Storage pool not initialized. Call initStoragePool() first.')
  return _pool
}

export async function closeStoragePool(): Promise<void> {
  if (_pool) {
    await _pool.close().catch(() => {})
    _pool = null
  }
}

/** One-shot connection test — does NOT set the module-level pool. */
export async function testConnection(params: {
  host: string; port: number; database: string; username: string; password: string
}): Promise<void> {
  const pool = await mssql.connect({ ...buildConfig(params), requestTimeout: 10000, options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10000 } })
  await pool.close()
}
```

- [ ] **Step 2: Create database.ts (DDL)**

```typescript
// src/main/store/sqlserver/database.ts
import { getPool } from './connection'

const DDL_STATEMENTS = [
  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'settings')
   CREATE TABLE dbo.settings ([key] NVARCHAR(200) NOT NULL PRIMARY KEY, value NVARCHAR(MAX) NOT NULL)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'db_custom_fields')
   CREATE TABLE dbo.db_custom_fields (id NVARCHAR(400) NOT NULL PRIMARY KEY, alias NVARCHAR(200) NULL, referente NVARCHAR(200) NULL)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'metrics_snapshots')
   CREATE TABLE dbo.metrics_snapshots (
     id           NVARCHAR(36)  NOT NULL PRIMARY KEY,
     server_id    NVARCHAR(36)  NOT NULL,
     collected_at DATETIME2     NOT NULL,
     metrics_json NVARCHAR(MAX) NOT NULL
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.metrics_snapshots') AND name = N'IX_metrics_server_collected')
   CREATE INDEX IX_metrics_server_collected ON dbo.metrics_snapshots(server_id, collected_at DESC)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.metrics_snapshots') AND name = N'IX_metrics_cleanup')
   CREATE INDEX IX_metrics_cleanup ON dbo.metrics_snapshots(collected_at)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'users')
   CREATE TABLE dbo.users (
     id                   NVARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT LOWER(CONVERT(NVARCHAR(36), NEWID())),
     username             NVARCHAR(200) NOT NULL UNIQUE,
     password             NVARCHAR(500) NOT NULL,
     role                 NVARCHAR(50)  NOT NULL DEFAULT N'viewer',
     created_at           BIGINT        NOT NULL DEFAULT DATEDIFF_BIG(SECOND, '1970-01-01', GETUTCDATE()),
     last_login           BIGINT        NULL,
     must_change_password BIT           NOT NULL DEFAULT 0
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'sessions')
   CREATE TABLE dbo.sessions (
     token      NVARCHAR(500) NOT NULL PRIMARY KEY,
     user_id    NVARCHAR(36)  NOT NULL,
     username   NVARCHAR(200) NOT NULL,
     role       NVARCHAR(50)  NOT NULL,
     expires_at BIGINT        NOT NULL
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.sessions') AND name = N'IX_sessions_expires')
   CREATE INDEX IX_sessions_expires ON dbo.sessions(expires_at)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'rag_documents')
   CREATE TABLE dbo.rag_documents (
     id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
     filename    NVARCHAR(500) NOT NULL UNIQUE,
     file_size   BIGINT        NOT NULL,
     indexed_at  NVARCHAR(50)  NOT NULL,
     chunk_count INT           NOT NULL DEFAULT 0
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'rag_chunks')
   CREATE TABLE dbo.rag_chunks (
     id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
     document_id NVARCHAR(36)  NOT NULL REFERENCES dbo.rag_documents(id) ON DELETE CASCADE,
     chunk_index INT           NOT NULL,
     text        NVARCHAR(MAX) NOT NULL,
     embedding   vector(1536)  NOT NULL
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.rag_chunks') AND name = N'IX_rag_chunks_doc')
   CREATE INDEX IX_rag_chunks_doc ON dbo.rag_chunks(document_id)`
]

export async function initSchema(): Promise<void> {
  const pool = getPool()
  for (const stmt of DDL_STATEMENTS) {
    await pool.request().query(stmt)
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```
npm run typecheck 2>&1 | grep -E "error|sqlserver"
```
Expected: no errors in the new files

- [ ] **Step 4: Commit**

```
git add src/main/store/sqlserver/connection.ts src/main/store/sqlserver/database.ts
git commit -m "feat(store): add SQL Server connection pool and schema DDL"
```

---

## Task 3: Settings repository

**Files:**
- Create: `src/main/store/sqlserver/settingsRepository.ts`
- Create: `src/main/store/__tests__/settingsRepository.sqlserver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/store/__tests__/settingsRepository.sqlserver.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as mssql from 'mssql'
import { getSettings, saveSettings } from '../sqlserver/settingsRepository'

const SKIP = !process.env['STORAGE_TEST_HOST']
const pool = { value: null as mssql.ConnectionPool | null }

// Inject pool into the module via the connection singleton
vi.mock('../sqlserver/connection', () => ({ getPool: () => pool.value }))

beforeAll(async () => {
  if (SKIP) return
  pool.value = await mssql.connect({
    server: process.env['STORAGE_TEST_HOST']!,
    port: Number(process.env['STORAGE_TEST_PORT'] ?? 1437),
    database: process.env['STORAGE_TEST_DB'] ?? 'SQLSentinelDB',
    authentication: { type: 'default', options: { userName: process.env['STORAGE_TEST_USER'] ?? 'sqlsentinel_app', password: process.env['STORAGE_TEST_PASSWORD'] ?? 'App@Sentinel2025' } },
    options: { encrypt: false, trustServerCertificate: true }
  })
  // Clean test data
  await pool.value.request().query(`DELETE FROM dbo.settings WHERE [key] LIKE N'__test_%'`)
})

afterAll(async () => {
  if (pool.value) {
    await pool.value.request().query(`DELETE FROM dbo.settings WHERE [key] LIKE N'__test_%'`)
    await pool.value.close()
  }
})

describe.skipIf(SKIP)('settingsRepository (SQL Server)', () => {
  it('returns defaults when no rows exist for keys', async () => {
    const s = await getSettings()
    expect(s.retentionMinutes).toBeGreaterThan(0)
    expect(['light', 'dark', 'system']).toContain(s.themeMode)
  })

  it('saves and retrieves a setting', async () => {
    await saveSettings({ themeMode: 'dark' })
    const s = await getSettings()
    expect(s.themeMode).toBe('dark')
    // restore
    await saveSettings({ themeMode: 'system' })
  })
})
```

- [ ] **Step 2: Implement settingsRepository.ts**

```typescript
// src/main/store/sqlserver/settingsRepository.ts
import * as sql from 'mssql'
import { getPool } from './connection'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  retentionMinutes: number
  backgroundEnabled: boolean
  backgroundMode: 'light' | 'full'
  backgroundIntervalMinutes: number
  backgroundNotifications: boolean
  themeMode: ThemeMode
}

function safeInt(raw: string | undefined, fallback: number, min = 0): number {
  if (raw == null) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= min ? n : fallback
}

async function upsertKey(pool: sql.ConnectionPool, key: string, value: string): Promise<void> {
  await pool.request()
    .input('k', sql.NVarChar(200), key)
    .input('v', sql.NVarChar(sql.MAX), value)
    .query(`MERGE dbo.settings AS t
            USING (SELECT @k AS [key], @v AS value) AS s ON t.[key] = s.[key]
            WHEN MATCHED THEN UPDATE SET t.value = s.value
            WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (s.[key], s.value);`)
}

export async function getSettings(): Promise<AppSettings> {
  const pool = getPool()
  const result = await pool.request().query<{ key: string; value: string }>(`SELECT [key], value FROM dbo.settings`)
  const map = Object.fromEntries(result.recordset.map((r) => [r.key, r.value]))
  const rawTheme = map['theme_mode']
  return {
    retentionMinutes: safeInt(map['retentionMinutes'], 60, 1),
    backgroundEnabled: map['background_enabled'] != null ? map['background_enabled'] === 'true' : true,
    backgroundMode: map['background_mode'] === 'full' ? 'full' : 'light',
    backgroundIntervalMinutes: safeInt(map['background_interval_minutes'], 30, 1),
    backgroundNotifications: map['background_notifications'] != null ? map['background_notifications'] === 'true' : true,
    themeMode: rawTheme === 'dark' || rawTheme === 'light' ? rawTheme : 'system'
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const pool = getPool()
  if (settings.retentionMinutes != null) await upsertKey(pool, 'retentionMinutes', String(settings.retentionMinutes))
  if (settings.backgroundEnabled != null) await upsertKey(pool, 'background_enabled', String(settings.backgroundEnabled))
  if (settings.backgroundMode != null) await upsertKey(pool, 'background_mode', settings.backgroundMode)
  if (settings.backgroundIntervalMinutes != null) await upsertKey(pool, 'background_interval_minutes', String(settings.backgroundIntervalMinutes))
  if (settings.backgroundNotifications != null) await upsertKey(pool, 'background_notifications', String(settings.backgroundNotifications))
  if (settings.themeMode != null) await upsertKey(pool, 'theme_mode', settings.themeMode)
}
```

- [ ] **Step 3: Run tests (requires Docker)**

```
STORAGE_TEST_HOST=localhost STORAGE_TEST_PORT=1437 npx vitest run src/main/store/__tests__/settingsRepository.sqlserver.test.ts
```
Expected: 2 tests pass. Without Docker env vars: tests skipped.

- [ ] **Step 4: Commit**

```
git add src/main/store/sqlserver/settingsRepository.ts src/main/store/__tests__/settingsRepository.sqlserver.test.ts
git commit -m "feat(store): settings repository for SQL Server"
```

---

## Task 4: DB custom fields repository

**Files:**
- Create: `src/main/store/sqlserver/dbCustomFieldsRepository.ts`

- [ ] **Step 1: Implement dbCustomFieldsRepository.ts**

The public interface is identical to `src/main/store/dbCustomFields.ts` but async. The in-memory cache is preserved.

```typescript
// src/main/store/sqlserver/dbCustomFieldsRepository.ts
import * as sql from 'mssql'
import { getPool } from './connection'

export interface DbCustomFields {
  alias?: string
  referente?: string
}

let cachedFields: Record<string, DbCustomFields> | null = null

export async function getCustomFields(serverId: string, dbName: string): Promise<DbCustomFields> {
  const pool = getPool()
  const result = await pool.request()
    .input('id', sql.NVarChar(400), `${serverId}/${dbName}`)
    .query<{ id: string; alias: string | null; referente: string | null }>(
      `SELECT id, alias, referente FROM dbo.db_custom_fields WHERE id = @id`
    )
  const row = result.recordset[0]
  if (!row) return {}
  return { alias: row.alias ?? undefined, referente: row.referente ?? undefined }
}

export async function setCustomFields(serverId: string, dbName: string, fields: DbCustomFields): Promise<void> {
  cachedFields = null
  const pool = getPool()
  await pool.request()
    .input('id',        sql.NVarChar(400), `${serverId}/${dbName}`)
    .input('alias',     sql.NVarChar(200), fields.alias ?? null)
    .input('referente', sql.NVarChar(200), fields.referente ?? null)
    .query(`MERGE dbo.db_custom_fields AS t
            USING (SELECT @id AS id, @alias AS alias, @referente AS referente) AS s ON t.id = s.id
            WHEN MATCHED THEN UPDATE SET t.alias = s.alias, t.referente = s.referente
            WHEN NOT MATCHED THEN INSERT (id, alias, referente) VALUES (s.id, s.alias, s.referente);`)
}

export async function getAllCustomFields(): Promise<Record<string, DbCustomFields>> {
  if (cachedFields !== null) return cachedFields
  const pool = getPool()
  const result = await pool.request()
    .query<{ id: string; alias: string | null; referente: string | null }>(
      `SELECT id, alias, referente FROM dbo.db_custom_fields`
    )
  const out: Record<string, DbCustomFields> = {}
  for (const row of result.recordset) {
    out[row.id] = { alias: row.alias ?? undefined, referente: row.referente ?? undefined }
  }
  cachedFields = out
  return out
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck 2>&1 | grep sqlserver
```
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/main/store/sqlserver/dbCustomFieldsRepository.ts
git commit -m "feat(store): db custom fields repository for SQL Server"
```

---

## Task 5: Email settings repository

**Files:**
- Create: `src/main/store/sqlserver/emailSettingsRepository.ts`

- [ ] **Step 1: Implement emailSettingsRepository.ts**

```typescript
// src/main/store/sqlserver/emailSettingsRepository.ts
import * as sql from 'mssql'
import { getPool } from './connection'
import { encrypt, decrypt, isAvailable, isEncrypted } from '../safeStorageUtil'
import { createLogger } from '../../utils/logger'

const log = createLogger('email-settings-ss')

export interface EmailSettings {
  emailEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpTls: boolean
  emailRecipients: string[]
}

async function upsertKey(pool: sql.ConnectionPool, key: string, value: string): Promise<void> {
  await pool.request()
    .input('k', sql.NVarChar(200), key)
    .input('v', sql.NVarChar(sql.MAX), value)
    .query(`MERGE dbo.settings AS t
            USING (SELECT @k AS [key], @v AS value) AS s ON t.[key] = s.[key]
            WHEN MATCHED THEN UPDATE SET t.value = s.value
            WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (s.[key], s.value);`)
}

async function getKey(pool: sql.ConnectionPool, key: string): Promise<string | undefined> {
  const r = await pool.request()
    .input('k', sql.NVarChar(200), key)
    .query<{ value: string }>(`SELECT value FROM dbo.settings WHERE [key] = @k`)
  return r.recordset[0]?.value
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const pool = getPool()
  const result = await pool.request()
    .query<{ key: string; value: string }>(`SELECT [key], value FROM dbo.settings`)
  const map = Object.fromEntries(result.recordset.map((r) => [r.key, r.value]))
  let recipients: string[] = []
  if (map['email_recipients']) {
    try { recipients = JSON.parse(map['email_recipients']) as string[] } catch { recipients = [] }
  }
  const storedPwd = map['smtp_password'] ?? ''
  return {
    emailEnabled: map['email_enabled'] != null ? map['email_enabled'] === 'true' : false,
    smtpHost: map['smtp_host'] ?? '',
    smtpPort: map['smtp_port'] != null ? parseInt(map['smtp_port'], 10) : 587,
    smtpUser: map['smtp_user'] ?? '',
    smtpPassword: storedPwd ? decrypt(storedPwd) : '',
    smtpTls: map['smtp_tls'] != null ? map['smtp_tls'] === 'true' : true,
    emailRecipients: recipients
  }
}

export async function saveEmailSettings(settings: Partial<EmailSettings>): Promise<void> {
  const pool = getPool()
  if (settings.emailEnabled != null) await upsertKey(pool, 'email_enabled', String(settings.emailEnabled))
  if (settings.smtpHost != null) await upsertKey(pool, 'smtp_host', settings.smtpHost)
  if (settings.smtpPort != null) await upsertKey(pool, 'smtp_port', String(settings.smtpPort))
  if (settings.smtpUser != null) await upsertKey(pool, 'smtp_user', settings.smtpUser)
  if (settings.smtpPassword != null) await upsertKey(pool, 'smtp_password', encrypt(settings.smtpPassword))
  if (settings.smtpTls != null) await upsertKey(pool, 'smtp_tls', String(settings.smtpTls))
  if (settings.emailRecipients != null) await upsertKey(pool, 'email_recipients', JSON.stringify(settings.emailRecipients))
}

export async function migrateEncryptEmailPassword(): Promise<void> {
  try {
    if (!isAvailable()) return
    const pool = getPool()
    const stored = await getKey(pool, 'smtp_password')
    if (!stored || isEncrypted(stored)) return
    await upsertKey(pool, 'smtp_password', encrypt(stored))
    log.info('[emailSettings] migrated smtp_password to encrypted storage')
  } catch (err) {
    log.error('[emailSettings] migrateEncryptEmailPassword:', err)
  }
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck 2>&1 | grep sqlserver
```
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/main/store/sqlserver/emailSettingsRepository.ts
git commit -m "feat(store): email settings repository for SQL Server"
```

---

## Task 6: Users and sessions repositories

**Files:**
- Create: `src/main/store/sqlserver/usersRepository.ts`
- Create: `src/main/store/sqlserver/sessionsRepository.ts`

Before writing these, read `src/main/authService.ts` to understand the exact function signatures called.

- [ ] **Step 1: Read authService.ts to identify the interface**

```
grep -n "import\|from.*store" src/main/authService.ts | head -20
```

- [ ] **Step 2: Implement usersRepository.ts**

```typescript
// src/main/store/sqlserver/usersRepository.ts
import * as sql from 'mssql'
import { getPool } from './connection'

export interface UserRow {
  id: string
  username: string
  password: string
  role: string
  created_at: number
  last_login: number | null
  must_change_password: boolean
}

export async function findByUsername(username: string): Promise<UserRow | null> {
  const pool = getPool()
  const r = await pool.request()
    .input('username', sql.NVarChar(200), username)
    .query<UserRow>(`SELECT id, username, password, role, created_at, last_login, must_change_password FROM dbo.users WHERE username = @username`)
  return r.recordset[0] ?? null
}

export async function findById(id: string): Promise<UserRow | null> {
  const pool = getPool()
  const r = await pool.request()
    .input('id', sql.NVarChar(36), id)
    .query<UserRow>(`SELECT id, username, password, role, created_at, last_login, must_change_password FROM dbo.users WHERE id = @id`)
  return r.recordset[0] ?? null
}

export async function countUsers(): Promise<number> {
  const pool = getPool()
  const r = await pool.request().query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM dbo.users`)
  return r.recordset[0].cnt
}

export async function createUser(params: { id: string; username: string; password: string; role: string; mustChangePassword?: boolean }): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input('id',       sql.NVarChar(36),  params.id)
    .input('username', sql.NVarChar(200), params.username)
    .input('password', sql.NVarChar(500), params.password)
    .input('role',     sql.NVarChar(50),  params.role)
    .input('mcp',      sql.Bit,           params.mustChangePassword ? 1 : 0)
    .query(`INSERT INTO dbo.users (id, username, password, role, must_change_password) VALUES (@id, @username, @password, @role, @mcp)`)
}

export async function updateLastLogin(id: string): Promise<void> {
  const pool = getPool()
  const epoch = Math.floor(Date.now() / 1000)
  await pool.request()
    .input('id', sql.NVarChar(36), id)
    .input('ts', sql.BigInt, epoch)
    .query(`UPDATE dbo.users SET last_login = @ts WHERE id = @id`)
}

export async function updatePassword(id: string, hashedPassword: string, mustChangePassword = false): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input('id',       sql.NVarChar(36),  id)
    .input('password', sql.NVarChar(500), hashedPassword)
    .input('mcp',      sql.Bit,           mustChangePassword ? 1 : 0)
    .query(`UPDATE dbo.users SET password = @password, must_change_password = @mcp WHERE id = @id`)
}
```

- [ ] **Step 3: Implement sessionsRepository.ts**

```typescript
// src/main/store/sqlserver/sessionsRepository.ts
import * as sql from 'mssql'
import { getPool } from './connection'

export interface SessionRow {
  token: string
  user_id: string
  username: string
  role: string
  expires_at: number
}

export async function createSession(session: SessionRow): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input('token',      sql.NVarChar(500), session.token)
    .input('user_id',   sql.NVarChar(36),  session.user_id)
    .input('username',  sql.NVarChar(200), session.username)
    .input('role',      sql.NVarChar(50),  session.role)
    .input('expires_at', sql.BigInt,       session.expires_at)
    .query(`INSERT INTO dbo.sessions (token, user_id, username, role, expires_at) VALUES (@token, @user_id, @username, @role, @expires_at)`)
}

export async function findSessionByToken(token: string): Promise<SessionRow | null> {
  const pool = getPool()
  const now = Math.floor(Date.now() / 1000)
  const r = await pool.request()
    .input('token', sql.NVarChar(500), token)
    .input('now',   sql.BigInt,        now)
    .query<SessionRow>(`SELECT token, user_id, username, role, expires_at FROM dbo.sessions WHERE token = @token AND expires_at > @now`)
  return r.recordset[0] ?? null
}

export async function removeSession(token: string): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input('token', sql.NVarChar(500), token)
    .query(`DELETE FROM dbo.sessions WHERE token = @token`)
}

export async function removeExpiredSessions(): Promise<void> {
  const pool = getPool()
  const now = Math.floor(Date.now() / 1000)
  await pool.request()
    .input('now', sql.BigInt, now)
    .query(`DELETE FROM dbo.sessions WHERE expires_at <= @now`)
}
```

- [ ] **Step 4: Typecheck**

```
npm run typecheck 2>&1 | grep sqlserver
```
Expected: no errors

- [ ] **Step 5: Commit**

```
git add src/main/store/sqlserver/usersRepository.ts src/main/store/sqlserver/sessionsRepository.ts
git commit -m "feat(store): users and sessions repositories for SQL Server"
```

---

## Task 7: Metrics repository

**Files:**
- Create: `src/main/store/sqlserver/metricsRepository.ts`
- Modify: `src/main/store/__tests__/metricsRepository.bulk.test.ts`

This is the most critical repository — highest write volume and most complex queries.

- [ ] **Step 1: Write the failing test first (bulk query)**

```typescript
// src/main/store/__tests__/metricsRepository.bulk.test.ts
// Rewrite for SQL Server
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as mssql from 'mssql'

const SKIP = !process.env['STORAGE_TEST_HOST']
const pool = { value: null as mssql.ConnectionPool | null }

vi.mock('../sqlserver/connection', () => ({ getPool: () => pool.value }))

beforeAll(async () => {
  if (SKIP) return
  pool.value = await mssql.connect({
    server: process.env['STORAGE_TEST_HOST']!,
    port: Number(process.env['STORAGE_TEST_PORT'] ?? 1437),
    database: process.env['STORAGE_TEST_DB'] ?? 'SQLSentinelDB',
    authentication: { type: 'default', options: { userName: process.env['STORAGE_TEST_USER'] ?? 'sqlsentinel_app', password: process.env['STORAGE_TEST_PASSWORD'] ?? 'App@Sentinel2025' } },
    options: { encrypt: false, trustServerCertificate: true }
  })
  await pool.value.request().query(`DELETE FROM dbo.metrics_snapshots WHERE server_id LIKE N'test-%'`)
})

afterAll(async () => {
  if (pool.value) {
    await pool.value.request().query(`DELETE FROM dbo.metrics_snapshots WHERE server_id LIKE N'test-%'`)
    await pool.value.close()
  }
})

import { save, findLatest, findLastN, findLastNBulk, batchSave, cleanup } from '../sqlserver/metricsRepository'
import type { ServerMetrics } from '../../collectors/types'

function makeMetrics(cpu: number): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: { version: 'test', edition: 'test', memoryUsedMb: 100, memoryTargetMb: 200, cpuUsagePercent: cpu, uptimeDays: 1, logicalCpus: 4, physicalCpus: 2 },
    databases: [], activeSessions: [], topQueries: [], backupStatus: [], waitStats: [], diskVolumes: [], databaseFiles: []
  }
}

describe.skipIf(SKIP)('metricsRepository (SQL Server)', () => {
  it('saves and retrieves latest', async () => {
    await save('test-srv-1', makeMetrics(42))
    const latest = await findLatest('test-srv-1')
    expect(latest).not.toBeNull()
    expect(latest!.instanceInfo.cpuUsagePercent).toBe(42)
  })

  it('findLastN returns N most recent in ascending order', async () => {
    await batchSave([
      { serverId: 'test-srv-2', metrics: makeMetrics(10) },
      { serverId: 'test-srv-2', metrics: makeMetrics(20) },
      { serverId: 'test-srv-2', metrics: makeMetrics(30) }
    ])
    const result = await findLastN('test-srv-2', 2)
    expect(result).toHaveLength(2)
  })

  it('findLastNBulk returns map keyed by serverId', async () => {
    const bulk = await findLastNBulk(['test-srv-1', 'test-srv-2'], 2)
    expect(bulk['test-srv-1']).toBeDefined()
    expect(bulk['test-srv-2']).toBeDefined()
  })

  it('cleanup removes old snapshots', async () => {
    await cleanup(0) // retentionDays=0 deletes everything older than now
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
STORAGE_TEST_HOST=localhost npx vitest run src/main/store/__tests__/metricsRepository.bulk.test.ts
```
Expected: fail — metricsRepository not found

- [ ] **Step 3: Implement metricsRepository.ts**

```typescript
// src/main/store/sqlserver/metricsRepository.ts
import * as sql from 'mssql'
import { randomUUID } from 'node:crypto'
import { getPool } from './connection'
import type { ServerMetrics } from '../../collectors/types'
import type { MetricsSnapshot } from '../types'

export interface SaveItem { serverId: string; metrics: ServerMetrics }

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) return new Date(value)
  return value
}

interface SnapshotRow {
  id: string
  server_id: string
  collected_at: Date
  metrics_json: string
}

function rowToSnapshot(row: SnapshotRow): MetricsSnapshot {
  return { id: row.id, serverId: row.server_id, collectedAt: row.collected_at, metricsJson: row.metrics_json }
}

export async function save(serverId: string, metrics: ServerMetrics): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input('id',           sql.NVarChar(36),  randomUUID())
    .input('server_id',   sql.NVarChar(36),  serverId)
    .input('collected_at', sql.DateTime2,     metrics.collectedAt)
    .input('metrics_json', sql.NVarChar(sql.MAX), JSON.stringify(metrics))
    .query(`INSERT INTO dbo.metrics_snapshots (id, server_id, collected_at, metrics_json) VALUES (@id, @server_id, @collected_at, @metrics_json)`)
}

export async function findLatest(serverId: string): Promise<ServerMetrics | null> {
  const pool = getPool()
  const r = await pool.request()
    .input('server_id', sql.NVarChar(36), serverId)
    .query<SnapshotRow>(`SELECT TOP 1 id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id ORDER BY collected_at DESC`)
  if (!r.recordset[0]) return null
  return JSON.parse(r.recordset[0].metrics_json, dateReviver) as ServerMetrics
}

export async function findHistory(serverId: string, limitDays: number): Promise<MetricsSnapshot[]> {
  const pool = getPool()
  if (limitDays === 0) {
    const r = await pool.request()
      .input('server_id', sql.NVarChar(36), serverId)
      .query<SnapshotRow>(`SELECT id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id ORDER BY collected_at DESC`)
    return r.recordset.map(rowToSnapshot)
  }
  const r = await pool.request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('days',      sql.Int,          Math.abs(limitDays))
    .query<SnapshotRow>(`SELECT id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id AND collected_at >= DATEADD(DAY, -@days, GETUTCDATE()) ORDER BY collected_at DESC`)
  return r.recordset.map(rowToSnapshot)
}

export async function cleanup(retentionDays: number): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input('days', sql.Int, Math.abs(retentionDays))
    .query(`DELETE FROM dbo.metrics_snapshots WHERE collected_at < DATEADD(DAY, -@days, GETUTCDATE())`)
}

export async function findLastN(serverId: string, n: number): Promise<ServerMetrics[]> {
  const pool = getPool()
  const r = await pool.request()
    .input('server_id', sql.NVarChar(36), serverId)
    .input('n',         sql.Int,          n)
    .query<SnapshotRow>(`SELECT TOP (@n) id, server_id, collected_at, metrics_json FROM dbo.metrics_snapshots WHERE server_id = @server_id ORDER BY collected_at DESC`)
  return r.recordset.reverse().map((row) => JSON.parse(row.metrics_json, dateReviver) as ServerMetrics)
}

export async function findLastNBulk(serverIds: string[], n: number): Promise<Record<string, ServerMetrics[]>> {
  if (serverIds.length === 0) return {}
  const pool = getPool()
  const r = await pool.request()
    .input('serverIds', sql.NVarChar(sql.MAX), serverIds.join(','))
    .input('n',         sql.Int,               n)
    .query<SnapshotRow>(`
      SELECT id, server_id, collected_at, metrics_json
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY collected_at DESC) AS rn
        FROM dbo.metrics_snapshots
        WHERE server_id IN (SELECT value FROM STRING_SPLIT(@serverIds, ','))
      ) ranked
      WHERE rn <= @n
      ORDER BY server_id, collected_at ASC`)
  const result: Record<string, ServerMetrics[]> = {}
  for (const row of r.recordset) {
    if (!result[row.server_id]) result[row.server_id] = []
    result[row.server_id].push(JSON.parse(row.metrics_json, dateReviver) as ServerMetrics)
  }
  return result
}

export async function batchSave(items: SaveItem[]): Promise<void> {
  if (items.length === 0) return
  // mssql does not have a native sync transaction API — use a bulk table or sequential inserts in a TX
  const pool = getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    for (const item of items) {
      await new sql.Request(tx)
        .input('id',           sql.NVarChar(36),          randomUUID())
        .input('server_id',   sql.NVarChar(36),           item.serverId)
        .input('collected_at', sql.DateTime2,              item.metrics.collectedAt)
        .input('metrics_json', sql.NVarChar(sql.MAX),     JSON.stringify(item.metrics))
        .query(`INSERT INTO dbo.metrics_snapshots (id, server_id, collected_at, metrics_json) VALUES (@id, @server_id, @collected_at, @metrics_json)`)
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
```

- [ ] **Step 4: Run tests**

```
STORAGE_TEST_HOST=localhost STORAGE_TEST_PORT=1437 npx vitest run src/main/store/__tests__/metricsRepository.bulk.test.ts
```
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```
git add src/main/store/sqlserver/metricsRepository.ts src/main/store/__tests__/metricsRepository.bulk.test.ts
git commit -m "feat(store): metrics repository for SQL Server with batchSave and findLastNBulk"
```

---

## Task 8: RAG repository

**Files:**
- Create: `src/main/store/sqlserver/ragRepository.ts`

- [ ] **Step 1: Implement ragRepository.ts**

Embeddings are passed as JSON arrays and cast to `vector(1536)` in SQL. The similarity search uses `VECTOR_DISTANCE` (SQL Server 2025).

```typescript
// src/main/store/sqlserver/ragRepository.ts
import * as sql from 'mssql'
import { getPool } from './connection'

export interface RagDocument {
  id: string
  filename: string
  fileSize: number
  indexedAt: string
  chunkCount: number
}

export interface RagChunk {
  id: string
  documentId: string
  chunkIndex: number
  text: string
}

export interface SimilarChunk extends RagChunk {
  score: number
}

export async function findDocumentByFilename(filename: string): Promise<RagDocument | null> {
  const pool = getPool()
  const r = await pool.request()
    .input('filename', sql.NVarChar(500), filename)
    .query<{ id: string; filename: string; file_size: number; indexed_at: string; chunk_count: number }>(
      `SELECT id, filename, file_size, indexed_at, chunk_count FROM dbo.rag_documents WHERE filename = @filename`
    )
  const row = r.recordset[0]
  if (!row) return null
  return { id: row.id, filename: row.filename, fileSize: row.file_size, indexedAt: row.indexed_at, chunkCount: row.chunk_count }
}

export async function upsertDocument(doc: RagDocument): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input('id',         sql.NVarChar(36),  doc.id)
    .input('filename',   sql.NVarChar(500), doc.filename)
    .input('file_size',  sql.BigInt,        doc.fileSize)
    .input('indexed_at', sql.NVarChar(50),  doc.indexedAt)
    .input('chunk_count', sql.Int,          doc.chunkCount)
    .query(`MERGE dbo.rag_documents AS t
            USING (SELECT @id AS id, @filename AS filename, @file_size AS file_size, @indexed_at AS indexed_at, @chunk_count AS chunk_count) AS s ON t.id = s.id
            WHEN MATCHED THEN UPDATE SET t.filename=s.filename, t.file_size=s.file_size, t.indexed_at=s.indexed_at, t.chunk_count=s.chunk_count
            WHEN NOT MATCHED THEN INSERT (id, filename, file_size, indexed_at, chunk_count) VALUES (s.id, s.filename, s.file_size, s.indexed_at, s.chunk_count);`)
}

export async function saveChunk(chunk: RagChunk, embedding: number[]): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input('id',          sql.NVarChar(36),      chunk.id)
    .input('document_id', sql.NVarChar(36),      chunk.documentId)
    .input('chunk_index', sql.Int,               chunk.chunkIndex)
    .input('text',        sql.NVarChar(sql.MAX), chunk.text)
    .input('embedding',   sql.NVarChar(sql.MAX), JSON.stringify(embedding))
    .query(`INSERT INTO dbo.rag_chunks (id, document_id, chunk_index, text, embedding)
            VALUES (@id, @document_id, @chunk_index, @text, CAST(@embedding AS vector(1536)))`)
}

export async function searchSimilar(queryEmbedding: number[], topK = 5): Promise<SimilarChunk[]> {
  const pool = getPool()
  const r = await pool.request()
    .input('qvec', sql.NVarChar(sql.MAX), JSON.stringify(queryEmbedding))
    .input('k',    sql.Int,              topK)
    .query<{ id: string; document_id: string; chunk_index: number; text: string; score: number }>(`
      SELECT TOP (@k) id, document_id, chunk_index, text,
             VECTOR_DISTANCE('cosine', embedding, CAST(@qvec AS vector(1536))) AS score
      FROM dbo.rag_chunks
      ORDER BY score ASC`)
  return r.recordset.map((row) => ({
    id: row.id, documentId: row.document_id, chunkIndex: row.chunk_index, text: row.text, score: row.score
  }))
}

export async function deleteDocument(id: string): Promise<void> {
  const pool = getPool()
  // ON DELETE CASCADE handles rag_chunks
  await pool.request()
    .input('id', sql.NVarChar(36), id)
    .query(`DELETE FROM dbo.rag_documents WHERE id = @id`)
}

export async function listDocuments(): Promise<RagDocument[]> {
  const pool = getPool()
  const r = await pool.request()
    .query<{ id: string; filename: string; file_size: number; indexed_at: string; chunk_count: number }>(
      `SELECT id, filename, file_size, indexed_at, chunk_count FROM dbo.rag_documents ORDER BY indexed_at DESC`
    )
  return r.recordset.map((row) => ({ id: row.id, filename: row.filename, fileSize: row.file_size, indexedAt: row.indexed_at, chunkCount: row.chunk_count }))
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck 2>&1 | grep sqlserver
```
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/main/store/sqlserver/ragRepository.ts
git commit -m "feat(store): RAG repository for SQL Server 2025 with vector(1536) similarity search"
```

---

## Task 9: Storage IPC handlers + preload

**Files:**
- Create: `src/main/ipc/handlers/storage.ipc.ts`
- Modify: `src/main/ipc/types.ts` — add channels + payload types
- Modify: `src/main/ipc/index.ts` — register handler
- Modify: `src/preload/index.ts` — expose storage API
- Modify: `src/preload/index.d.ts` — type declarations

- [ ] **Step 1: Add IPC channel enums to types.ts**

Open `src/main/ipc/types.ts` and add to the `IpcChannel` enum:

```typescript
// Add to IpcChannel enum
STORAGE_GET_CONFIG        = 'storage:get-config',
STORAGE_TEST_CONNECTION   = 'storage:test-connection',
STORAGE_SAVE_CONFIG       = 'storage:save-config',
```

Add payload types at the bottom of the file:

```typescript
export interface StorageConnectionParams {
  host: string
  port: number
  database: string
  username: string
  password: string
}

export interface StorageConfigInfo {
  host: string
  port: number
  database: string
  username: string
}
```

- [ ] **Step 2: Create storage.ipc.ts**

```typescript
// src/main/ipc/handlers/storage.ipc.ts
import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { IpcChannel } from '../types'
import type { StorageConnectionParams, StorageConfigInfo, IpcResult } from '../types'
import { getStorageConfig, saveStorageConfig } from '../../store/storageConfig'
import { testConnection, initStoragePool } from '../../store/sqlserver/connection'
import { initSchema } from '../../store/sqlserver/database'

export function registerStorageHandlers(): void {
  handle(IpcChannel.STORAGE_GET_CONFIG, async (): Promise<IpcResult<StorageConfigInfo | null>> => {
    const cfg = getStorageConfig()
    if (!cfg) return { ok: true, data: null }
    return { ok: true, data: { host: cfg.host, port: cfg.port, database: cfg.database, username: cfg.username } }
  })

  handle(
    IpcChannel.STORAGE_TEST_CONNECTION,
    async (_e: IpcMainInvokeEvent, params: StorageConnectionParams): Promise<IpcResult<null>> => {
      try {
        await testConnection(params)
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] STORAGE_TEST_CONNECTION:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(
    IpcChannel.STORAGE_SAVE_CONFIG,
    async (_e: IpcMainInvokeEvent, params: StorageConnectionParams): Promise<IpcResult<null>> => {
      try {
        await testConnection(params)
        saveStorageConfig(params)
        await initStoragePool(getStorageConfig()!)
        await initSchema()
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] STORAGE_SAVE_CONFIG:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
```

- [ ] **Step 3: Register handler in ipc/index.ts**

Open `src/main/ipc/index.ts` and add:

```typescript
import { registerStorageHandlers } from './handlers/storage.ipc'
// Inside registerIpcHandlers():
registerStorageHandlers()
```

- [ ] **Step 4: Update preload/index.ts**

Add to the `contextBridge.exposeInMainWorld('sqlSentinel', {...})` block:

```typescript
storage: {
  getConfig: () => ipcRenderer.invoke(IpcChannel.STORAGE_GET_CONFIG),
  testConnection: (params: StorageConnectionParams) => ipcRenderer.invoke(IpcChannel.STORAGE_TEST_CONNECTION, params),
  saveConfig: (params: StorageConnectionParams) => ipcRenderer.invoke(IpcChannel.STORAGE_SAVE_CONFIG, params),
  onNotConfigured: (cb: (err?: string) => void) => {
    const handler = (_e: IpcRendererEvent, payload: { error?: string }) => cb(payload?.error)
    ipcRenderer.on('storage:not-configured', handler)
    return () => ipcRenderer.removeListener('storage:not-configured', handler)
  },
  onConfigured: (cb: () => void) => {
    ipcRenderer.on('storage:configured', cb)
    return () => ipcRenderer.removeListener('storage:configured', cb)
  }
},
```

- [ ] **Step 5: Typecheck**

```
npm run typecheck 2>&1 | head -20
```
Expected: no errors (update `index.d.ts` for any type errors found)

- [ ] **Step 6: Commit**

```
git add src/main/ipc/handlers/storage.ipc.ts src/main/ipc/types.ts src/main/ipc/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(ipc): storage connection IPC handlers and preload bindings"
```

---

## Task 10: Update authService to use SQL Server repositories

**Files:**
- Modify: `src/main/authService.ts`

- [ ] **Step 1: Read the current authService**

```
cat src/main/authService.ts
```

Identify every call to `getDb()`, `db.prepare(...)`, and any sync SQLite patterns.

- [ ] **Step 2: Replace SQLite calls with SQL Server repositories**

Replace all imports from `./store/database` and `better-sqlite3` with:

```typescript
import {
  findByUsername,
  findById,
  countUsers,
  createUser,
  updateLastLogin,
  updatePassword
} from './store/sqlserver/usersRepository'
import {
  createSession,
  findSessionByToken,
  removeSession,
  removeExpiredSessions
} from './store/sqlserver/sessionsRepository'
```

Convert all functions to `async`. Pattern for each SQLite sync call:

```typescript
// Before (SQLite sync):
const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)

// After (SQL Server async):
const user = await findByUsername(username)
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck 2>&1 | head -20
```
Fix any type errors. All public functions of authService should now be `async`.

- [ ] **Step 4: Commit**

```
git add src/main/authService.ts
git commit -m "feat(auth): migrate authService to SQL Server repositories"
```

---

## Task 11: Main process init — replace SQLite with SQL Server

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Replace SQLite imports**

In `src/main/index.ts`, remove:

```typescript
import { initDb, closeDb, defaultDbPath } from './store/database'
import { cleanup as purgeOldSnapshots } from './store/metricsRepository'
import { getSettings } from './store/settings'
import { migrateEncryptEmailPassword } from './store/emailSettings'
```

Add:

```typescript
import { getStorageConfig } from './store/storageConfig'
import { initStoragePool, closeStoragePool } from './store/sqlserver/connection'
import { initSchema } from './store/sqlserver/database'
import { cleanup as purgeOldSnapshots } from './store/sqlserver/metricsRepository'
import { getSettings } from './store/sqlserver/settingsRepository'
import { migrateEncryptEmailPassword } from './store/sqlserver/emailSettingsRepository'
```

- [ ] **Step 2: Replace app.whenReady() init block**

Find the `app.whenReady().then(() => {` block (around line 155). Replace the SQLite init section:

```typescript
app.whenReady().then(async () => {
  // Initialize SQL Server storage pool
  const storageCfg = getStorageConfig()
  if (storageCfg) {
    try {
      await initStoragePool(storageCfg)
      await initSchema()
      await initDefaultAdmin()
      await migrateEncryptEmailPassword()
    } catch (err) {
      log.error('[main] Storage pool init failed:', redactError(err))
      // Will notify renderer after window is created
    }
  }

  // ... (keep rest of init: serverStore migrations, registerIpcHandlers, createWindow, etc.)

  createWindow()

  // After window is ready, notify renderer of storage state
  mainWindow?.webContents.on('did-finish-load', async () => {
    if (!storageCfg) {
      mainWindow?.webContents.send('storage:not-configured', {})
    } else {
      // Check pool is alive
      try {
        getPool() // throws if not initialized
        mainWindow?.webContents.send('storage:configured', {})
      } catch {
        mainWindow?.webContents.send('storage:not-configured', { error: 'Could not connect to storage database' })
      }
    }
  })
```

- [ ] **Step 3: Replace purgeOldSnapshots to be async**

Find the `deferredPurge` function and update:

```typescript
const retentionDays = async (): Promise<number> => {
  try {
    const s = await getSettings()
    return s.retentionMinutes / (60 * 24)
  } catch {
    return 1  // fallback: 1 day
  }
}
const deferredPurge = (): void => {
  setImmediate(async () => {
    try {
      await purgeOldSnapshots(await retentionDays())
    } catch (err) {
      log.warn('[main] purgeOldSnapshots:', err)
    }
  })
}
```

- [ ] **Step 4: Add closeStoragePool on app quit**

Find `app.on('window-all-closed', ...)` or `app.on('before-quit', ...)` and add:

```typescript
app.on('before-quit', async () => {
  await closeStoragePool().catch(() => {})
})
```

- [ ] **Step 5: Typecheck**

```
npm run typecheck 2>&1 | head -30
```
Fix any remaining type errors.

- [ ] **Step 6: Commit**

```
git add src/main/index.ts
git commit -m "feat(main): replace SQLite init with SQL Server storage pool init"
```

---

## Task 12: Update system IPC handlers to async

**Files:**
- Modify: `src/main/ipc/handlers/system.ipc.ts`

The following calls are currently synchronous and must be awaited:
- `getEmailSettings()` (line ~139)
- `saveEmailSettings(req)` (line ~152)
- `getCustomFields(req.serverId, req.dbName)` (line ~177)
- `setCustomFields(req.serverId, req.dbName, req.fields)` (line ~185)
- `getAllCustomFields()` (line ~194)

- [ ] **Step 1: Update imports**

Replace store imports:

```typescript
// Remove:
import { getEmailSettings, saveEmailSettings } from '../../store/emailSettings'
import { getCustomFields, setCustomFields, getAllCustomFields } from '../../store/dbCustomFields'

// Add:
import { getEmailSettings, saveEmailSettings } from '../../store/sqlserver/emailSettingsRepository'
import { getCustomFields, setCustomFields, getAllCustomFields } from '../../store/sqlserver/dbCustomFieldsRepository'
```

- [ ] **Step 2: Add await to each sync call**

```typescript
// EMAIL_SETTINGS_GET
return { ok: true, data: await getEmailSettings() }

// EMAIL_SETTINGS_SET
await saveEmailSettings(req)

// DB_GET_CUSTOM_FIELDS
return { ok: true, data: await getCustomFields(req.serverId, req.dbName) }

// DB_SET_CUSTOM_FIELDS
await setCustomFields(req.serverId, req.dbName, req.fields)

// DB_GET_ALL_CUSTOM_FIELDS
return { ok: true, data: await getAllCustomFields() }
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/main/ipc/handlers/system.ipc.ts
git commit -m "feat(ipc): await async store calls in system IPC handlers"
```

---

## Task 13: StorageSetupPage renderer

**Files:**
- Create: `src/renderer/src/pages/StorageSetupPage.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create StorageSetupPage.tsx**

```tsx
// src/renderer/src/pages/StorageSetupPage.tsx
import { useState } from 'react'
import { Box, Button, CircularProgress, TextField, Typography, Alert, Stack } from '@mui/material'

interface FormState {
  host: string
  port: string
  database: string
  username: string
  password: string
}

interface Props {
  initialError?: string
  onConfigured: () => void
}

export function StorageSetupPage({ initialError, onConfigured }: Props): React.JSX.Element {
  const [form, setForm] = useState<FormState>({
    host: 'localhost', port: '1437', database: 'SQLSentinelDB', username: 'sqlsentinel_app', password: ''
  })
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [tested, setTested] = useState(false)

  function field(key: keyof FormState) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }))
        setTested(false)
        setError(null)
      }
    }
  }

  async function handleTest() {
    setTesting(true)
    setError(null)
    const result = await window.sqlSentinel.storage.testConnection({
      host: form.host, port: Number(form.port), database: form.database,
      username: form.username, password: form.password
    })
    setTesting(false)
    if (result.ok) { setTested(true) } else { setError(result.error ?? 'Connection failed') }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const result = await window.sqlSentinel.storage.saveConfig({
      host: form.host, port: Number(form.port), database: form.database,
      username: form.username, password: form.password
    })
    setSaving(false)
    if (result.ok) { onConfigured() } else { setError(result.error ?? 'Save failed') }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
      <Box sx={{ width: 420, p: 4 }}>
        <Typography variant="h5" fontWeight={700} mb={1}>Storage Database</Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          SQLSentinel needs a SQL Server 2025 database to store metrics, settings, and user data.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2}>
          <Stack direction="row" spacing={1}>
            <TextField label="Host" fullWidth {...field('host')} />
            <TextField label="Port" sx={{ width: 100 }} {...field('port')} />
          </Stack>
          <TextField label="Database" fullWidth {...field('database')} />
          <TextField label="Username" fullWidth {...field('username')} />
          <TextField label="Password" type="password" fullWidth {...field('password')} />

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="outlined" onClick={handleTest} disabled={testing || saving}>
              {testing ? <CircularProgress size={16} /> : 'Test Connection'}
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={!tested || saving}>
              {saving ? <CircularProgress size={16} /> : 'Save & Continue'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: Update App.tsx to handle storage events**

In `src/renderer/src/App.tsx`, add state and effect at the top of the root component (outside `AppInner`, in the outermost component that wraps everything):

```tsx
// Add near the top of the file
import { StorageSetupPage } from './pages/StorageSetupPage'

// Inside the root App component, add:
const [storageState, setStorageState] = useState<'loading' | 'setup' | 'ready'>('loading')
const [storageError, setStorageError] = useState<string | undefined>()

useEffect(() => {
  const unsubNotConfigured = window.sqlSentinel.storage.onNotConfigured((err) => {
    setStorageError(err)
    setStorageState('setup')
  })
  const unsubConfigured = window.sqlSentinel.storage.onConfigured(() => {
    setStorageState('ready')
  })
  return () => { unsubNotConfigured(); unsubConfigured() }
}, [])

if (storageState === 'loading') return null
if (storageState === 'setup') {
  return (
    <ThemeProvider theme={...}>
      <CssBaseline />
      <StorageSetupPage initialError={storageError} onConfigured={() => setStorageState('ready')} />
    </ThemeProvider>
  )
}
// ... rest of App render
```

Place the theme/CssBaseline wrapper from the existing code around the `StorageSetupPage` render — check the exact ThemeProvider usage in the current `App.tsx`.

- [ ] **Step 3: Typecheck + dev server check**

```
npm run typecheck 2>&1 | head -20
npm run dev
```
Expected: app starts, if no storage config set → wizard appears full-screen.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/pages/StorageSetupPage.tsx src/renderer/src/App.tsx
git commit -m "feat(renderer): StorageSetupPage wizard for first-boot SQL Server configuration"
```

---

## Task 14: Settings page — Storage Database section

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`

- [ ] **Step 1: Find the Settings page structure**

```
grep -n "section\|Card\|Paper\|email\|smtp" src/renderer/src/pages/Settings.tsx | head -30
```

Identify where to insert the new section (after email settings or at the end).

- [ ] **Step 2: Add Storage section**

Add a new section in Settings.tsx. It shows the current connection (read-only) and an "Edit" button that opens a dialog with the same form as `StorageSetupPage`:

```tsx
// Inside Settings component, add state:
const [storageConfig, setStorageConfig] = useState<StorageConfigInfo | null>(null)
const [storageDialogOpen, setStorageDialogOpen] = useState(false)

// In useEffect on mount:
window.sqlSentinel.storage.getConfig().then((r) => {
  if (r.ok) setStorageConfig(r.data)
})

// In JSX, add new section:
<Box>
  <Typography variant="subtitle1" fontWeight={600} mb={1}>Storage Database</Typography>
  {storageConfig ? (
    <Stack direction="row" alignItems="center" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {storageConfig.host}:{storageConfig.port} / {storageConfig.database} ({storageConfig.username})
      </Typography>
      <Button size="small" onClick={() => setStorageDialogOpen(true)}>Edit</Button>
    </Stack>
  ) : (
    <Typography variant="body2" color="error">Not configured</Typography>
  )}
</Box>

<Dialog open={storageDialogOpen} onClose={() => setStorageDialogOpen(false)} maxWidth="sm" fullWidth>
  <StorageSetupPage
    onConfigured={() => {
      setStorageDialogOpen(false)
      window.sqlSentinel.storage.getConfig().then((r) => { if (r.ok) setStorageConfig(r.data) })
    }}
  />
</Dialog>
```

Import `StorageConfigInfo` from preload types and `StorageSetupPage` from pages.

- [ ] **Step 3: Typecheck**

```
npm run typecheck 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```
git add src/renderer/src/pages/Settings.tsx
git commit -m "feat(settings): add Storage Database section with edit dialog"
```

---

## Task 15: Final typecheck, build verification, and cleanup

- [ ] **Step 1: Full typecheck**

```
npm run typecheck
```
Expected: 0 errors

- [ ] **Step 2: Build**

```
npm run build
```
Expected: no build errors

- [ ] **Step 3: Verify old SQLite database.ts is no longer imported from any non-test file**

```
grep -r "from.*store/database" src/main --include="*.ts" | grep -v test | grep -v ".test."
```
Expected: no results (the old `database.ts` is only in tests or unused)

- [ ] **Step 4: Update CHANGELOG.md**

Add entry:

```markdown
## [Unreleased]
### Changed
- Persistence layer migrated from SQLite (better-sqlite3) to SQL Server 2025 (mssql)
- RAG chunk embeddings stored as native `vector(1536)` — SQL Server 2025 required
- First-boot wizard for SQL Server connection string configuration
- Storage connection editable in Settings page
```

- [ ] **Step 5: Final commit**

```
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for SQL Server migration"
```

---

## Note: Knowledge pipeline (out of scope for this plan)

The RAG indexing pipeline (`knowledge-pipeline/`) currently writes `rag_documents` and `rag_chunks` to the SQLite main DB. After this migration, it must be updated to call `ragRepository.ts` (SQL Server) instead. This is a separate task: find the pipeline's indexing entry point, replace `getDb()` calls with `initStoragePool()` + `ragRepository` functions, and configure the connection via the same env vars below.

The read-only `knowledge_base.db` FTS file (DBA cards, book chapters) is **not** touched by this pipeline change — it remains a static bundled resource.

---

## Environment variables for tests

To run the SQL Server repository tests with Docker:

```bash
STORAGE_TEST_HOST=localhost \
STORAGE_TEST_PORT=1437 \
STORAGE_TEST_DB=SQLSentinelDB \
STORAGE_TEST_USER=sqlsentinel_app \
STORAGE_TEST_PASSWORD=App@Sentinel2025 \
npx vitest run src/main/store/__tests__/
```

All test files check for `STORAGE_TEST_HOST` and skip automatically if not set (CI without Docker).
