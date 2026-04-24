"""
Step 2 — Sync Obsidian vault .md notes into a SQLite FTS5 database.

Schema
------
knowledge_fts   (FTS5 virtual table) — full-text search over all notes
knowledge_meta  (regular table)      — metadata + checksums for delta sync
dba_cards_fts   (FTS5 virtual table) — structured DBA reference cards with T-SQL

Usage:
    python md_to_sqlite.py            # sync entire vault
"""

from __future__ import annotations

import hashlib
import logging
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import frontmatter

from config import DB_PATH, VAULT_DIR

logger = logging.getLogger(__name__)

# Regex to strip Obsidian [[WikiLinks]] → plain text
_WIKILINK_RE = re.compile(r'\[\[([^\]]+)\]\]')

# Regexes for extracting structured fields from dba-reference cards
_TSQL_RE = re.compile(r'```sql\s*(.*?)```', re.DOTALL)
_EXPLANATION_RE = re.compile(r'^# .+?\n\n(.+?)\n\n## T-SQL Query', re.DOTALL)
_WHEN_RE = re.compile(r'## When to Use\n\n(.*?)$', re.DOTALL)


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_DDL_FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
USING fts5(
    title,
    content,
    tags,
    type,
    source_file,
    tokenize = 'porter unicode61'
);
"""

# Structured DBA reference card table — stores T-SQL verbatim for accurate retrieval.
# slug and tsql_query are UNINDEXED (stored but not tokenised for search);
# title, tags, explanation, when_to_use are indexed for keyword search.
# BM25 column order for bm25(): 0=slug, 1=title, 2=tags, 3=explanation, 4=tsql_query, 5=when_to_use
_DDL_DBA_CARDS = """
CREATE VIRTUAL TABLE IF NOT EXISTS dba_cards_fts
USING fts5(
    slug        UNINDEXED,
    title,
    tags,
    explanation,
    tsql_query  UNINDEXED,
    when_to_use,
    tokenize = 'porter unicode61'
);
"""

_DDL_META = """
CREATE TABLE IF NOT EXISTS knowledge_meta (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    type        TEXT    NOT NULL DEFAULT '',
    tags        TEXT    NOT NULL DEFAULT '',
    source_file TEXT    NOT NULL DEFAULT '',
    vault_path  TEXT    NOT NULL UNIQUE,
    created     TEXT    NOT NULL DEFAULT '',
    updated     TEXT    NOT NULL DEFAULT '',
    word_count  INTEGER NOT NULL DEFAULT 0,
    checksum_md5 TEXT   NOT NULL
);
"""


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def init_db(db_path: Path) -> sqlite3.Connection:
    """Open (or create) the SQLite database and ensure the schema exists.

    Args:
        db_path: Filesystem path for the .db file.

    Returns:
        Open :class:`sqlite3.Connection` with WAL mode enabled.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    conn.executescript(_DDL_FTS + _DDL_META + _DDL_DBA_CARDS)
    conn.commit()
    logger.debug('Database ready: %s', db_path)
    return conn


def _md5(text: str) -> str:
    """Return the MD5 hex digest of *text* (UTF-8 encoded)."""
    return hashlib.md5(text.encode('utf-8')).hexdigest()


def _strip_wikilinks(text: str) -> str:
    """Replace ``[[Target|Alias]]`` or ``[[Target]]`` with plain text.

    Args:
        text: Markdown content possibly containing Obsidian wiki-links.

    Returns:
        Text with wiki-link syntax removed, display text preserved.
    """
    return _WIKILINK_RE.sub(lambda m: m.group(1).split('|')[-1], text)


def _parse_note(md_path: Path) -> dict[str, Any] | None:
    """Parse a Markdown file into a dict ready for DB insert.

    Args:
        md_path: Path to the .md file.

    Returns:
        Parsed note dict, or *None* if the file cannot be read.
    """
    try:
        raw = md_path.read_text(encoding='utf-8')
    except OSError as exc:
        logger.error('Cannot read %s: %s', md_path, exc)
        return None

    try:
        post = frontmatter.loads(raw)
    except Exception as exc:
        logger.error('Frontmatter parse error in %s: %s', md_path, exc)
        return None

    tags_raw = post.get('tags', [])
    tags_str = ', '.join(tags_raw) if isinstance(tags_raw, list) else str(tags_raw)
    clean_content = _strip_wikilinks(post.content)
    word_count = len(clean_content.split())

    return {
        'title': str(post.get('title', md_path.stem)),
        'type': str(post.get('type', '')),
        'tags': tags_str,
        'source_file': str(post.get('source', '')),
        'vault_path': str(md_path),
        'created': str(post.get('created', '')),
        'updated': str(post.get('updated', '')),
        'word_count': word_count,
        'content': clean_content,
        'checksum_md5': _md5(raw),
    }


def _upsert_note(conn: sqlite3.Connection, note: dict[str, Any]) -> str:
    """Insert or update a note in both tables.

    Args:
        conn: Open database connection.
        note: Parsed note dict from :func:`_parse_note`.

    Returns:
        ``'added'``, ``'updated'``, or ``'unchanged'``.
    """
    row = conn.execute(
        'SELECT id, checksum_md5 FROM knowledge_meta WHERE vault_path = ?',
        (note['vault_path'],),
    ).fetchone()

    if row is None:
        # --- INSERT ---
        conn.execute(
            '''INSERT INTO knowledge_meta
               (title, type, tags, source_file, vault_path,
                created, updated, word_count, checksum_md5)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                note['title'], note['type'], note['tags'], note['source_file'],
                note['vault_path'], note['created'], note['updated'],
                note['word_count'], note['checksum_md5'],
            ),
        )
        conn.execute(
            'INSERT INTO knowledge_fts (title, content, tags, type, source_file) '
            'VALUES (?, ?, ?, ?, ?)',
            (note['title'], note['content'], note['tags'],
             note['type'], note['source_file']),
        )
        return 'added'

    meta_id, stored_checksum = row
    if stored_checksum == note['checksum_md5']:
        return 'unchanged'

    # --- UPDATE ---
    conn.execute(
        '''UPDATE knowledge_meta SET
           title=?, type=?, tags=?, source_file=?, updated=?,
           word_count=?, checksum_md5=?
           WHERE id=?''',
        (
            note['title'], note['type'], note['tags'], note['source_file'],
            note['updated'], note['word_count'], note['checksum_md5'],
            meta_id,
        ),
    )
    # FTS5 does not support UPDATE — delete + reinsert
    conn.execute(
        "DELETE FROM knowledge_fts WHERE source_file = ?",
        (note['source_file'],),
    )
    conn.execute(
        'INSERT INTO knowledge_fts (title, content, tags, type, source_file) '
        'VALUES (?, ?, ?, ?, ?)',
        (note['title'], note['content'], note['tags'],
         note['type'], note['source_file']),
    )
    return 'updated'


def delete_note(conn: sqlite3.Connection, vault_path: str) -> bool:
    """Remove a note from both tables by its vault path.

    Args:
        conn:       Open database connection.
        vault_path: Absolute path to the .md file that was deleted.

    Returns:
        *True* if the note existed and was removed, *False* otherwise.
    """
    row = conn.execute(
        'SELECT id, source_file FROM knowledge_meta WHERE vault_path = ?',
        (vault_path,),
    ).fetchone()
    if row is None:
        return False

    meta_id, source_file = row
    conn.execute('DELETE FROM knowledge_meta WHERE id = ?', (meta_id,))
    conn.execute('DELETE FROM knowledge_fts WHERE source_file = ?', (source_file,))
    conn.commit()
    logger.info('Removed from DB: %s', vault_path)
    return True


# ---------------------------------------------------------------------------
# Sync functions
# ---------------------------------------------------------------------------

def _rebuild_dba_cards_fts(conn: sqlite3.Connection, vault_dir: Path) -> int:
    """Drop and rebuild dba_cards_fts from all dba-reference markdown files.

    Called at the end of every vault sync so the structured T-SQL table
    is always consistent with the markdown source files.

    Args:
        conn:      Open database connection.
        vault_dir: Root of the Obsidian vault to walk.

    Returns:
        Number of DBA reference cards indexed.
    """
    conn.execute('DELETE FROM dba_cards_fts')
    count = 0

    for md_path in vault_dir.rglob('*.md'):
        try:
            raw = md_path.read_text(encoding='utf-8', errors='replace')
            post = frontmatter.loads(raw)
        except Exception:
            continue

        if post.get('type') != 'dba-reference':
            continue
        source = str(post.get('source', ''))
        if not source.startswith('dba-reference/'):
            continue

        slug = source.split('/')[-1]
        title = str(post.get('title', md_path.stem))
        tags_raw = post.get('tags', [])
        tags_str = ', '.join(tags_raw) if isinstance(tags_raw, list) else str(tags_raw)
        content = post.content

        tsql_match = _TSQL_RE.search(content)
        if not tsql_match:
            continue

        exp_match = _EXPLANATION_RE.search(content)
        when_match = _WHEN_RE.search(content)

        conn.execute(
            'INSERT INTO dba_cards_fts '
            '(slug, title, tags, explanation, tsql_query, when_to_use) '
            'VALUES (?, ?, ?, ?, ?, ?)',
            (
                slug,
                title,
                tags_str,
                exp_match.group(1).strip() if exp_match else '',
                tsql_match.group(1).strip(),
                when_match.group(1).strip() if when_match else '',
            ),
        )
        count += 1

    conn.commit()
    return count


def sync_vault_to_sqlite(vault_dir: Path, db_path: Path) -> None:
    """Sync all .md files in *vault_dir* (recursively) into the database.

    Uses MD5 checksums to skip unchanged files.

    Args:
        vault_dir: Root of the Obsidian vault (or sub-folder) to walk.
        db_path:   Path to the SQLite database.

    Raises:
        FileNotFoundError: If *vault_dir* does not exist.
    """
    if not vault_dir.exists():
        raise FileNotFoundError(f'Vault directory not found: {vault_dir}')

    conn = init_db(db_path)
    counts = {'added': 0, 'updated': 0, 'unchanged': 0, 'errors': 0}

    md_files = list(vault_dir.rglob('*.md'))
    logger.info('Found %d .md files in %s', len(md_files), vault_dir)

    for md_path in md_files:
        note = _parse_note(md_path)
        if note is None:
            counts['errors'] += 1
            continue
        status = _upsert_note(conn, note)
        counts[status] += 1

    n_dba = _rebuild_dba_cards_fts(conn, vault_dir)

    conn.commit()
    conn.close()

    logger.info(
        'Sync complete — added: %d | updated: %d | unchanged: %d | errors: %d | dba_cards: %d',
        counts['added'], counts['updated'], counts['unchanged'], counts['errors'], n_dba,
    )


def sync_single_note(md_path: Path, db_path: Path) -> None:
    """Sync a single .md file into the database (used by the watcher).

    Args:
        md_path:  Path to the .md file that was created or modified.
        db_path:  Path to the SQLite database.
    """
    conn = init_db(db_path)
    note = _parse_note(md_path)
    if note is not None:
        status = _upsert_note(conn, note)
        conn.commit()
        logger.info('[sync_single_note] %s → %s', md_path.name, status)
    conn.close()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    sync_vault_to_sqlite(VAULT_DIR, DB_PATH)
