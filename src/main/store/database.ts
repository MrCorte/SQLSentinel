import { mkdirSync, renameSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import Database from 'better-sqlite3'
import { createLogger } from '../utils/logger'

const log = createLogger('sqlite')

// Singleton — initialized by initDb() before any access
let _db: Database.Database | null = null

export interface InitDbResult {
  db: Database.Database
  /** Set when the on-disk file was corrupt and we rotated it aside before recreating. */
  recoveredFromCorruption: boolean
  /** Path of the rotated corrupt file, if any. */
  rotatedPath?: string
}

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
    metrics_json  TEXT NOT NULL
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

function isCorruptionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'SQLITE_IOERR_SHORT_READ') {
    return true
  }
  const msg = (err as Error | null)?.message ?? String(err ?? '')
  return /corrupt|malformed|not a database|disk image/i.test(msg)
}

function rotateCorruptDb(dbPath: string): string | null {
  if (dbPath === ':memory:') return null
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const rotated = `${dbPath}.corrupt-${ts}`
    if (existsSync(dbPath)) renameSync(dbPath, rotated)
    // Also rotate WAL/SHM siblings if present so the recreated DB starts clean.
    for (const suffix of ['-wal', '-shm']) {
      const sib = dbPath + suffix
      if (existsSync(sib)) renameSync(sib, rotated + suffix)
    }
    return rotated
  } catch (err) {
    log.error('[sqlite] rotate corrupt file failed:', err)
    return null
  }
}

/**
 * Initializes the SQLite database with corruption recovery.
 * If the file fails to open or fails the integrity check, we rotate it aside
 * (`.corrupt-<ts>`) and recreate an empty DB. The caller can detect this via
 * the `recoveredFromCorruption` flag and surface a banner to the user — their
 * historical metrics are gone but the app starts.
 */
export function initDbWithRecovery(dbPath: string): InitDbResult {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  let recoveredFromCorruption = false
  let rotatedPath: string | undefined

  // First attempt: open the file as-is.
  try {
    _db = new Database(dbPath)
    // Integrity check — cheap on small DBs, runs in a couple of seconds even on
    // hundreds of MB. Detects forms of corruption that don't show on open().
    const integrity = _db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') {
      log.error(`[sqlite] integrity_check returned: ${String(integrity)} — rotating`)
      _db.close()
      _db = null
      const rot = rotateCorruptDb(dbPath)
      if (rot) {
        rotatedPath = rot
        recoveredFromCorruption = true
      }
      _db = new Database(dbPath)
    }
  } catch (err) {
    if (!isCorruptionError(err)) throw err
    log.error('[sqlite] open failed with corruption, rotating:', err)
    if (_db) {
      try {
        _db.close()
      } catch {
        // ignored
      }
      _db = null
    }
    const rot = rotateCorruptDb(dbPath)
    if (rot) {
      rotatedPath = rot
      recoveredFromCorruption = true
    }
    _db = new Database(dbPath)
  }
  return finishInit(dbPath, recoveredFromCorruption, rotatedPath)
}

/** @deprecated Prefer initDbWithRecovery for the recovery flag. Kept for tests. */
export function initDb(dbPath: string): Database.Database {
  return initDbWithRecovery(dbPath).db
}

function finishInit(
  _dbPath: string,
  recoveredFromCorruption: boolean,
  rotatedPath: string | undefined
): InitDbResult {
  if (!_db) throw new Error('initDb: pool not opened')

  // WAL mode: writes do not block reads
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  // Performance tuning — safe with WAL
  _db.pragma('synchronous  = NORMAL') // 2 fsync → 1 per transaction; no corruption risk with WAL
  _db.pragma('cache_size   = -8192') // 8 MB (default: 2 MB)
  _db.pragma('temp_store   = MEMORY') // temporary tables in RAM

  // Schema migration: drop RAG tables with old schema (size_bytes → file_size)
  const schemaVersion = (_db.pragma('user_version', { simple: true }) as number) ?? 0
  if (schemaVersion < 1) {
    _db.exec('DROP TABLE IF EXISTS rag_chunks; DROP TABLE IF EXISTS rag_documents;')
    _db.pragma('user_version = 1')
  }
  // v2: remove FK on metrics_snapshots — serverStore uses electron-store, so the
  // SQLite servers table is always empty, causing every metrics write to fail.
  if (schemaVersion < 2) {
    _db.pragma('foreign_keys = OFF')
    _db.exec(`
      CREATE TABLE IF NOT EXISTS metrics_snapshots_new (
        id            TEXT PRIMARY KEY,
        server_id     TEXT NOT NULL,
        collected_at  TEXT NOT NULL,
        metrics_json  TEXT NOT NULL
      );
      INSERT OR IGNORE INTO metrics_snapshots_new
        SELECT id, server_id, collected_at, metrics_json FROM metrics_snapshots;
      DROP TABLE IF EXISTS metrics_snapshots;
      ALTER TABLE metrics_snapshots_new RENAME TO metrics_snapshots;
    `)
    _db.pragma('foreign_keys = ON')
    _db.pragma('user_version = 2')
  }

  _db.exec(DDL)

  // Flush any WAL pages left from a previous run; keeps DB file compact
  _db.pragma('wal_checkpoint(PASSIVE)')

  return { db: _db, recoveredFromCorruption, rotatedPath }
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database non inizializzato. Chiamare initDb() prima.')
  return _db
}

export function closeDb(): void {
  if (_db) {
    try {
      // Truncate the WAL into the main DB file before close. Without this, the
      // WAL/SHM pair can grow large between releases and a hard kill leaves
      // the WAL behind without a guaranteed checkpoint at the next open
      // (PASSIVE checkpoint in initDb only flushes pages with no contention).
      _db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (err) {
      log.warn('[sqlite] checkpoint(TRUNCATE) failed:', err)
    }
    try {
      // Let SQLite update internal statistics for the query planner before closing
      _db.pragma('optimize')
    } catch (err) {
      log.warn('[sqlite] optimize failed:', err)
    }
    try {
      _db.close()
    } catch (err) {
      log.warn('[sqlite] close failed:', err)
    }
    _db = null
  }
}

/**
 * Default path for production.
 * Call after app.whenReady() in the main process.
 */
export function defaultDbPath(appDataPath: string): string {
  return join(appDataPath, 'sqlsentinel', 'data.db')
}
