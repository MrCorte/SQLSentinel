#!/usr/bin/env python3
"""
PDF → Obsidian Wiki via Ollama glm-ocr
Processes PDFs page-by-page, organizes by TOC chapters, saves progress.
Usage: python3 pdf_to_wiki.py [--pdf <path>] [--resume] [--dpi 150]
"""

import argparse
import base64
import io
import json
import os
import re
import time
from pathlib import Path

import fitz  # PyMuPDF
import requests
from PIL import Image

OLLAMA_URL = "http://localhost:11434/api/generate"
WIKI_DIR = Path("/Users/andreacortesi/Documents/Projects/Obsidian/wiki")
DATA_DIR = Path("/Users/andreacortesi/Documents/Projects/DEV/SQLSentinel/data")
PROGRESS_DIR = Path("/tmp/pdf_wiki_progress")

PDFS = [
    DATA_DIR / "SQL Server DMVs in Action.pdf",
    DATA_DIR / "Pro SQL Server 2019 Administration, 2nd Edition.pdf",
]

OCR_PROMPT = (
    "You are an OCR engine. Extract ALL text from this image exactly as it appears. "
    "Format output as Markdown: use # for main titles, ## for section headers, "
    "### for subsections, ``` for code blocks (detect SQL/code automatically), "
    "| tables | as | markdown |, and - for bullet lists. "
    "Output ONLY the extracted content, no explanations."
)


def page_to_base64(page, dpi: int = 150) -> str:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def ocr_page(img_b64: str, retries: int = 3) -> str:
    payload = {
        "model": "glm-ocr:latest",
        "prompt": OCR_PROMPT,
        "images": [img_b64],
        "stream": False,
        "options": {"temperature": 0.1},
    }
    for attempt in range(retries):
        try:
            r = requests.post(OLLAMA_URL, json=payload, timeout=120)
            r.raise_for_status()
            return r.json().get("response", "").strip()
        except Exception as e:
            if attempt == retries - 1:
                return f"<!-- OCR failed: {e} -->"
            time.sleep(2)
    return ""


def slugify(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s_-]+", "-", text).strip("-")[:60]


def build_chapter_map(toc: list, total_pages: int) -> list[dict]:
    """
    Build wiki chapters from TOC. Uses level-2 entries when a level-1 entry
    contains sub-chapters (i.e. next same-level entry is far away). Falls back
    to level-1 for short front/back matter sections.
    """
    if not toc:
        return [{"title": "Content", "start": 0, "end": total_pages - 1, "level": 1}]

    # Collect all entries with their end pages
    entries = []
    for i, (level, title, page) in enumerate(toc):
        if page <= 0:
            continue
        # Find end page: next entry at same or higher level (lower number)
        end = total_pages
        for j in range(i + 1, len(toc)):
            if toc[j][0] <= level and toc[j][2] > 0:
                end = toc[j][2] - 1
                break
        entries.append({"title": title, "level": level, "start": page - 1, "end": end - 1})

    # Use level-2 entries if they exist; fall back to level-1 for sections without children
    level1 = [e for e in entries if e["level"] == 1]
    level2 = [e for e in entries if e["level"] == 2]

    if not level2:
        return level1

    result = []
    for l1 in level1:
        children = [e for e in level2 if l1["start"] <= e["start"] <= l1["end"]]
        if children:
            result.extend(children)
        else:
            result.append(l1)

    return result


def load_progress(pdf_name: str) -> dict:
    path = PROGRESS_DIR / f"{slugify(pdf_name)}.json"
    if path.exists():
        return json.loads(path.read_text())
    return {"completed_pages": {}, "chapter_texts": {}}


def save_progress(pdf_name: str, progress: dict):
    PROGRESS_DIR.mkdir(exist_ok=True)
    path = PROGRESS_DIR / f"{slugify(pdf_name)}.json"
    path.write_text(json.dumps(progress, ensure_ascii=False, indent=2))


def write_wiki_page(book_dir: Path, chapter_title: str, content: str, chapter_num: int):
    filename = f"{chapter_num:02d} - {slugify(chapter_title)}.md"
    filepath = book_dir / filename
    header = f"# {chapter_title}\n\n"
    filepath.write_text(header + content, encoding="utf-8")
    print(f"  → Written: {filename}")


def process_pdf(pdf_path: Path, dpi: int = 150, resume: bool = True):
    print(f"\n{'='*60}")
    print(f"Processing: {pdf_path.name}")
    print(f"{'='*60}")

    pdf = fitz.open(pdf_path)
    toc = pdf.get_toc()
    total = len(pdf)
    print(f"Pages: {total} | TOC entries: {len(toc)}")

    chapters = build_chapter_map(toc, total)
    if not chapters:
        # Fallback: treat whole book as one chapter
        chapters = [{"title": pdf_path.stem, "start": 0, "end": total - 1}]
    print(f"Chapters: {len(chapters)}")

    book_dir = WIKI_DIR / slugify(pdf_path.stem)
    book_dir.mkdir(parents=True, exist_ok=True)

    progress = load_progress(pdf_path.name) if resume else {"completed_pages": {}, "chapter_texts": {}}

    for ch_idx, chapter in enumerate(chapters):
        ch_title = chapter["title"]
        ch_key = str(ch_idx)
        start, end = chapter["start"], chapter["end"]
        page_count = end - start + 1

        print(f"\n[{ch_idx+1}/{len(chapters)}] {ch_title} (pages {start+1}-{end+1}, {page_count} pgs)")

        if ch_key not in progress["chapter_texts"]:
            progress["chapter_texts"][ch_key] = ""

        for pg_num in range(start, end + 1):
            pg_key = str(pg_num)
            if pg_key in progress["completed_pages"]:
                continue

            page = pdf[pg_num]
            img_b64 = page_to_base64(page, dpi)
            text = ocr_page(img_b64)

            progress["chapter_texts"][ch_key] += f"\n\n{text}"
            progress["completed_pages"][pg_key] = True

            done = len(progress["completed_pages"])
            print(f"  Page {pg_num+1}/{total} ({done} total done)", end="\r")
            save_progress(pdf_path.name, progress)

        # Write wiki page for this chapter
        write_wiki_page(book_dir, ch_title, progress["chapter_texts"][ch_key].strip(), ch_idx + 1)

    # Write index file
    index_lines = [f"# {pdf_path.stem}\n"]
    index_lines.append(f"**Source:** `{pdf_path.name}`\n")
    index_lines.append(f"**Pages:** {total}\n\n## Chapters\n")
    for i, ch in enumerate(chapters):
        fname = f"{i+1:02d} - {slugify(ch['title'])}"
        index_lines.append(f"- [[{fname}|{ch['title']}]]")
    (book_dir / "00 - index.md").write_text("\n".join(index_lines), encoding="utf-8")
    print(f"\n  → Written: 00 - index.md")

    pdf.close()
    print(f"\nDone: {pdf_path.name}")


def main():
    parser = argparse.ArgumentParser(description="PDF → Obsidian wiki via glm-ocr")
    parser.add_argument("--pdf", help="Single PDF path (default: all in data/)")
    parser.add_argument("--dpi", type=int, default=150, help="Render DPI (default: 150)")
    parser.add_argument("--no-resume", action="store_true", help="Restart from scratch")
    parser.add_argument("--dry-run", action="store_true", help="Show plan, no OCR")
    args = parser.parse_args()

    pdfs = [Path(args.pdf)] if args.pdf else PDFS

    if args.dry_run:
        for pdf_path in pdfs:
            pdf = fitz.open(pdf_path)
            toc = pdf.get_toc()
            chapters = build_chapter_map(toc, len(pdf))
            print(f"\n{pdf_path.name}")
            print(f"  Pages: {len(pdf)}, Chapters: {len(chapters)}")
            for i, ch in enumerate(chapters[:10]):
                print(f"  [{i+1}] {ch['title']} (p{ch['start']+1}–{ch['end']+1})")
            if len(chapters) > 10:
                print(f"  ... and {len(chapters)-10} more")
            pdf.close()
        return

    WIKI_DIR.mkdir(parents=True, exist_ok=True)
    for pdf_path in pdfs:
        process_pdf(pdf_path, dpi=args.dpi, resume=not args.no_resume)

    print(f"\nWiki at: {WIKI_DIR}")


if __name__ == "__main__":
    main()
