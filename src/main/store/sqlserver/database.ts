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
    // Time-series table — clustered on (server_id, collected_at DESC) so the
    // dominant access pattern (latest-N per server, history range scans) does
    // a single clustered seek with no key lookup. Cluster is intentionally
    // non-unique: SQL Server appends a 4-byte uniquifier only on the rare
    // same-millisecond collision, which is cheaper than carrying the 36-byte
    // id column in every NCI row locator. id keeps a non-clustered UNIQUE
    // index for the data-model uniqueness contract.
    name: 'metrics_snapshots',
    sql: `CREATE TABLE dbo.metrics_snapshots (
       id           NVARCHAR(36)  NOT NULL,
       server_id    NVARCHAR(36)  NOT NULL,
       collected_at DATETIME2     NOT NULL,
       metrics_json NVARCHAR(MAX) NOT NULL,
       CONSTRAINT PK_metrics_snapshots PRIMARY KEY NONCLUSTERED (id),
       INDEX CX_metrics_server_collected CLUSTERED (server_id, collected_at DESC)
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
    // Cleanup-path index: the retention job filters purely on collected_at, so
    // a covering NCI on that single column keeps DELETE batches off the
    // clustered index. (The clustered key on (server_id, collected_at DESC, id)
    // covers all read paths, no separate read NCI needed.)
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
    // Filtered: every hot query (findPromotionCandidates GROUP BY hash,
    // listEmbeddable scan, feedbackIndex preWarm) starts from rating = 1.
    // Replaces the old IX_ai_feedback_rating which was non-selective (only
    // two possible values) and forced key-lookups on every match.
    table: 'ai_feedback',
    name: 'IX_ai_feedback_pos',
    sql: `CREATE INDEX IX_ai_feedback_pos ON dbo.ai_feedback(question_hash) WHERE rating = 1`
  },
  {
    // Filtered: NULL hashes are unpromoted candidates and never queried;
    // promoted_hash IS NOT NULL is the only predicate that hits this column.
    table: 'ai_tsql_map',
    name: 'IX_ai_tsql_map_promoted_hash',
    sql: `CREATE INDEX IX_ai_tsql_map_promoted_hash ON dbo.ai_tsql_map(promoted_hash)
          WHERE promoted_hash IS NOT NULL`
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
// Empty for now: previous entries on db_custom_fields(alias/referente) were
// removed because those columns are never part of a WHERE — the auto-stats
// were pure maintenance overhead. The legacy stats are dropped by migration 2.
const STATISTICS_DDL: Array<{ table: string; name: string; sql: string }> = []

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
  {
    id: 1,
    description: 'Re-cluster metrics_snapshots on (server_id, collected_at DESC)',
    // Existing installs created the table with `id NVARCHAR(36) PRIMARY KEY`
    // which defaulted to a CLUSTERED PK on a random UUID — causing constant
    // page splits and forcing key-lookups on every history read. This
    // migration converts those installs to the new layout: clustered on the
    // time-series access path with id moved to a non-clustered UNIQUE PK.
    // Idempotent: short-circuits when the old PK is already gone.
    //
    // ONLINE=ON keeps the table writable during the rebuild on Enterprise/
    // Developer/Azure editions. On Standard/Express the option is rejected
    // with msg 1969 / 40549; the TRY/CATCH retries OFFLINE which blocks
    // writes for the duration of the rebuild (typically minutes on a multi-GB
    // table). Migration is recorded as applied only after both branches
    // succeed, so a partial failure re-runs cleanly at the next boot.
    sql: `
      IF EXISTS (SELECT 1 FROM sys.indexes
                 WHERE object_id = OBJECT_ID(N'dbo.metrics_snapshots')
                   AND name = N'IX_metrics_server_collected')
        DROP INDEX IX_metrics_server_collected ON dbo.metrics_snapshots;

      DECLARE @pk SYSNAME;
      SELECT @pk = kc.name
      FROM sys.key_constraints kc
      JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id
      WHERE kc.parent_object_id = OBJECT_ID(N'dbo.metrics_snapshots')
        AND kc.type = 'PK'
        AND i.type_desc = 'CLUSTERED'
        AND c.name = N'id'
        AND (SELECT COUNT(*) FROM sys.index_columns
             WHERE object_id = i.object_id AND index_id = i.index_id) = 1;

      IF @pk IS NOT NULL
        EXEC ('ALTER TABLE dbo.metrics_snapshots DROP CONSTRAINT ' + QUOTENAME(@pk));

      IF NOT EXISTS (SELECT 1 FROM sys.indexes
                     WHERE object_id = OBJECT_ID(N'dbo.metrics_snapshots')
                       AND name = N'CX_metrics_server_collected')
      BEGIN
        BEGIN TRY
          CREATE CLUSTERED INDEX CX_metrics_server_collected
            ON dbo.metrics_snapshots(server_id, collected_at DESC)
            WITH (DATA_COMPRESSION = PAGE, ONLINE = ON);
        END TRY
        BEGIN CATCH
          -- ONLINE=ON unavailable (Standard/Express, or older 2014-): fall
          -- back to a blocking offline rebuild. Any other error re-throws.
          IF ERROR_NUMBER() IN (1969, 40549, 11402)
            CREATE CLUSTERED INDEX CX_metrics_server_collected
              ON dbo.metrics_snapshots(server_id, collected_at DESC)
              WITH (DATA_COMPRESSION = PAGE);
          ELSE
            ;THROW;
        END CATCH
      END

      IF NOT EXISTS (SELECT 1 FROM sys.key_constraints
                     WHERE parent_object_id = OBJECT_ID(N'dbo.metrics_snapshots')
                       AND type = 'PK')
        ALTER TABLE dbo.metrics_snapshots
          ADD CONSTRAINT PK_metrics_snapshots PRIMARY KEY NONCLUSTERED (id);
    `
  },
  {
    id: 2,
    description: 'Drop unused statistics on db_custom_fields(alias, referente)',
    // Those columns are never part of a WHERE clause; the legacy stats kept
    // getting auto-updated for nothing. Safe to drop on any install.
    sql: `
      IF EXISTS (SELECT 1 FROM sys.stats
                 WHERE object_id = OBJECT_ID(N'dbo.db_custom_fields')
                   AND name = N'ST_db_custom_fields_alias')
        DROP STATISTICS dbo.db_custom_fields.ST_db_custom_fields_alias;

      IF EXISTS (SELECT 1 FROM sys.stats
                 WHERE object_id = OBJECT_ID(N'dbo.db_custom_fields')
                   AND name = N'ST_db_custom_fields_referente')
        DROP STATISTICS dbo.db_custom_fields.ST_db_custom_fields_referente;
    `
  },
  {
    id: 3,
    description: 'Replace IX_ai_feedback_rating with filtered IX_ai_feedback_pos',
    // The legacy non-filtered index on rating had two distinct values, so the
    // optimiser preferred a scan anyway. The new filtered index is a single
    // page on most installs and serves the only hot query path (rating = 1).
    sql: `
      IF EXISTS (SELECT 1 FROM sys.indexes
                 WHERE object_id = OBJECT_ID(N'dbo.ai_feedback')
                   AND name = N'IX_ai_feedback_rating')
        DROP INDEX IX_ai_feedback_rating ON dbo.ai_feedback;
    `
  }
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

  // 2b. Versioned migrations — run BEFORE indexes/compression so structural
  // changes (e.g., dropping a legacy clustered PK in migration 1) don't
  // conflict with the idempotent index DDL below.
  await runMigrations(result)

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

  return result
}
