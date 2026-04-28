# SQLSentinel — SQLite → SQL Server 2025 Migration Design

**Date:** 2026-04-28
**Branch:** `sqlserver`
**Motivation:** scalability of `metrics_snapshots` — SQLite local file becomes a bottleneck as time-series volume grows.

---

## Scope

**In scope:** all writable SQLite tables → SQL Server 2025
- `settings`, `db_custom_fields`, `metrics_snapshots`, `users`, `sessions`
- `rag_documents`, `rag_chunks` (embeddings → native `vector(1536)`)

**Out of scope / unchanged:**
- `serverStore.ts` — stays in `electron-store` (must be readable before storage DB is reachable)
- `ftsRepository.ts` + `knowledge_base.db` — static read-only bundled resource, not user data
- `safeStorageUtil.ts` — unchanged

**No automatic SQLite→SQL Server data migration.** The `sqlserver` branch starts fresh. A migration tool is a separate future task.

---

## Architecture

### Directory structure

```
src/main/store/
  sqlserver/
    connection.ts           ← mssql pool singleton for the storage DB
    database.ts             ← DDL + initSchema() (async)
    metricsRepository.ts    ← same public interface, mssql implementation
    settingsRepository.ts
    dbCustomFieldsRepository.ts
    emailSettingsRepository.ts
    usersRepository.ts
    sessionsRepository.ts
    ragRepository.ts        ← rag_documents + rag_chunks (vector(1536))
  storageConfig.ts          ← NEW: reads/writes connection string via electron-store
  serverStore.ts            ← unchanged
  ftsRepository.ts          ← unchanged
  safeStorageUtil.ts        ← unchanged
```

### What stays, what moves

| Component | Before | After |
|---|---|---|
| `metrics_snapshots` | SQLite TEXT dates, JSON blob | SQL Server `DATETIME2`, `NVARCHAR(MAX)` |
| `settings` | SQLite key-value | SQL Server key-value |
| `users` / `sessions` | SQLite | SQL Server |
| `db_custom_fields` | SQLite | SQL Server |
| `rag_chunks` | SQLite BLOB | SQL Server `vector(1536)` |
| `serverStore` | electron-store JSON | **unchanged** |
| `knowledge_base.db` | read-only SQLite bundled | **unchanged** |
| Storage connection string | N/A | electron-store (safeStorage encrypted) |

---

## Database Schema

```sql
-- Settings
CREATE TABLE dbo.settings (
  [key]   NVARCHAR(200) NOT NULL PRIMARY KEY,
  value   NVARCHAR(MAX) NOT NULL
);

-- DB custom fields
CREATE TABLE dbo.db_custom_fields (
  id        NVARCHAR(400) NOT NULL PRIMARY KEY,  -- '{serverId}/{dbName}'
  alias     NVARCHAR(200) NULL,
  referente NVARCHAR(200) NULL
);

-- Metrics snapshots
CREATE TABLE dbo.metrics_snapshots (
  id           NVARCHAR(36)  NOT NULL PRIMARY KEY,
  server_id    NVARCHAR(36)  NOT NULL,
  collected_at DATETIME2     NOT NULL,
  metrics_json NVARCHAR(MAX) NOT NULL
);
CREATE INDEX IX_metrics_server_collected ON dbo.metrics_snapshots(server_id, collected_at DESC);
CREATE INDEX IX_metrics_cleanup          ON dbo.metrics_snapshots(collected_at);

-- Users
CREATE TABLE dbo.users (
  id                   NVARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT LOWER(CONVERT(NVARCHAR(36), NEWID())),
  username             NVARCHAR(200) NOT NULL UNIQUE,
  password             NVARCHAR(500) NOT NULL,
  role                 NVARCHAR(50)  NOT NULL DEFAULT N'viewer',
  created_at           BIGINT        NOT NULL DEFAULT DATEDIFF_BIG(SECOND, '1970-01-01', GETUTCDATE()),
  last_login           BIGINT        NULL,
  must_change_password BIT           NOT NULL DEFAULT 0
);

-- Sessions
CREATE TABLE dbo.sessions (
  token      NVARCHAR(500) NOT NULL PRIMARY KEY,
  user_id    NVARCHAR(36)  NOT NULL,
  username   NVARCHAR(200) NOT NULL,
  role       NVARCHAR(50)  NOT NULL,
  expires_at BIGINT        NOT NULL
);
CREATE INDEX IX_sessions_expires ON dbo.sessions(expires_at);

-- RAG documents
CREATE TABLE dbo.rag_documents (
  id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
  filename    NVARCHAR(500) NOT NULL UNIQUE,
  file_size   BIGINT        NOT NULL,
  indexed_at  NVARCHAR(50)  NOT NULL,
  chunk_count INT           NOT NULL DEFAULT 0
);

-- RAG chunks — vector(1536) requires SQL Server 2025
CREATE TABLE dbo.rag_chunks (
  id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
  document_id NVARCHAR(36)  NOT NULL REFERENCES dbo.rag_documents(id) ON DELETE CASCADE,
  chunk_index INT           NOT NULL,
  text        NVARCHAR(MAX) NOT NULL,
  embedding   vector(1536)  NOT NULL
);
CREATE INDEX IX_rag_chunks_doc ON dbo.rag_chunks(document_id);
```

---

## Storage Connection Management

### `storageConfig.ts`

Connection string stored in a dedicated `electron-store` (name: `sql-sentinel-storage-config`), password encrypted with `safeStorage`.

```typescript
export interface StorageConfig {
  host: string
  port: number
  database: string        // default: 'SQLSentinelDB'
  username: string
  encryptedPassword: string
}

export function getStorageConfig(): StorageConfig | null
export function saveStorageConfig(config: Omit<StorageConfig, 'encryptedPassword'> & { password: string }): void
export function clearStorageConfig(): void
```

### First-boot flow

```
App starts (main process)
  │
  ├─ getStorageConfig() → null
  │     └─ send 'storage-not-configured' to renderer
  │           └─ renderer shows StorageSetupPage (full-screen, before main UI)
  │                 │
  │                 user enters host / port / database / username / password
  │                 │
  │                 IPC: STORAGE_TEST_CONNECTION → main tests TCP + auth
  │                 ├─ fail → inline error, user retries
  │                 └─ ok  → IPC: STORAGE_SAVE_CONFIG
  │                               │
  │                               saveStorageConfig() + initSchema() + initStoragePool()
  │                               │
  │                               send 'storage-configured' → renderer shows main UI
  │
  └─ getStorageConfig() → present
        └─ initStoragePool()
              ├─ fail → send 'storage-not-configured' with error → wizard with prefilled fields
              └─ ok  → main UI loads normally
```

### Settings page — modify connection

New "Storage Database" section in existing Settings:
- Shows current `host:port/database` (read-only)
- "Edit connection" button → opens dialog with same fields as wizard
- On save: test → replace config → restart pool
- If new server has no schema → `initSchema()` creates tables automatically

### New IPC channels

| Channel | Direction | Payload |
|---|---|---|
| `STORAGE_GET_CONFIG` | renderer → main | — |
| `STORAGE_TEST_CONNECTION` | renderer → main | `{ host, port, database, username, password }` |
| `STORAGE_SAVE_CONFIG` | renderer → main | same |
| `storage-not-configured` | main → renderer | `{ error?: string }` |
| `storage-configured` | main → renderer | — |

---

## Repository Layer

### `connection.ts`

```typescript
export async function initStoragePool(config: StorageConfig): Promise<void>
export function getPool(): mssql.ConnectionPool   // throws if not initialized
export async function closeStoragePool(): Promise<void>
```

Pool options mirror `sqlCollector.ts`: `encrypt: false`, `trustServerCertificate: true`, `connectTimeout: 15000`, `requestTimeout: 30000`.

### Public interface — unchanged

All repository public functions keep the same signatures as the SQLite versions. Callers (IPC handlers, background workers) require no changes.

**Key difference:** all functions become `async`. SQLite (better-sqlite3) is synchronous; mssql is always async. IPC handlers are already `async` — verify any sync call sites in background workers.

### SQLite → mssql syntax mapping

| SQLite pattern | mssql pattern |
|---|---|
| `db.prepare(...).run(?)` | `pool.request().input('p', val).query(sql)` |
| `datetime('now', ? \|\| ' days')` | `DATEADD(DAY, @days, GETUTCDATE())` |
| `INSERT OR REPLACE` | `MERGE ... WHEN MATCHED / WHEN NOT MATCHED` |
| `lower(hex(randomblob(16)))` | `LOWER(CONVERT(NVARCHAR(36), NEWID()))` |
| `json_each(?)` for array param | `STRING_SPLIT(@ids, ',')` |
| Sync prepared statement cache | Each query is `async/await` |

### `findLastNBulk` — array parameter

Replaces SQLite `json_each()` with `STRING_SPLIT`:

```sql
SELECT id, server_id, collected_at, metrics_json
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY collected_at DESC) AS rn
  FROM dbo.metrics_snapshots
  WHERE server_id IN (SELECT value FROM STRING_SPLIT(@serverIds, ','))
) ranked
WHERE rn <= @n
ORDER BY server_id, collected_at ASC
```

---

## RAG — SQLite BLOB → `vector(1536)`

### Write (indexing pipeline)

Embeddings passed as JSON array string, cast to `vector(1536)` on insert:

```typescript
await pool.request()
  .input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embeddingArray))
  .query(`INSERT INTO rag_chunks (..., embedding)
          VALUES (..., CAST(@embedding AS vector(1536)))`)
```

### Read (similarity search)

```sql
SELECT TOP (@k) id, text,
       VECTOR_DISTANCE('cosine', embedding, CAST(@queryVec AS vector(1536))) AS score
FROM dbo.rag_chunks
ORDER BY score ASC
```

No JS loop, no bulk memory load. Native SQL Server 2025 ANN index can be added later for scale.

### `knowledge-pipeline/`

The offline pipeline that generates `knowledge_base.db` must be updated to write to SQL Server instead of SQLite. The pipeline connection string is configured separately (env var or config file within the pipeline).

---

## Testing

| Layer | Approach |
|---|---|
| Repository unit tests | Use `sql-sentinel` Docker (localhost:1437) — no mocks |
| IPC handlers | Unchanged — already tested |
| Setup wizard | Manual testing |
| RAG vector search | Direct query with synthetic embedding `[0.1, 0.2, ...]` |

Tests in `store/__tests__/` that use SQLite `:memory:` are rewritten to use Docker. Each test file checks for `STORAGE_TEST_URL` env var and skips if absent.

---

## Docker

- `sql-sentinel` container: `mcr.microsoft.com/mssql/server:2025-latest`, `platform: linux/amd64`, port `1437`
- `docker/init/sentinel.sql` creates `SQLSentinelDB` (persistence schema) and `SentinelAppDB` (monitored target test data)
- App connection: `localhost:1437`, login `sqlsentinel_app` / `App@Sentinel2025`, database `SQLSentinelDB`
- Monitor login (for collector testing): `sqlsentinel_monitor` / `Monitor@Sentinel2025`
- `sqlsentinel_app` is granted `db_owner` on `SQLSentinelDB` for Docker dev convenience. Production deployments should use a dedicated role with only `SELECT/INSERT/UPDATE/DELETE` on the app tables.
