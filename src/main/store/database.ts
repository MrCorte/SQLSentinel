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

  -- Drop legacy single-column indexes replaced by the composite below
  DROP INDEX IF EXISTS idx_metrics_server_id;
  DROP INDEX IF EXISTS idx_metrics_collected_at;
  -- Composite index covers all query patterns: WHERE server_id = ? ORDER BY collected_at DESC
  CREATE INDEX IF NOT EXISTS idx_metrics_server_collected ON metrics_snapshots(server_id, collected_at DESC);
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

  _db.exec(DDL)

  return _db
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database non inizializzato. Chiamare initDb() prima.')
  return _db
}

export function closeDb(): void {
  _db?.close()
  _db = null
}

/**
 * Path di default per la produzione.
 * Da chiamare dopo app.whenReady() nel main process.
 */
export function defaultDbPath(appDataPath: string): string {
  return join(appDataPath, 'sqlsentinel', 'data.db')
}
