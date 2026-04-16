import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import Database from 'better-sqlite3'

// Singleton — inizializzato da initDb() prima di qualsiasi accesso
let _db: Database.Database | null = null

const DDL = `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS db_custom_fields (
    id        TEXT PRIMARY KEY,
    alias     TEXT,
    referente TEXT
  );

  CREATE TABLE IF NOT EXISTS servers (
    id                TEXT    PRIMARY KEY,
    ip                TEXT    NOT NULL,
    port              INTEGER NOT NULL,
    instance_name     TEXT,
    use_windows_auth  INTEGER NOT NULL DEFAULT 0,
    username          TEXT,
    encrypted_password TEXT,
    added_at          TEXT    NOT NULL,
    last_seen_at      TEXT,
    last_metrics_at   TEXT,
    UNIQUE (ip, port)
  );

  CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id            TEXT PRIMARY KEY,
    server_id     TEXT NOT NULL,
    collected_at  TEXT NOT NULL,
    metrics_json  TEXT NOT NULL,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id                  TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    username            TEXT    NOT NULL UNIQUE,
    password            TEXT    NOT NULL,
    role                TEXT    NOT NULL DEFAULT 'viewer',
    created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
    last_login          INTEGER,
    must_change_password INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    TEXT    NOT NULL,
    username   TEXT    NOT NULL,
    role       TEXT    NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Drop legacy single-column indexes replaced by the composite below
  DROP INDEX IF EXISTS idx_metrics_server_id;
  DROP INDEX IF EXISTS idx_metrics_collected_at;
  -- Composite index: WHERE server_id = ? ORDER BY collected_at DESC  (findLatest, findHistory)
  CREATE INDEX IF NOT EXISTS idx_metrics_server_collected ON metrics_snapshots(server_id, collected_at DESC);
  -- Standalone index: WHERE collected_at < ? without server_id  (cleanup/purge)
  CREATE INDEX IF NOT EXISTS idx_metrics_cleanup ON metrics_snapshots(collected_at);

  CREATE TABLE IF NOT EXISTS rag_documents (
    id          TEXT PRIMARY KEY,
    filename    TEXT NOT NULL UNIQUE,
    file_size   INTEGER NOT NULL,
    indexed_at  TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rag_chunks (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text        TEXT NOT NULL,
    embedding   BLOB NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc ON rag_chunks(document_id);

`

/**
 * Inizializza il database SQLite.
 * Chiamare con il path reale da src/main/index.ts, con ':memory:' nei test.
 * Il path viene costruito fuori dal modulo per non dipendere da Electron app qui.
 */
export function initDb(dbPath: string): Database.Database {
  // Crea la directory se necessario (saltiamo per :memory:)
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  _db = new Database(dbPath)

  // WAL mode: scritture non bloccano le letture
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  // Performance tuning — sicuri con WAL
  _db.pragma('synchronous  = NORMAL') // 2 fsync → 1 per transazione; nessun rischio di corruzione con WAL
  _db.pragma('cache_size   = -8192')  // 8 MB (default: 2 MB)
  _db.pragma('temp_store   = MEMORY') // tabelle temporanee in RAM

  // Schema migration: drop tabelle RAG con schema vecchio (size_bytes → file_size)
  const schemaVersion = (_db.pragma('user_version', { simple: true }) as number) ?? 0
  if (schemaVersion < 1) {
    _db.exec('DROP TABLE IF EXISTS rag_chunks; DROP TABLE IF EXISTS rag_documents;')
    _db.pragma('user_version = 1')
  }

  _db.exec(DDL)

  // Flush any WAL pages left from a previous run; keeps DB file compact
  _db.pragma('wal_checkpoint(PASSIVE)')

  return _db
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database non inizializzato. Chiamare initDb() prima.')
  return _db
}

export function closeDb(): void {
  if (_db) {
    // Let SQLite update internal statistics for the query planner before closing
    _db.pragma('optimize')
    _db.close()
    _db = null
  }
}

/**
 * Path di default per la produzione.
 * Da chiamare dopo app.whenReady() nel main process.
 */
export function defaultDbPath(appDataPath: string): string {
  return join(appDataPath, 'sqlsentinel', 'data.db')
}
