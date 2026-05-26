#!/usr/bin/env python3
"""
Ingest embeddings for all wiki chunks already in knowledge_base.db.
Uses Ollama nomic-embed-text (768-dim) for local, offline embeddings.

Idempotency: tracked at (title, chunk_idx) level. Safe to re-run after crash.
Use --reset to force full re-embed (e.g. after switching embedding models).

Scale: ~8,300 chunks, ~519 batches of 16. Expect 8-10 minutes on first run.

Usage:
    python3 ingest_embeddings.py [--reset]
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import struct
import time
from pathlib import Path

import httpx

from config import DB_PATH

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)-8s %(message)s')

OLLAMA_EMBED_URL = "http://127.0.0.1:11434/api/embed"
EMBED_MODEL = "nomic-embed-text"
BATCH_SIZE = 16
CHUNK_SIZE = 600  # characters per chunk when splitting long content
CHUNK_OVERLAP = 100  # trailing chars of chunk N prepended to chunk N+1 — preserves
                    #   context across boundaries (e.g. T-SQL queries split mid-statement)

DDL = """
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT NOT NULL,
    chunk_idx INTEGER NOT NULL DEFAULT 0,
    text      TEXT NOT NULL,
    embedding BLOB NOT NULL,
    UNIQUE(title, chunk_idx)
);
CREATE INDEX IF NOT EXISTS idx_ke_title ON knowledge_embeddings(title);
"""


def pack_embedding(vec: list[float]) -> bytes:
    return struct.pack(f'{len(vec)}f', *vec)


def split_chunks(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    raw: list[str] = []
    current = ""
    for para in paragraphs:
        if len(current) + len(para) > size and current:
            raw.append(current.strip())
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        raw.append(current.strip())
    if not raw:
        return [text[:size]]

    # Prepend the trailing `overlap` chars of chunk N to chunk N+1 so semantic
    # context (e.g. mid-paragraph T-SQL) isn't lost at the boundary.
    if overlap <= 0 or len(raw) == 1:
        return raw
    out = [raw[0]]
    for i in range(1, len(raw)):
        tail = raw[i - 1][-overlap:]
        out.append(f"{tail}\n\n{raw[i]}")
    return out


def embed_batch(texts: list[str]) -> list[list[float]]:
    resp = httpx.post(
        OLLAMA_EMBED_URL,
        json={"model": EMBED_MODEL, "input": texts},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["embeddings"]


def ingest(db_path: Path, reset: bool = False) -> None:
    conn = sqlite3.connect(db_path)
    try:
        if reset:
            conn.execute("DROP TABLE IF EXISTS knowledge_embeddings")
            logger.info("Dropped existing knowledge_embeddings table.")

        conn.executescript(DDL)
        conn.commit()

        # Load all wiki content — all types are valid sources for embedding
        rows = conn.execute(
            "SELECT title, content FROM knowledge_fts"
        ).fetchall()

        logger.info("Found %d documents to embed.", len(rows))

        # Build flat list of (title, chunk_idx, chunk_text)
        all_chunks: list[tuple[str, int, str]] = []
        for title, content in rows:
            for i, chunk in enumerate(split_chunks(content)):
                all_chunks.append((title, i, chunk))

        # Filter out chunks already embedded (idempotency at chunk level)
        existing = {
            (r[0], r[1])
            for r in conn.execute("SELECT title, chunk_idx FROM knowledge_embeddings").fetchall()
        }
        to_embed = [(t, i, c) for t, i, c in all_chunks if (t, i) not in existing]

        logger.info(
            "Total chunks: %d | Already embedded: %d | To embed: %d",
            len(all_chunks), len(existing), len(to_embed)
        )

        if not to_embed:
            logger.info("Nothing to do.")
            return

        for batch_start in range(0, len(to_embed), BATCH_SIZE):
            batch = to_embed[batch_start:batch_start + BATCH_SIZE]
            texts = [c[2] for c in batch]

            try:
                embeddings = embed_batch(texts)
            except Exception as e:
                logger.error("Embedding batch %d failed: %s — skipping", batch_start, e)
                time.sleep(2)
                continue

            if len(embeddings) != len(texts):
                logger.error("Ollama returned %d embeddings for %d texts — skipping batch", len(embeddings), len(texts))
                continue

            rows_to_insert = [
                (title, chunk_idx, text, pack_embedding(emb))
                for (title, chunk_idx, text), emb in zip(batch, embeddings)
            ]
            # INSERT OR IGNORE: skips rows whose (title, chunk_idx) already exists.
            # If you need to refresh embeddings (e.g. after changing the model or
            # chunk strategy), re-run with --reset to drop and rebuild the table.
            conn.executemany(
                "INSERT OR IGNORE INTO knowledge_embeddings (title, chunk_idx, text, embedding) VALUES (?, ?, ?, ?)",
                rows_to_insert,
            )
            conn.commit()

            done = min(batch_start + BATCH_SIZE, len(to_embed))
            logger.info("Progress: %d / %d chunks", done, len(to_embed))

        logger.info("Ingestion complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="Drop and recreate embeddings table")
    args = parser.parse_args()
    ingest(DB_PATH, reset=args.reset)
