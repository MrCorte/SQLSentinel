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
  },
  {
    // User-collected thumbs up/down on AI assistant responses. Positive rows
    // feed dynamic few-shot examples back into the system prompt. Embedding is
    // VARBINARY (not vector(1536)) because nomic-embed-text is 768-dim.
    name: 'ai_feedback',
    sql: `CREATE TABLE dbo.ai_feedback (
       id            NVARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT LOWER(CONVERT(NVARCHAR(36), NEWID())),
       question      NVARCHAR(2000) NOT NULL,
       response      NVARCHAR(MAX) NOT NULL,
       question_hash CHAR(64)      NOT NULL,
       rating        SMALLINT      NOT NULL,
       embedding     VARBINARY(MAX) NULL,
       provider      NVARCHAR(20)  NOT NULL,
       model         NVARCHAR(100) NOT NULL,
       incident_id   NVARCHAR(36)  NULL,
       created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
       created_by    NVARCHAR(100) NULL
     )`
  },
  {
    // Dynamic overlay on the hardcoded TSQL_MAP — promoted patterns the user
    // has approved via the Settings UI. lookupTsqlMap checks this table first.
    name: 'ai_tsql_map',
    sql: `CREATE TABLE dbo.ai_tsql_map (
       id            NVARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT LOWER(CONVERT(NVARCHAR(36), NEWID())),
       key_name      NVARCHAR(100) NOT NULL UNIQUE,
       aliases       NVARCHAR(MAX) NOT NULL,
       tsql          NVARCHAR(MAX) NOT NULL,
       promoted_from NVARCHAR(36)  NULL,
       promoted_hash CHAR(64)      NULL,
       created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
     )`
  },
  {
    // Knowledge base — DBA reference cards. Imported one-shot from the
    // knowledge_base.db SQLite artifact built by the knowledge-pipeline. Used
    // as the highest-priority FTS hit for AI queries (exact T-SQL recipes).
    name: 'dba_cards',
    sql: `CREATE TABLE dbo.dba_cards (
       slug         NVARCHAR(200) NOT NULL PRIMARY KEY,
       title        NVARCHAR(500) NOT NULL,
       tags         NVARCHAR(MAX) NOT NULL,
       explanation  NVARCHAR(MAX) NOT NULL,
       tsql_query   NVARCHAR(MAX) NOT NULL,
       when_to_use  NVARCHAR(MAX) NOT NULL
     )`
  },
  {
    // Knowledge base — book chapters / general scripts.
    name: 'knowledge_chunks',
    sql: `CREATE TABLE dbo.knowledge_chunks (
       id           INT           NOT NULL PRIMARY KEY,
       title        NVARCHAR(500) NOT NULL,
       content      NVARCHAR(MAX) NOT NULL,
       tags         NVARCHAR(MAX) NOT NULL CONSTRAINT DF_knowledge_chunks_tags DEFAULT N'',
       type_field   NVARCHAR(50)  NOT NULL CONSTRAINT DF_knowledge_chunks_type DEFAULT N'',
       source_file  NVARCHAR(500) NOT NULL CONSTRAINT DF_knowledge_chunks_source DEFAULT N''
     )`
  },
  {
    // Knowledge base — nomic-embed-text (768-dim) chunk embeddings used for
    // semantic search. Stored as VARBINARY (little-endian float32 stream)
    // because not every target SQL Server has the 2025 vector type; the
    // optional DiskANN index below upgrades to native VECTOR when available.
    name: 'knowledge_embeddings',
    sql: `CREATE TABLE dbo.knowledge_embeddings (
       id         INT            NOT NULL PRIMARY KEY,
       title      NVARCHAR(500)  NOT NULL,
       chunk_idx  INT            NOT NULL,
       text       NVARCHAR(MAX)  NOT NULL,
       embedding  VARBINARY(MAX) NOT NULL
     )`
  },
  {
    // Monitored SQL Server registry — moved from the legacy electron-store JSON
    // file. Identified by (host, port) which is also the unique key. CPU counts
    // and AG roles are populated at runtime but persisted so we don't lose them
    // across restarts. Credentials are stored as a safeStorage (DPAPI) base64 blob.
    name: 'servers',
    sql: `CREATE TABLE dbo.servers (
       id                 NVARCHAR(36)  NOT NULL PRIMARY KEY,
       host               NVARCHAR(253) NOT NULL,
       port               INT           NOT NULL,
       instance_name      NVARCHAR(200) NULL,
       use_windows_auth   BIT           NOT NULL CONSTRAINT DF_servers_winauth DEFAULT 0,
       username           NVARCHAR(200) NULL,
       encrypted_password NVARCHAR(MAX) NULL,
       added_at           NVARCHAR(50)  NOT NULL,
       last_seen          NVARCHAR(50)  NULL,
       unreachable        BIT           NOT NULL CONSTRAINT DF_servers_unreach DEFAULT 0,
       unreachable_since  NVARCHAR(50)  NULL,
       machine_name       NVARCHAR(200) NULL,
       ag_group_id        NVARCHAR(36)  NULL,
       ag_name            NVARCHAR(200) NULL,
       ag_role            NVARCHAR(20)  NULL,
       logical_cpus       INT           NULL,
       physical_cpus      INT           NULL,
       hosting_type       NVARCHAR(20)  NULL,
       notes              NVARCHAR(MAX) NULL,
       CONSTRAINT UQ_servers_host_port UNIQUE (host, port)
     )`
  },
  {
    // Persistent per-server database inventory — seeds metricsMap on boot so
    // the database list is visible before the first polling cycle completes.
    name: 'server_databases',
    sql: `CREATE TABLE dbo.server_databases (
       server_id       NVARCHAR(36)  NOT NULL,
       name            NVARCHAR(200) NOT NULL,
       state_desc      NVARCHAR(50)  NOT NULL CONSTRAINT DF_server_databases_state DEFAULT N'ONLINE',
       recovery_model  NVARCHAR(20)  NOT NULL CONSTRAINT DF_server_databases_recovery DEFAULT N'SIMPLE',
       size_mb         FLOAT         NOT NULL CONSTRAINT DF_server_databases_size DEFAULT 0,
       log_size_mb     FLOAT         NOT NULL CONSTRAINT DF_server_databases_log_size DEFAULT 0,
       compat_level    INT           NOT NULL CONSTRAINT DF_server_databases_compat DEFAULT 150,
       is_encrypted    BIT           NOT NULL CONSTRAINT DF_server_databases_encrypted DEFAULT 0,
       is_read_only    BIT           NOT NULL CONSTRAINT DF_server_databases_readonly DEFAULT 0,
       owner           NVARCHAR(200) NOT NULL CONSTRAINT DF_server_databases_owner DEFAULT N'',
       create_date     NVARCHAR(50)  NOT NULL CONSTRAINT DF_server_databases_create DEFAULT N'',
       last_seen       BIGINT        NOT NULL CONSTRAINT DF_server_databases_seen DEFAULT 0,
       CONSTRAINT PK_server_databases PRIMARY KEY (server_id, name)
     )`
  },
  {
    // Parent record for an incident detected from the alert pipeline. Children
    // (events, actions, audit) cascade-delete with the parent so cleanup is atomic.
    name: 'incidents',
    sql: `CREATE TABLE dbo.incidents (
       id            NVARCHAR(36)  NOT NULL PRIMARY KEY,
       server_id     NVARCHAR(36)  NOT NULL,
       category      NVARCHAR(50)  NOT NULL,
       severity      NVARCHAR(20)  NOT NULL,
       status        NVARCHAR(20)  NOT NULL CONSTRAINT DF_incidents_status DEFAULT N'open',
       opened_at     BIGINT        NOT NULL,
       resolved_at   BIGINT        NULL,
       summary       NVARCHAR(MAX) NULL,
       root_cause_md NVARCHAR(MAX) NULL
     )`
  },
  {
    name: 'incident_events',
    sql: `CREATE TABLE dbo.incident_events (
       id           NVARCHAR(36)  NOT NULL PRIMARY KEY,
       incident_id  NVARCHAR(36)  NOT NULL REFERENCES dbo.incidents(id) ON DELETE CASCADE,
       kind         NVARCHAR(50)  NOT NULL,
       payload_json NVARCHAR(MAX) NOT NULL,
       at           BIGINT        NOT NULL
     )`
  },
  {
    name: 'incident_actions',
    sql: `CREATE TABLE dbo.incident_actions (
       id               NVARCHAR(36)  NOT NULL PRIMARY KEY,
       incident_id      NVARCHAR(36)  NOT NULL REFERENCES dbo.incidents(id) ON DELETE CASCADE,
       tool_name        NVARCHAR(100) NOT NULL,
       params_json      NVARCHAR(MAX) NOT NULL,
       tsql_preview     NVARCHAR(MAX) NOT NULL,
       explanation      NVARCHAR(MAX) NOT NULL,
       status           NVARCHAR(20)  NOT NULL CONSTRAINT DF_incident_actions_status DEFAULT N'pending',
       approved_by      NVARCHAR(200) NULL,
       executed_at      BIGINT        NULL,
       result_json      NVARCHAR(MAX) NULL,
       rejection_reason NVARCHAR(MAX) NULL,
       seq              BIGINT        NOT NULL IDENTITY(1,1)
     )`
  },
  {
    name: 'incident_audit',
    sql: `CREATE TABLE dbo.incident_audit (
       id              NVARCHAR(36)  NOT NULL PRIMARY KEY,
       incident_id     NVARCHAR(36)  NOT NULL REFERENCES dbo.incidents(id) ON DELETE CASCADE,
       provider        NVARCHAR(20)  NOT NULL,
       model           NVARCHAR(100) NOT NULL,
       prompt_hash     CHAR(64)      NOT NULL,
       response_hash   CHAR(64)      NOT NULL,
       tokens_in       INT           NULL,
       tokens_out      INT           NULL,
       duration_ms     INT           NULL,
       tool_call_count INT           NULL,
       error           NVARCHAR(MAX) NULL,
       at              BIGINT        NOT NULL
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
  },
  {
    table: 'ai_feedback',
    name: 'IX_ai_feedback_hash',
    sql: `CREATE INDEX IX_ai_feedback_hash ON dbo.ai_feedback(question_hash)`
  },
  {
    table: 'ai_feedback',
    name: 'IX_ai_feedback_rating',
    sql: `CREATE INDEX IX_ai_feedback_rating ON dbo.ai_feedback(rating)`
  },
  {
    table: 'servers',
    // Filtered: the tray + health pages only ever query unreachable=1.
    // Indexing every row would waste space (and update I/O) on the typical
    // healthy fleet where 95% of rows have unreachable=0.
    name: 'IX_servers_unreachable',
    sql: `CREATE INDEX IX_servers_unreachable ON dbo.servers(id)
          WHERE unreachable = 1`
  },
  {
    table: 'incidents',
    // Filtered: countOpen + the "active incidents" widget only scan
    // non-terminal statuses. resolved/archived rows are read by the
    // detail screen via PK lookups instead.
    name: 'IX_incidents_status_open',
    sql: `CREATE INDEX IX_incidents_status_open ON dbo.incidents(opened_at DESC)
          WHERE status NOT IN (N'resolved', N'archived')`
  },
  {
    table: 'incidents',
    // Non-filtered fallback for the detail screen that reads any single
    // status (e.g. listing archived incidents on demand).
    name: 'IX_incidents_status',
    sql: `CREATE INDEX IX_incidents_status ON dbo.incidents(status)`
  },
  {
    table: 'incidents',
    name: 'IX_incidents_server',
    sql: `CREATE INDEX IX_incidents_server ON dbo.incidents(server_id)`
  },
  {
    table: 'incidents',
    name: 'IX_incidents_opened',
    sql: `CREATE INDEX IX_incidents_opened ON dbo.incidents(opened_at DESC)`
  },
  {
    table: 'incident_events',
    name: 'IX_incident_events_incident',
    sql: `CREATE INDEX IX_incident_events_incident ON dbo.incident_events(incident_id, at)`
  },
  {
    table: 'incident_actions',
    name: 'IX_incident_actions_incident',
    sql: `CREATE INDEX IX_incident_actions_incident ON dbo.incident_actions(incident_id, seq)`
  },
  {
    // Filtered: getPendingActions is the only hot query on this column — and
    // pending rows are a small minority of the table over time.
    table: 'incident_actions',
    name: 'IX_incident_actions_pending',
    sql: `CREATE INDEX IX_incident_actions_pending ON dbo.incident_actions(incident_id)
          WHERE status = N'pending'`
  },
  {
    table: 'incident_audit',
    name: 'IX_incident_audit_incident',
    sql: `CREATE INDEX IX_incident_audit_incident ON dbo.incident_audit(incident_id, at)`
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

// ── Compression — tables that grow unboundedly or store large JSON blobs ────
//
// PAGE compression on rowstore tables typically reduces both data + index
// pages 3-5x for JSON/text workloads. CPU cost on INSERT is small (~1-3%);
// dramatic I/O reduction on the read paths (history charts, AG sync,
// historical alert export). Cheaper than columnstore for our access pattern.
const COMPRESSION_TARGETS: Array<{ table: string }> = [
  { table: 'metrics_snapshots' },
  { table: 'server_databases' },
  { table: 'incident_events' },
  { table: 'incident_actions' },
  { table: 'incident_audit' },
  { table: 'knowledge_chunks' },
  { table: 'knowledge_embeddings' }
]

async function tableIsCompressed(name: string): Promise<boolean> {
  const r = await getPool()
    .request()
    .query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sys.partitions
       WHERE object_id = OBJECT_ID(N'dbo.${name}')
         AND index_id IN (0, 1)
         AND data_compression > 0`
    )
  return r.recordset[0].cnt > 0
}

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

// ── Schema migration framework ──────────────────────────────────────────────
//
// Each entry is an idempotent forward migration. The runner records the
// highest applied id in `dbo.schema_migrations`; future versions of the app
// can append new entries here and they'll be picked up at the next launch
// without touching the existing customer data.
//
// Authoring rules:
//  - id MUST be unique and monotonically increasing
//  - sql SHOULD be idempotent (use IF NOT EXISTS / IF EXISTS where possible)
//  - sql MUST not depend on the order of execution within the same migration
//  - one logical change per migration; bigger changes go in multiple entries
//
interface Migration {
  id: number
  description: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  // No migrations yet — the bootstrap CREATE TABLE statements above cover v1.
  // Example for the next schema bump:
  //   {
  //     id: 1,
  //     description: 'Add notes column to users',
  //     sql: `IF COL_LENGTH('dbo.users', 'notes') IS NULL
  //           ALTER TABLE dbo.users ADD notes NVARCHAR(1000) NULL;`
  //   },
]

async function ensureMigrationsTable(): Promise<void> {
  await getPool().request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'schema_migrations' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE TABLE dbo.schema_migrations (
      id          INT NOT NULL PRIMARY KEY,
      description NVARCHAR(400) NOT NULL,
      applied_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    )
  `)
}

async function getAppliedMigrationIds(): Promise<Set<number>> {
  const r = await getPool()
    .request()
    .query<{ id: number }>(`SELECT id FROM dbo.schema_migrations`)
  return new Set(r.recordset.map((row) => row.id))
}

async function runMigrations(result: SchemaInitResult): Promise<void> {
  await ensureMigrationsTable()
  const applied = await getAppliedMigrationIds()
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    try {
      await getPool().request().query(m.sql)
      await getPool()
        .request()
        .input('id', m.id)
        .input('desc', m.description)
        .query(
          `INSERT INTO dbo.schema_migrations (id, description) VALUES (@id, @desc)`
        )
      result.warnings.push(`Applied migration ${m.id}: ${m.description}`)
    } catch (err) {
      // Fail-loud: a partially applied migration is worse than aborting the boot.
      throw new Error(
        `Migration ${m.id} (${m.description}) failed: ${(err as Error).message}. ` +
          `Restore from backup before retrying.`
      )
    }
  }
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

  // 6. Compression — apply PAGE compression to hot tables that grow large
  //    over time. Skipped on Standard/Express editions older than 2016 SP1,
  //    so failures are downgraded to warnings rather than aborting boot.
  for (const { table } of COMPRESSION_TARGETS) {
    if (!result.tables.includes(table)) continue
    if (await tableIsCompressed(table)) continue
    try {
      await pool
        .request()
        .query(
          `ALTER TABLE dbo.${table} REBUILD WITH (DATA_COMPRESSION = PAGE)`
        )
    } catch (err) {
      result.warnings.push(
        `Compression on '${table}' skipped: ${(err as Error).message}`
      )
    }
  }

  // 7. UPDATE STATISTICS — ONLY on tables we just created in this run.
  // Skipping on warm boot avoids a costly FULLSCAN of metrics_snapshots (potentially
  // millions of rows) on every startup; AUTO_UPDATE_STATISTICS handles drift.
  for (const tableName of newlyCreatedTables) {
    try {
      await pool.request().query(`UPDATE STATISTICS dbo.${tableName} WITH FULLSCAN`)
    } catch {
      // Non-fatal: empty tables or permission gap
    }
  }

  // 8. Versioned migrations — append to MIGRATIONS array for forward changes.
  await runMigrations(result)

  return result
}
