"""
Import personal DBA script collection into the Obsidian wiki vault.

Reads .md files from SOURCE_DIR, strips the Obsidian-inline #tag header,
adds proper YAML frontmatter (title, tags, type: dba-script), and writes
the result to VAULT_DIR / "DBA Scripts".

Run:
    python import_dba_scripts.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from config import VAULT_DIR, DB_PATH
from md_to_sqlite import sync_vault_to_sqlite

SOURCE_DIR = Path(r"C:\Projects\volt\SQL")
OUTPUT_DIR = VAULT_DIR / "DBA Scripts"

# ---------------------------------------------------------------------------
# Tag inference from content / filename keywords
# ---------------------------------------------------------------------------

_KEYWORD_TAGS: list[tuple[re.Pattern, list[str]]] = [
    (re.compile(r'\btempdb\b', re.I),            ['tempdb']),
    (re.compile(r'\bbackup\b', re.I),            ['backup', 'recovery']),
    (re.compile(r'\bblock', re.I),               ['blocking', 'sessions']),
    (re.compile(r'\bfragment', re.I),            ['index-fragmentation', 'index-maintenance']),
    (re.compile(r'\bmissing.?index\b', re.I),    ['missing-indexes', 'index-tuning']),
    (re.compile(r'\bshrink\b', re.I),            ['shrink', 'storage']),
    (re.compile(r'\bdisk|volume\b', re.I),       ['disk', 'storage']),
    (re.compile(r'\brestore\b', re.I),           ['restore', 'recovery']),
    (re.compile(r'\bseeding\b', re.I),           ['always-on', 'hadr', 'seeding']),
    (re.compile(r'\bstatistics|stats\b', re.I),  ['statistics', 'query-tuning']),
    (re.compile(r'\blogin|permission|grant\b', re.I), ['security', 'logins', 'permissions']),
    (re.compile(r'\bmigra', re.I),               ['migration']),
    (re.compile(r'\borphan\b', re.I),            ['security', 'orphan-users']),
    (re.compile(r'\bjob\b', re.I),               ['sql-agent', 'jobs']),
    (re.compile(r'\bcpu\b', re.I),               ['cpu', 'performance']),
    (re.compile(r'\bmemory\b', re.I),            ['memory', 'performance']),
    (re.compile(r'\bwait\b', re.I),              ['wait-statistics', 'performance']),
    (re.compile(r'\bkpi|collector\b', re.I),     ['kpi', 'monitoring', 'performance']),
    (re.compile(r'\bcluster|failover\b', re.I),  ['clustering', 'high-availability']),
    (re.compile(r'\bndf|mdf|ldf\b', re.I),       ['storage', 'database-files']),
    (re.compile(r'\balias\b', re.I),             ['migration', 'alias']),
    (re.compile(r'\bincremental|incrementali\b', re.I), ['index-maintenance']),
]


def _infer_tags(text: str, filename: str) -> list[str]:
    combined = (filename + ' ' + text).lower()
    tags: list[str] = ['tsql', 'sql-server']
    seen: set[str] = set(tags)
    for pattern, ktags in _KEYWORD_TAGS:
        if pattern.search(combined):
            for t in ktags:
                if t not in seen:
                    tags.append(t)
                    seen.add(t)
    return tags


# ---------------------------------------------------------------------------
# Content normalisation
# ---------------------------------------------------------------------------

# Strip leading bare Obsidian #tag lines (e.g. "#sql-server")
_INLINE_TAG_RE = re.compile(r'^\s*(?:#[\w-]+\s*)+$')


def _strip_inline_tags(text: str) -> str:
    lines = text.splitlines()
    cleaned: list[str] = []
    skipping_tags = True
    for line in lines:
        if skipping_tags and (not line.strip() or _INLINE_TAG_RE.match(line)):
            continue
        skipping_tags = False
        cleaned.append(line)
    return '\n'.join(cleaned).lstrip()


def _make_title(stem: str) -> str:
    """Convert filename stem to a readable title."""
    # capitalise first letter of each word, replace hyphens/underscores
    return stem.replace('-', ' ').replace('_', ' ').title()


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

def convert_file(src: Path, out_dir: Path) -> Path:
    raw = src.read_text(encoding='utf-8', errors='replace')
    body = _strip_inline_tags(raw)
    title = _make_title(src.stem)
    tags = _infer_tags(body, src.stem)
    tags_yaml = '\n'.join(f'  - {t}' for t in tags)

    output = (
        f"---\n"
        f"title: {title}\n"
        f"tags:\n{tags_yaml}\n"
        f"type: dba-script\n"
        f"source: personal-collection\n"
        f"---\n\n"
        f"# {title}\n\n"
        f"{body}"
    )

    out_path = out_dir / f"DBA Script - {src.stem}.md"
    out_path.write_text(output, encoding='utf-8')
    return out_path


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    sources = sorted(SOURCE_DIR.glob('*.md'))
    print(f"Found {len(sources)} scripts in {SOURCE_DIR}")
    print(f"Output -> {OUTPUT_DIR}\n")

    converted = 0
    for src in sources:
        out = convert_file(src, OUTPUT_DIR)
        print(f"  OK  {out.name}")
        converted += 1

    print(f"\nConverted {converted} files. Syncing to SQLite...")
    sync_vault_to_sqlite(VAULT_DIR, DB_PATH)
    print("Done.")
