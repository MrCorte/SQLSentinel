# SQL Sentinel — PDF Knowledge Base Pipeline

Converts DBA PDF documents into a searchable Obsidian vault and a SQLite FTS5
database that SQL Sentinel's AI agent queries at runtime.

## Requirements

- Python 3.12+
- SQLite 3.x with FTS5 support (bundled with Python on Windows)

## Installation

```bash
cd knowledge-pipeline
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

## Configuration

Open `config.py` and set the three paths for your environment:

| Variable    | Default                        | Purpose                              |
|-------------|--------------------------------|--------------------------------------|
| `PDF_DIR`   | `C:\DBA\pdfs`                  | Folder containing source PDF files   |
| `VAULT_DIR` | `C:\DBA\vault\wiki\sources`    | Obsidian vault subfolder for .md output |
| `DB_PATH`   | `C:\DBA\knowledge_base.db`     | SQLite database read by SQL Sentinel |

You can also set these via environment variables `KB_PDF_DIR`, `KB_VAULT_DIR`,
and `KB_DB_PATH` without touching the file.

## Usage

### Step 1 — Convert PDFs to Markdown

```bash
# All PDFs in PDF_DIR
python pdf_to_md.py

# Single file
python pdf_to_md.py "C:\DBA\pdfs\AlwaysOn_Guide.pdf"
```

Each PDF becomes a `.md` file in `VAULT_DIR` with YAML frontmatter:

```yaml
---
title: Alwayson Guide
tags: []
type: source
source: C:\DBA\pdfs\AlwaysOn_Guide.pdf
created: 2024-01-15T10:30:00+00:00
updated: 2024-01-15T10:30:00+00:00
---
```

The vault files are plain Markdown — open them in Obsidian, add tags, edit
content, and the watcher will keep the database in sync automatically.

### Step 2 — Populate the SQLite database

```bash
python md_to_sqlite.py
```

Uses MD5 checksums to skip unchanged files. Output:

```
Sync complete — added: 12 | updated: 0 | unchanged: 3 | errors: 0
```

### Step 3 — Start the file watcher (optional, recommended)

```bash
python watcher.py
```

Monitors `VAULT_DIR` in real time. Any `.md` file you create, edit, or delete
is reflected in the database immediately. Press `Ctrl+C` to stop.

### Step 4 — Test FTS5 queries

```bash
python query_test.py "AlwaysOn failover"
python query_test.py "backup strategy" --type runbook
python query_test.py "index fragmentation" --limit 5
python query_test.py "availability group" --db "C:\custom\path\kb.db"
```

## Database schema

### `knowledge_fts` (FTS5 virtual table)

| Column        | Description                              |
|---------------|------------------------------------------|
| `title`       | Document title                           |
| `content`     | Full text (wiki-links stripped)          |
| `tags`        | Comma-separated Obsidian tags            |
| `type`        | Document type (`source`, `runbook`, …)  |
| `source_file` | Original PDF path                        |

### `knowledge_meta` (regular table)

Stores checksums, word counts, and timestamps used for delta sync.

## SQL Sentinel integration

The AI assistant queries the database using:

```sql
SELECT title, content, tags, type, source_file, rank
FROM knowledge_fts
WHERE knowledge_fts MATCH ?
ORDER BY rank
LIMIT 3
```

The `rank` column is the built-in FTS5 BM25 relevance score (lower is better).

## Typical workflow

```
PDF added to PDF_DIR
    ↓
python pdf_to_md.py          (or add .md directly to VAULT_DIR)
    ↓
Edit tags / content in Obsidian
    ↓
python watcher.py            (running in background, auto-syncs)
    ↓
python query_test.py "X"     (verify search results)
    ↓
SQL Sentinel AI agent queries knowledge_base.db at runtime
```
