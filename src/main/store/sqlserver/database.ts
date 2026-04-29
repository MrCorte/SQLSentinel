import { getPool } from './connection'

export interface SchemaInitResult {
  tables: string[]
  indexes: string[]
  statistics: string[]
  warnings: string[]
}

// ── Database-level settings ──────────────────────────────────────────────────
// These are idempotent: safe to re-run on every startup.
const DB_SETTINGS: string[] = [
  `ALTER DATABASE CURRENT SET AUTO_CREATE_STATISTICS ON WITH NO_WAIT`,
  `ALTER DATABASE CURRENT SET AUTO_UPDATE_STATISTICS ON WITH NO_WAIT`,
  `ALTER DATABASE CURRENT SET AUTO_UPDATE_STATISTICS_ASYNC ON WITH NO_WAIT`
]

// ── Tables ───────────────────────────────────────────────────────────────────
const TABLE_DDL: Array<{ name: string; sql: string }> = [
  {
    name: 'settings',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'settings' AND schema_id = SCHEMA_ID(N'dbo'))
          CREATE TABLE dbo.settings ([key] NVARCHAR(200) NOT NULL PRIMARY KEY, value NVARCHAR(MAX) NOT NULL)`
  },
  {
    name: 'db_custom_fields',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'db_custom_fields' AND schema_id = SCHEMA_ID(N'dbo'))
          CREATE TABLE dbo.db_custom_fields (id NVARCHAR(400) NOT NULL PRIMARY KEY, alias NVARCHAR(200) NULL, referente NVARCHAR(200) NULL)`
  },
  {
    name: 'metrics_snapshots',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'metrics_snapshots' AND schema_id = SCHEMA_ID(N'dbo'))
          CREATE TABLE dbo.metrics_snapshots (
            id           NVARCHAR(36)  NOT NULL PRIMARY KEY,
            server_id    NVARCHAR(36)  NOT NULL,
            collected_at DATETIME2     NOT NULL,
            metrics_json NVARCHAR(MAX) NOT NULL
          )`
  },
  {
    name: 'users',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'users' AND schema_id = SCHEMA_ID(N'dbo'))
          CREATE TABLE dbo.users (
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
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'sessions' AND schema_id = SCHEMA_ID(N'dbo'))
          CREATE TABLE dbo.sessions (
            token      NVARCHAR(64)  NOT NULL PRIMARY KEY,
            user_id    NVARCHAR(36)  NOT NULL,
            username   NVARCHAR(200) NOT NULL,
            role       NVARCHAR(50)  NOT NULL,
            expires_at BIGINT        NOT NULL
          )`
  },
  {
    name: 'rag_documents',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'rag_documents' AND schema_id = SCHEMA_ID(N'dbo'))
          CREATE TABLE dbo.rag_documents (
            id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
            filename    NVARCHAR(500) NOT NULL UNIQUE,
            file_size   BIGINT        NOT NULL,
            indexed_at  NVARCHAR(50)  NOT NULL,
            chunk_count INT           NOT NULL DEFAULT 0
          )`
  },
  {
    name: 'rag_chunks',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'rag_chunks' AND schema_id = SCHEMA_ID(N'dbo'))
          CREATE TABLE dbo.rag_chunks (
            id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
            document_id NVARCHAR(36)  NOT NULL REFERENCES dbo.rag_documents(id) ON DELETE CASCADE,
            chunk_index INT           NOT NULL,
            text        NVARCHAR(MAX) NOT NULL,
            embedding   vector(1536)  NOT NULL
          )`
  }
]

// ── Required indexes ─────────────────────────────────────────────────────────
const INDEX_DDL: Array<{ name: string; sql: string }> = [
  {
    name: 'IX_metrics_server_collected',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.metrics_snapshots') AND name = N'IX_metrics_server_collected')
          CREATE INDEX IX_metrics_server_collected ON dbo.metrics_snapshots(server_id, collected_at DESC)`
  },
  {
    name: 'IX_metrics_cleanup',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.metrics_snapshots') AND name = N'IX_metrics_cleanup')
          CREATE INDEX IX_metrics_cleanup ON dbo.metrics_snapshots(collected_at)`
  },
  {
    name: 'IX_sessions_expires',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.sessions') AND name = N'IX_sessions_expires')
          CREATE INDEX IX_sessions_expires ON dbo.sessions(expires_at)`
  },
  {
    name: 'IX_rag_chunks_doc',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.rag_chunks') AND name = N'IX_rag_chunks_doc')
          CREATE INDEX IX_rag_chunks_doc ON dbo.rag_chunks(document_id)`
  }
]

// ── Optional indexes (SQL Server 2025+) ─────────────────────────────────────
// DiskANN vector index requires SQL Server 2025. Skipped with a warning on older versions.
const OPTIONAL_INDEX_DDL: Array<{ name: string; sql: string }> = [
  {
    name: 'IX_rag_chunks_vec (DiskANN)',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.rag_chunks') AND name = N'IX_rag_chunks_vec')
          CREATE VECTOR INDEX IX_rag_chunks_vec ON dbo.rag_chunks (embedding)
          USING DISKANN
          WITH (VECTOR_DISTANCE_FUNCTION = 'cosine')`
  }
]

// ── Statistics ───────────────────────────────────────────────────────────────
// SQL Server auto-creates statistics for indexed columns; these cover unindexed
// columns used in WHERE / JOIN predicates to help the query optimizer.
const STATISTICS_DDL: Array<{ name: string; sql: string }> = [
  {
    name: 'ST_db_custom_fields_alias',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.stats WHERE object_id = OBJECT_ID('dbo.db_custom_fields') AND name = N'ST_db_custom_fields_alias')
          CREATE STATISTICS ST_db_custom_fields_alias ON dbo.db_custom_fields(alias)`
  },
  {
    name: 'ST_db_custom_fields_referente',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.stats WHERE object_id = OBJECT_ID('dbo.db_custom_fields') AND name = N'ST_db_custom_fields_referente')
          CREATE STATISTICS ST_db_custom_fields_referente ON dbo.db_custom_fields(referente)`
  },
  {
    name: 'ST_users_role',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.stats WHERE object_id = OBJECT_ID('dbo.users') AND name = N'ST_users_role')
          CREATE STATISTICS ST_users_role ON dbo.users(role)`
  },
  {
    name: 'ST_users_last_login',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.stats WHERE object_id = OBJECT_ID('dbo.users') AND name = N'ST_users_last_login')
          CREATE STATISTICS ST_users_last_login ON dbo.users(last_login)`
  },
  {
    name: 'ST_metrics_snapshots_server_id',
    sql: `IF NOT EXISTS (SELECT 1 FROM sys.stats WHERE object_id = OBJECT_ID('dbo.metrics_snapshots') AND name = N'ST_metrics_snapshots_server_id')
          CREATE STATISTICS ST_metrics_snapshots_server_id ON dbo.metrics_snapshots(server_id)`
  }
]

// Tables to refresh statistics on after initial schema creation
const ALL_TABLES = [
  'dbo.settings',
  'dbo.db_custom_fields',
  'dbo.metrics_snapshots',
  'dbo.users',
  'dbo.sessions',
  'dbo.rag_documents',
  'dbo.rag_chunks'
]

export async function initSchema(): Promise<SchemaInitResult> {
  const pool = getPool()
  const result: SchemaInitResult = { tables: [], indexes: [], statistics: [], warnings: [] }

  // 1. Database-level settings (idempotent, best-effort)
  for (const sql of DB_SETTINGS) {
    try {
      await pool.request().query(sql)
    } catch {
      // Non-fatal: user may lack ALTER DATABASE permission
    }
  }

  // 2. Tables (required — fail fast on error)
  for (const { name, sql } of TABLE_DDL) {
    try {
      await pool.request().query(sql)
      result.tables.push(name)
    } catch (err) {
      throw new Error(`initSchema: failed to create table '${name}': ${(err as Error).message}`)
    }
  }

  // 3. Required indexes (required — fail fast on error)
  for (const { name, sql } of INDEX_DDL) {
    try {
      await pool.request().query(sql)
      result.indexes.push(name)
    } catch (err) {
      throw new Error(`initSchema: failed to create index '${name}': ${(err as Error).message}`)
    }
  }

  // 4. Optional indexes (graceful skip — e.g., DiskANN on non-2025 instances)
  for (const { name, sql } of OPTIONAL_INDEX_DDL) {
    try {
      await pool.request().query(sql)
      result.indexes.push(name)
    } catch (err) {
      result.warnings.push(`Optional index '${name}' skipped: ${(err as Error).message}`)
    }
  }

  // 5. Statistics on frequently-queried unindexed columns
  for (const { name, sql } of STATISTICS_DDL) {
    try {
      await pool.request().query(sql)
      result.statistics.push(name)
    } catch (err) {
      result.warnings.push(`Statistics '${name}' skipped: ${(err as Error).message}`)
    }
  }

  // 6. Update statistics with FULLSCAN so the optimizer has accurate cardinality
  //    (best-effort — non-fatal if tables are empty or permission is missing)
  for (const table of ALL_TABLES) {
    try {
      await pool.request().query(`UPDATE STATISTICS ${table} WITH FULLSCAN`)
    } catch {
      // Non-fatal
    }
  }

  return result
}
