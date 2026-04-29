import { getPool } from './connection'

export interface SchemaInitResult {
  tables: string[]
  indexes: string[]
  statistics: string[]
  warnings: string[]
}

// ── Database-level settings ──────────────────────────────────────────────────
// These are idempotent and tracked so failures (e.g., missing ALTER DATABASE
// permission) surface as warnings instead of silently degrading auto-stats.
const DB_SETTINGS: Array<{ name: string; sql: string }> = [
  {
    name: 'AUTO_CREATE_STATISTICS',
    sql: `ALTER DATABASE CURRENT SET AUTO_CREATE_STATISTICS ON WITH NO_WAIT`
  },
  {
    name: 'AUTO_UPDATE_STATISTICS',
    sql: `ALTER DATABASE CURRENT SET AUTO_UPDATE_STATISTICS ON WITH NO_WAIT`
  },
  {
    name: 'AUTO_UPDATE_STATISTICS_ASYNC',
    sql: `ALTER DATABASE CURRENT SET AUTO_UPDATE_STATISTICS_ASYNC ON WITH NO_WAIT`
  }
]

// ── Tables ───────────────────────────────────────────────────────────────────
const TABLE_DDL: Array<{ name: string; sql: string }> = [
  {
    name: 'settings',
    sql: `CREATE TABLE dbo.settings ([key] NVARCHAR(200) NOT NULL PRIMARY KEY, value NVARCHAR(MAX) NOT NULL)`
  },
  {
    name: 'db_custom_fields',
    sql: `CREATE TABLE dbo.db_custom_fields (id NVARCHAR(400) NOT NULL PRIMARY KEY, alias NVARCHAR(200) NULL, referente NVARCHAR(200) NULL)`
  },
  {
    name: 'metrics_snapshots',
    sql: `CREATE TABLE dbo.metrics_snapshots (
       id           NVARCHAR(36)  NOT NULL PRIMARY KEY,
       server_id    NVARCHAR(36)  NOT NULL,
       collected_at DATETIME2     NOT NULL,
       metrics_json NVARCHAR(MAX) NOT NULL
     )`
  },
  {
    name: 'users',
    sql: `CREATE TABLE dbo.users (
       id                   NVARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT LOWER(CONVERT(NVARCHAR(36), NEWID())),
       username             NVARCHAR(200) NOT NULL UNIQUE,
       password             NVARCHAR(500) NOT NULL,
       role                 NVARCHAR(50)  NOT NULL DEFAULT N'viewer',
       created_at           BIGINT        NOT NULL DEFAULT DATEDIFF_BIG(SECOND, '1970-01-01', GETUTCDATE()),
       last_login           BIGINT        NULL,
       must_change_password BIT           NOT NULL DEFAULT 0
     )`
  },
  {
    name: 'sessions',
    sql: `CREATE TABLE dbo.sessions (
       token      NVARCHAR(64)  NOT NULL PRIMARY KEY,
       user_id    NVARCHAR(36)  NOT NULL,
       username   NVARCHAR(200) NOT NULL,
       role       NVARCHAR(50)  NOT NULL,
       expires_at BIGINT        NOT NULL
     )`
  },
  {
    name: 'rag_documents',
    sql: `CREATE TABLE dbo.rag_documents (
       id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
       filename    NVARCHAR(500) NOT NULL UNIQUE,
       file_size   BIGINT        NOT NULL,
       indexed_at  NVARCHAR(50)  NOT NULL,
       chunk_count INT           NOT NULL DEFAULT 0
     )`
  },
  {
    name: 'rag_chunks',
    sql: `CREATE TABLE dbo.rag_chunks (
       id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
       document_id NVARCHAR(36)  NOT NULL REFERENCES dbo.rag_documents(id) ON DELETE CASCADE,
       chunk_index INT           NOT NULL,
       text        NVARCHAR(MAX) NOT NULL,
       embedding   vector(1536)  NOT NULL
     )`
  }
]

// ── Required indexes ─────────────────────────────────────────────────────────
const INDEX_DDL: Array<{ table: string; name: string; sql: string }> = [
  {
    table: 'metrics_snapshots',
    name: 'IX_metrics_server_collected',
    sql: `CREATE INDEX IX_metrics_server_collected ON dbo.metrics_snapshots(server_id, collected_at DESC)`
  },
  {
    table: 'metrics_snapshots',
    name: 'IX_metrics_cleanup',
    sql: `CREATE INDEX IX_metrics_cleanup ON dbo.metrics_snapshots(collected_at)`
  },
  {
    table: 'sessions',
    name: 'IX_sessions_expires',
    sql: `CREATE INDEX IX_sessions_expires ON dbo.sessions(expires_at)`
  },
  {
    table: 'rag_chunks',
    name: 'IX_rag_chunks_doc',
    sql: `CREATE INDEX IX_rag_chunks_doc ON dbo.rag_chunks(document_id)`
  }
]

// DiskANN vector index requires SQL Server 2025 — skipped with a warning on older versions.
const OPTIONAL_INDEX_DDL: Array<{ table: string; name: string; sql: string }> = [
  {
    table: 'rag_chunks',
    name: 'IX_rag_chunks_vec',
    sql: `CREATE VECTOR INDEX IX_rag_chunks_vec ON dbo.rag_chunks (embedding)
          USING DISKANN
          WITH (VECTOR_DISTANCE_FUNCTION = 'cosine')`
  }
]

// Statistics on UNINDEXED columns used in WHERE predicates.
// Note: indexed columns get auto-stats from the index — duplicating them adds maintenance
// overhead with no benefit, so we only cover columns not already referenced by an index.
const STATISTICS_DDL: Array<{ table: string; name: string; sql: string }> = [
  {
    table: 'db_custom_fields',
    name: 'ST_db_custom_fields_alias',
    sql: `CREATE STATISTICS ST_db_custom_fields_alias ON dbo.db_custom_fields(alias)`
  },
  {
    table: 'db_custom_fields',
    name: 'ST_db_custom_fields_referente',
    sql: `CREATE STATISTICS ST_db_custom_fields_referente ON dbo.db_custom_fields(referente)`
  }
]

// ── Helpers ──────────────────────────────────────────────────────────────────

async function tableExists(name: string): Promise<boolean> {
  const r = await getPool()
    .request()
    .query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sys.tables WHERE name = N'${name}' AND schema_id = SCHEMA_ID(N'dbo')`
    )
  return r.recordset[0].cnt > 0
}

async function indexExists(table: string, name: string): Promise<boolean> {
  const r = await getPool()
    .request()
    .query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.${table}') AND name = N'${name}'`
    )
  return r.recordset[0].cnt > 0
}

async function statExists(table: string, name: string): Promise<boolean> {
  const r = await getPool()
    .request()
    .query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sys.stats WHERE object_id = OBJECT_ID(N'dbo.${table}') AND name = N'${name}'`
    )
  return r.recordset[0].cnt > 0
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function initSchema(): Promise<SchemaInitResult> {
  const pool = getPool()
  const result: SchemaInitResult = { tables: [], indexes: [], statistics: [], warnings: [] }
  const newlyCreatedTables: string[] = []

  // 1. Database-level settings — idempotent; failures surface as warnings.
  for (const { name, sql } of DB_SETTINGS) {
    try {
      await pool.request().query(sql)
    } catch (err) {
      result.warnings.push(`Failed to enable ${name}: ${(err as Error).message}`)
    }
  }

  // 2. Tables — track which were actually created so we know whether to refresh stats later.
  for (const { name, sql } of TABLE_DDL) {
    const exists = await tableExists(name)
    if (exists) {
      result.tables.push(name)
      continue
    }
    try {
      await pool.request().query(sql)
      result.tables.push(name)
      newlyCreatedTables.push(name)
    } catch (err) {
      throw new Error(`initSchema: failed to create table '${name}': ${(err as Error).message}`)
    }
  }

  // 3. Required indexes
  for (const { table, name, sql } of INDEX_DDL) {
    if (await indexExists(table, name)) {
      result.indexes.push(name)
      continue
    }
    try {
      await pool.request().query(sql)
      result.indexes.push(name)
    } catch (err) {
      throw new Error(`initSchema: failed to create index '${name}': ${(err as Error).message}`)
    }
  }

  // 4. Optional indexes — graceful skip (e.g., DiskANN on non-2025 instances)
  for (const { table, name, sql } of OPTIONAL_INDEX_DDL) {
    if (await indexExists(table, name)) {
      result.indexes.push(name)
      continue
    }
    try {
      await pool.request().query(sql)
      result.indexes.push(name)
    } catch (err) {
      result.warnings.push(`Optional index '${name}' skipped: ${(err as Error).message}`)
    }
  }

  // 5. Statistics on unindexed predicate columns
  for (const { table, name, sql } of STATISTICS_DDL) {
    if (await statExists(table, name)) {
      result.statistics.push(name)
      continue
    }
    try {
      await pool.request().query(sql)
      result.statistics.push(name)
    } catch (err) {
      result.warnings.push(`Statistics '${name}' skipped: ${(err as Error).message}`)
    }
  }

  // 6. UPDATE STATISTICS — ONLY on tables we just created in this run.
  // Skipping on warm boot avoids a costly FULLSCAN of metrics_snapshots (potentially
  // millions of rows) on every startup; AUTO_UPDATE_STATISTICS handles drift.
  for (const tableName of newlyCreatedTables) {
    try {
      await pool.request().query(`UPDATE STATISTICS dbo.${tableName} WITH FULLSCAN`)
    } catch {
      // Non-fatal: empty tables or permission gap
    }
  }

  return result
}
