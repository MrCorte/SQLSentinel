"""
Step 3 — File watcher: auto-sync vault changes to SQLite in real time.

Monitors VAULT_DIR recursively via watchdog.
  - .md created or modified  → sync_single_note()
  - .md deleted              → delete_note()

Usage:
    python watcher.py
    Press Ctrl+C to stop.
"""

from __future__ import annotations

import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from watchdog.events import (
    FileCreatedEvent,
    FileDeletedEvent,
    FileModifiedEvent,
    FileMovedEvent,
    FileSystemEvent,
    FileSystemEventHandler,
)
from watchdog.observers import Observer

from config import DB_PATH, VAULT_DIR
from md_to_sqlite import delete_note, init_db, sync_single_note

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event handler
# ---------------------------------------------------------------------------

class VaultEventHandler(FileSystemEventHandler):
    """React to file-system events in the Obsidian vault."""

    def __init__(self, db_path: Path) -> None:
        """
        Args:
            db_path: Path to the SQLite database to keep in sync.
        """
        super().__init__()
        self._db_path = db_path

    def _ts(self) -> str:
        return datetime.now(tz=timezone.utc).strftime('%H:%M:%S')

    def _is_md(self, path: str) -> bool:
        return path.lower().endswith('.md')

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory or not self._is_md(str(event.src_path)):
            return
        md_path = Path(str(event.src_path))
        logger.info('[%s] CREATED  %s', self._ts(), md_path.name)
        try:
            sync_single_note(md_path, self._db_path)
        except Exception as exc:
            logger.error('Error syncing %s: %s', md_path.name, exc)

    def on_modified(self, event: FileSystemEvent) -> None:
        if event.is_directory or not self._is_md(str(event.src_path)):
            return
        md_path = Path(str(event.src_path))
        logger.info('[%s] MODIFIED %s', self._ts(), md_path.name)
        try:
            sync_single_note(md_path, self._db_path)
        except Exception as exc:
            logger.error('Error syncing %s: %s', md_path.name, exc)

    def on_deleted(self, event: FileSystemEvent) -> None:
        if event.is_directory or not self._is_md(str(event.src_path)):
            return
        vault_path = str(event.src_path)
        logger.info('[%s] DELETED  %s', self._ts(), Path(vault_path).name)
        try:
            conn = init_db(self._db_path)
            removed = delete_note(conn, vault_path)
            conn.close()
            if not removed:
                logger.debug('Not in DB (already absent): %s', vault_path)
        except Exception as exc:
            logger.error('Error removing %s: %s', vault_path, exc)

    def on_moved(self, event: FileMovedEvent) -> None:
        """Handle renames: remove old path, sync new path if it's .md."""
        if event.is_directory:
            return
        src, dst = str(event.src_path), str(event.dest_path)
        logger.info('[%s] MOVED    %s → %s', self._ts(),
                    Path(src).name, Path(dst).name)

        # Remove old entry if it was a .md
        if self._is_md(src):
            try:
                conn = init_db(self._db_path)
                delete_note(conn, src)
                conn.close()
            except Exception as exc:
                logger.error('Error removing old path %s: %s', src, exc)

        # Sync new entry if it's a .md
        if self._is_md(dst):
            try:
                sync_single_note(Path(dst), self._db_path)
            except Exception as exc:
                logger.error('Error syncing new path %s: %s', dst, exc)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Start the vault watcher and block until Ctrl+C."""
    if not VAULT_DIR.exists():
        logger.error('Vault directory does not exist: %s', VAULT_DIR)
        sys.exit(1)

    logger.info('Watching  %s', VAULT_DIR)
    logger.info('Database  %s', DB_PATH)
    logger.info('Press Ctrl+C to stop.\n')

    handler = VaultEventHandler(db_path=DB_PATH)
    observer = Observer()
    observer.schedule(handler, str(VAULT_DIR), recursive=True)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info('Stopping watcher…')
    finally:
        observer.stop()
        observer.join()
        logger.info('Watcher stopped.')


if __name__ == '__main__':
    main()
