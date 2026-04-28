import { getPool } from './connection'

const DDL_STATEMENTS = [
  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'settings' AND schema_id = SCHEMA_ID(N'dbo'))
   CREATE TABLE dbo.settings ([key] NVARCHAR(200) NOT NULL PRIMARY KEY, value NVARCHAR(MAX) NOT NULL)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'db_custom_fields' AND schema_id = SCHEMA_ID(N'dbo'))
   CREATE TABLE dbo.db_custom_fields (id NVARCHAR(400) NOT NULL PRIMARY KEY, alias NVARCHAR(200) NULL, referente NVARCHAR(200) NULL)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'metrics_snapshots' AND schema_id = SCHEMA_ID(N'dbo'))
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

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'users' AND schema_id = SCHEMA_ID(N'dbo'))
   CREATE TABLE dbo.users (
     id                   NVARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT LOWER(CONVERT(NVARCHAR(36), NEWID())),
     username             NVARCHAR(200) NOT NULL UNIQUE,
     password             NVARCHAR(500) NOT NULL,
     role                 NVARCHAR(50)  NOT NULL DEFAULT N'viewer',
     created_at           BIGINT        NOT NULL DEFAULT DATEDIFF_BIG(SECOND, '1970-01-01', GETUTCDATE()),
     last_login           BIGINT        NULL,
     must_change_password BIT           NOT NULL DEFAULT 0
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'sessions' AND schema_id = SCHEMA_ID(N'dbo'))
   CREATE TABLE dbo.sessions (
     token      NVARCHAR(64) NOT NULL PRIMARY KEY,
     user_id    NVARCHAR(36)  NOT NULL,
     username   NVARCHAR(200) NOT NULL,
     role       NVARCHAR(50)  NOT NULL,
     expires_at BIGINT        NOT NULL
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.sessions') AND name = N'IX_sessions_expires')
   CREATE INDEX IX_sessions_expires ON dbo.sessions(expires_at)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'rag_documents' AND schema_id = SCHEMA_ID(N'dbo'))
   CREATE TABLE dbo.rag_documents (
     id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
     filename    NVARCHAR(500) NOT NULL UNIQUE,
     file_size   BIGINT        NOT NULL,
     indexed_at  NVARCHAR(50)  NOT NULL,
     chunk_count INT           NOT NULL DEFAULT 0
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'rag_chunks' AND schema_id = SCHEMA_ID(N'dbo'))
   CREATE TABLE dbo.rag_chunks (
     id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
     document_id NVARCHAR(36)  NOT NULL REFERENCES dbo.rag_documents(id) ON DELETE CASCADE,
     chunk_index INT           NOT NULL,
     text        NVARCHAR(MAX) NOT NULL,
     embedding   vector(1536)  NOT NULL
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.rag_chunks') AND name = N'IX_rag_chunks_doc')
   CREATE INDEX IX_rag_chunks_doc ON dbo.rag_chunks(document_id)`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.rag_chunks') AND name = N'IX_rag_chunks_vec')
 CREATE VECTOR INDEX IX_rag_chunks_vec ON dbo.rag_chunks (embedding)
 USING DISKANN
 WITH (VECTOR_DISTANCE_FUNCTION = 'cosine')`
]

export async function initSchema(): Promise<void> {
  const pool = getPool()
  for (const stmt of DDL_STATEMENTS) {
    try {
      await pool.request().query(stmt)
    } catch (err) {
      throw new Error(`initSchema failed: ${(err as Error).message}`)
    }
  }
}
