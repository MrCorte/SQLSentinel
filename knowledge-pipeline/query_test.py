"""
Step 4 — CLI tool for testing FTS5 queries against the knowledge base.

Usage:
    python query_test.py "AlwaysOn failover"
    python query_test.py "backup strategy" --type runbook
    python query_test.py "index fragmentation" --limit 5
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

from colorama import Fore, Style, init as colorama_init

from config import DB_PATH

colorama_init(autoreset=True)

SNIPPET_LEN = 300


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

def search(
    db_path: Path,
    query: str,
    doc_type: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Run an FTS5 full-text search and return matching notes.

    Args:
        db_path:   Path to the SQLite knowledge base.
        query:     FTS5 query string (e.g. ``"AlwaysOn failover"``).
        doc_type:  Optional filter on the ``type`` column (e.g. ``"runbook"``).
        limit:     Maximum number of results to return.

    Returns:
        List of result dicts with keys:
        ``title``, ``type``, ``tags``, ``source_file``, ``content``, ``rank``.

    Raises:
        FileNotFoundError: If *db_path* does not exist.
        sqlite3.OperationalError: If the FTS query is malformed.
    """
    if not db_path.exists():
        raise FileNotFoundError(
            f'Database not found: {db_path}\n'
            'Run md_to_sqlite.py first to populate it.'
        )

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    base_sql = (
        'SELECT title, type, tags, source_file, content, rank '
        'FROM knowledge_fts '
        'WHERE knowledge_fts MATCH ? '
    )
    params: list[str | int] = [query]

    if doc_type:
        base_sql += 'AND type = ? '
        params.append(doc_type)

    base_sql += 'ORDER BY rank LIMIT ?'
    params.append(limit)

    rows = conn.execute(base_sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

def _snippet(content: str, length: int = SNIPPET_LEN) -> str:
    """Return the first *length* characters of *content*, ending at a word boundary."""
    if len(content) <= length:
        return content
    truncated = content[:length]
    last_space = truncated.rfind(' ')
    return (truncated[:last_space] if last_space > 0 else truncated) + '…'


def print_results(results: list[dict], query: str) -> None:
    """Render search results to the terminal with colour.

    Args:
        results: List of result dicts as returned by :func:`search`.
        query:   Original query string (shown in the header).
    """
    if not results:
        print(f'{Fore.YELLOW}No results for: {query!r}')
        return

    print(f'\n{Fore.CYAN}{"─" * 60}')
    print(f'{Fore.CYAN}  {len(results)} result(s) for: {Style.BRIGHT}{query!r}')
    print(f'{Fore.CYAN}{"─" * 60}\n')

    for i, row in enumerate(results, start=1):
        # Title line
        print(
            f'{Fore.GREEN}{Style.BRIGHT}[{i}] {row["title"]}'
            f'{Style.RESET_ALL}'
            f'  {Fore.WHITE}(rank {row["rank"]:.4f})'
        )
        # Metadata
        meta_parts = []
        if row.get('type'):
            meta_parts.append(f'type={row["type"]}')
        if row.get('tags'):
            meta_parts.append(f'tags=[{row["tags"]}]')
        if row.get('source_file'):
            meta_parts.append(f'source={row["source_file"]}')
        if meta_parts:
            print(f'  {Fore.LIGHTBLACK_EX}{" | ".join(meta_parts)}')
        # Content snippet
        snippet = _snippet(row.get('content', ''))
        print(f'  {Style.RESET_ALL}{snippet}')
        print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Parse CLI arguments and run the query."""
    parser = argparse.ArgumentParser(
        description='Test FTS5 queries against the SQL Sentinel knowledge base.',
    )
    parser.add_argument('query', help='Full-text search query string')
    parser.add_argument(
        '--type', dest='doc_type', default=None,
        help='Filter results by document type (e.g. runbook, source)',
    )
    parser.add_argument(
        '--limit', type=int, default=10,
        help='Maximum number of results (default: 10)',
    )
    parser.add_argument(
        '--db', type=Path, default=DB_PATH,
        help=f'Path to knowledge_base.db (default: {DB_PATH})',
    )
    args = parser.parse_args()

    try:
        results = search(
            db_path=args.db,
            query=args.query,
            doc_type=args.doc_type,
            limit=args.limit,
        )
        print_results(results, args.query)
    except FileNotFoundError as exc:
        print(f'{Fore.RED}Error: {exc}', file=sys.stderr)
        sys.exit(1)
    except sqlite3.OperationalError as exc:
        print(f'{Fore.RED}FTS query error: {exc}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
