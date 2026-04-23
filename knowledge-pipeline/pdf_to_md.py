"""
Step 1 — PDF → Atomic Obsidian Notes with WikiLinks (knowledge network).

Each PDF is split into one note per chapter/major section plus a MOC
(Map of Content) index note.  After all notes are written, a cross-link
pass scans every note for mentions of sibling note titles and converts
them to [[WikiLinks]] so Obsidian's graph view shows a real network.

Usage:
    python pdf_to_md.py                     # process all PDFs in PDF_DIR
    python pdf_to_md.py path/to/file.pdf    # single file
"""

from __future__ import annotations

import logging
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import frontmatter
import pymupdf4llm

from config import PDF_DIR, VAULT_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config — tweak if needed
# ---------------------------------------------------------------------------

# Minimum characters a section must have to become its own note
MIN_SECTION_CHARS = 300

# Minimum title length for auto-linking (avoids spurious matches on short words)
MIN_LINK_TITLE_LEN = 12

# Book abbreviations used as filename prefix (key = lowercase substring of PDF stem)
_ABBREV: dict[str, str] = {
    'analytics': 'AE',
    'advanced troubleshooting': 'SS',
    'dmvs in action': 'DMV',
    'dmv': 'DMV',
    'teach yourself sql': 'SQL24',
    'pro sql server': 'PSS',
}

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Section:
    """A single chapter / major section extracted from a PDF."""
    title: str           # clean title text
    content: str         # markdown body (no frontmatter yet)
    chapter_num: int     # sequential index within the book (1-based)
    book_title: str      # human-readable book name
    book_abbrev: str     # short prefix, e.g. "SS"
    source_pdf: str      # original PDF path

    @property
    def note_filename(self) -> str:
        """Filename (no extension) for this note, e.g. ``SS - 03 tempdb Configuration``."""
        safe_title = _sanitize_filename(self.title)
        return f'{self.book_abbrev} - {self.chapter_num:02d} {safe_title}'

    @property
    def link_target(self) -> str:
        """The string used inside ``[[...]]``, equal to ``note_filename``."""
        return self.note_filename


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_filename(name: str) -> str:
    """Strip characters invalid on Windows/macOS/Linux from a filename stem."""
    sanitized = re.sub(r'[\\/:*?"<>|]', ' ', name)
    sanitized = re.sub(r'\s+', ' ', sanitized).strip()
    return sanitized or 'untitled'


def _clean_heading_text(raw: str) -> str:
    """Strip markdown markup (``**``, ``_``, leading ``#``) from a heading line."""
    text = re.sub(r'^#+\s*', '', raw)          # remove leading #
    text = re.sub(r'\*+', '', text)            # remove bold markers
    text = re.sub(r'(?<!\w)_+|_+(?!\w)', '', text)  # remove lone underscore markup
    text = re.sub(r'`', '', text)              # remove code backticks
    return text.strip()


def _normalize_title_case(text: str) -> str:
    """Normalize titles produced by decorative small-caps fonts.

    PDFs that use small-caps or mixed-case decorative fonts produce headings
    like ``PLANNiNG ThE DEPLoyMENT``.  When more than 25 % of non-initial
    characters in a multi-word title are uppercase, the title is converted
    to Python ``str.title()`` form.
    """
    words = text.split()
    if len(words) < 2:
        return text
    non_initial_upper = sum(1 for w in words for c in w[1:] if c.isupper())
    non_initial_total = sum(max(0, len(w) - 1) for w in words)
    if non_initial_total > 0 and non_initial_upper / non_initial_total > 0.25:
        return text.title()
    return text


def _book_abbrev(pdf_stem: str) -> str:
    """Return a short uppercase abbreviation for the book."""
    lower = pdf_stem.lower()
    for key, abbrev in _ABBREV.items():
        if key in lower:
            return abbrev
    # Fallback: first letters of first three words
    words = re.split(r'\W+', pdf_stem)
    return ''.join(w[0].upper() for w in words[:3] if w)


def _book_human_title(pdf_stem: str) -> str:
    """Derive a readable book title from the PDF stem."""
    # Strip publisher suffixes like "(Z-Library)" or "(Dmitri Korotkevitch)"
    title = re.sub(r'\s*\([^)]+\)', '', pdf_stem).strip()
    title = re.sub(r'[_\-]+', ' ', title)
    return title.strip()


# ---------------------------------------------------------------------------
# PDF splitter
# ---------------------------------------------------------------------------

# Matches "## CHAPTER 1 Title" and "## **CHAPTER 1** Title" variants.
# Group 1 = chapter number, Group 2 = raw title text.
_CHAPTER_RE = re.compile(
    r'^#{1,2}\s+(?:\*+)?CHAPTER\s+(\d+)(?:\*+)?\s+(.+)',
    re.IGNORECASE | re.MULTILINE,
)

# Fallback for books that use "## 1 Title" style (DMVs book Part/Chapter headings)
# Only match top-level numbered sections, not subsections like "1.1"
_NUMBERED_CHAPTER_RE = re.compile(
    r'^#{1,2}\s+_?\*?\*?(\d+)\*?\*?_?\s+([A-Z][^\n]{8,})',
    re.MULTILINE,
)

# Fallback for books with plain ## Chapter headings (no CHAPTER keyword)
# Matches headings that look like chapter titles (capitalised, >10 chars)
_PART_RE = re.compile(
    r'^# \s*(?:\*+)?_?([A-Z][^\n]{5,})_?(?:\*+)?\s*$',
    re.MULTILINE,
)

# Strategy 4: "X.1 Title" — first subsection of each chapter marks the chapter boundary.
# Used by books like "SQL Server DMVs in Action" that use _1.1 Title_, _2.1 Title_ style.
_XDOT1_RE = re.compile(
    r'^## _(\d+)\.1\s+([^_\n]{5,}?)_?\s*$',
    re.MULTILINE,
)

# Strategy 5: "Hour N Title" / "Lesson N Title" — tutorial-style books (e.g. Sams 24 Hours).
_HOUR_RE = re.compile(
    r'^#{1,2}\s+(?:Hour|Lesson|Session|Part)\s+(\d+)[:\s]+([^\n]{5,})',
    re.IGNORECASE | re.MULTILINE,
)


def _clean_chapter_title(raw: str) -> str:
    """Strip markdown, 'CHAPTER N' prefix, and normalise case artifacts."""
    text = _clean_heading_text(raw)
    # Remove leading "CHAPTER N " or "Hour N " if somehow still present
    text = re.sub(r'^(?:CHAPTER|Hour|Lesson|Session|Part)\s+\d+[:\s]+', '', text, flags=re.IGNORECASE)
    text = _normalize_title_case(text)
    return text.strip()


def _merge_same_title_sections(sections: list[Section]) -> list[Section]:
    """Merge consecutive sections that share the same normalised title.

    Books with decorative fonts produce dozens of identically-named sections
    (e.g. 15 × "GUI Installation") that all belong to the same chapter.
    Merging them produces one note per real chapter with complete content.
    Chapter numbers are reassigned after merging.
    """
    if not sections:
        return []

    merged: list[Section] = []
    for s in sections:
        if merged and s.title.lower() == merged[-1].title.lower():
            merged[-1].content += '\n\n' + s.content
        else:
            merged.append(s)

    for i, s in enumerate(merged):
        s.chapter_num = i + 1

    return merged


def _split_sections(md_text: str, book_title: str, book_abbrev: str,
                    source_pdf: str) -> list[Section]:
    """Split a full-PDF markdown string into chapter-level :class:`Section` objects.

    Each section contains the full chapter content (all subsections included).
    Strategies tried in order:
      1. ``## CHAPTER N Title`` headings (most O'Reilly books).
      2. ``## N Title`` top-level numbered sections.
      3. ``# Title`` H1 headings.
      4. ``## N.1 Title`` first-subsection markers (DMVs-style books).
      5. ``## Hour N Title`` / ``## Lesson N Title`` (tutorial books).

    After splitting, consecutive sections with the same title are merged into
    one note (handles decorative-font books that repeat chapter headings).

    Args:
        md_text:     Full markdown text from pymupdf4llm.
        book_title:  Human-readable book name.
        book_abbrev: Short abbreviation prefix.
        source_pdf:  Original PDF path string.

    Returns:
        List of :class:`Section`, one per chapter (empty if nothing found).
    """
    # Try each strategy in order; use the first that finds at least 1 result.
    # --- Strategy 1: explicit CHAPTER keyword ---
    matches = [(m.start(), m.group(2), 'chapter') for m in _CHAPTER_RE.finditer(md_text)]

    # --- Strategy 2: numbered top-level sections ---
    if not matches:
        logger.debug('%s: no CHAPTER headings, trying numbered-chapter fallback', book_title)
        matches = [(m.start(), m.group(2), 'numbered') for m in _NUMBERED_CHAPTER_RE.finditer(md_text)]

    # --- Strategy 3: H1 headings ---
    if not matches:
        logger.debug('%s: trying H1 fallback', book_title)
        matches = [(m.start(), m.group(1), 'h1') for m in _PART_RE.finditer(md_text)]

    # --- Strategy 4: X.1 numbered section start (DMVs-style books) ---
    if not matches:
        logger.debug('%s: trying X.1 section-start fallback', book_title)
        matches = [(m.start(), m.group(2), 'xdot1') for m in _XDOT1_RE.finditer(md_text)]

    # --- Strategy 5: Hour/Lesson N headings (tutorial books) ---
    if not matches:
        logger.debug('%s: trying Hour/Lesson heading fallback', book_title)
        matches = [(m.start(), m.group(2), 'hour') for m in _HOUR_RE.finditer(md_text)]

    if not matches:
        logger.warning('%s: no chapter boundaries found', book_title)
        return []

    # Words that indicate front-matter / back-matter — skip these sections
    _SKIP = {
        'table of contents', 'revision history', 'preface', 'colophon',
        'cover', 'acknowledgment', 'index', 'bibliography', 'about the author',
        'about the cover', 'who this book is for', 'overview of the chapters',
        'conventions used', 'using code examples', "o'reilly", 'how to contact',
        'brief contents', 'contents',
    }

    sections: list[Section] = []
    for i, (start_pos, raw_title, _kind) in enumerate(matches):
        # Content runs from end-of-heading to start of next heading
        next_start = matches[i + 1][0] if i + 1 < len(matches) else len(md_text)
        # Find end of the heading line
        heading_end = md_text.index('\n', start_pos) + 1 if '\n' in md_text[start_pos:] else start_pos
        content = md_text[heading_end:next_start].strip()

        if len(content) < MIN_SECTION_CHARS:
            continue

        title = _clean_chapter_title(raw_title)

        if any(skip in title.lower() for skip in _SKIP):
            continue

        sections.append(Section(
            title=title,
            content=content,
            chapter_num=len(sections) + 1,
            book_title=book_title,
            book_abbrev=book_abbrev,
            source_pdf=source_pdf,
        ))

    return _merge_same_title_sections(sections)


# ---------------------------------------------------------------------------
# Note writer
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec='seconds')


def _write_section_note(section: Section, output_dir: Path) -> Path:
    """Serialise a :class:`Section` to a Markdown file with YAML frontmatter.

    Args:
        section:    The section to write.
        output_dir: Destination directory.

    Returns:
        Path to the written file.
    """
    now = _now_iso()
    post = frontmatter.Post(
        content=f'# {section.title}\n\n{section.content}',
        title=section.title,
        tags=[section.book_abbrev.lower(), 'sql-server'],
        type='source',
        book=section.book_title,
        chapter=section.chapter_num,
        source=section.source_pdf,
        created=now,
        updated=now,
    )
    out_path = output_dir / f'{section.note_filename}.md'
    out_path.write_text(frontmatter.dumps(post), encoding='utf-8')
    return out_path


def _write_moc(sections: list[Section], book_title: str, book_abbrev: str,
               source_pdf: str, output_dir: Path) -> Path:
    """Create a Map of Content (index) note that links all chapter notes.

    Args:
        sections:   All sections belonging to this book.
        book_title: Human-readable book name.
        book_abbrev: Short abbreviation.
        source_pdf: Original PDF path.
        output_dir: Destination directory.

    Returns:
        Path to the MOC file.
    """
    now = _now_iso()
    lines = [f'# {book_title}\n']
    lines.append('## Chapters\n')
    for s in sections:
        lines.append(f'- [[{s.link_target}|{s.title}]]')

    lines.append('\n## Related concepts\n')
    lines.append('> Add cross-book links here manually or let the auto-linker populate them.\n')

    post = frontmatter.Post(
        content='\n'.join(lines),
        title=book_title,
        tags=[book_abbrev.lower(), 'moc', 'sql-server'],
        type='moc',
        source=source_pdf,
        created=now,
        updated=now,
    )

    safe_name = _sanitize_filename(book_title)
    out_path = output_dir / f'{safe_name} (MOC).md'
    out_path.write_text(frontmatter.dumps(post), encoding='utf-8')
    logger.info('📋  MOC  →  %s  (%d sections)', out_path.name, len(sections))
    return out_path


# ---------------------------------------------------------------------------
# Cross-link pass
# ---------------------------------------------------------------------------

def _build_link_index(all_sections: list[Section]) -> list[tuple[str, str, re.Pattern[str]]]:
    """Build a sorted list of (title, link_target, compiled_regex) for auto-linking.

    Sorted longest-first so longer titles are matched before shorter substrings.

    Args:
        all_sections: All sections across all processed books.

    Returns:
        List of tuples ready for :func:`_add_wikilinks`.
    """
    index = []
    for s in all_sections:
        if len(s.title) < MIN_LINK_TITLE_LEN:
            continue
        pattern = re.compile(
            r'(?<!\[)(?<!\|)\b' + re.escape(s.title) + r'\b(?!\])',
            re.IGNORECASE,
        )
        index.append((s.title, s.link_target, pattern))
    # Longest titles first → avoids partial replacements
    index.sort(key=lambda t: len(t[0]), reverse=True)
    return index


def _add_wikilinks(note_path: Path, own_link_target: str,
                   link_index: list[tuple[str, str, re.Pattern[str]]]) -> int:
    """Scan a note and replace plain-text title mentions with [[WikiLinks]].

    Only the *first occurrence* of each title per note is linked.
    The note's own title is never self-linked.
    Heading lines (starting with ``#``) are excluded to prevent nesting.

    Args:
        note_path:        Path to the .md file to update.
        own_link_target:  The note's own ``link_target`` (to avoid self-links).
        link_index:       Pre-built index from :func:`_build_link_index`.

    Returns:
        Number of links inserted.
    """
    raw = note_path.read_text(encoding='utf-8')
    post = frontmatter.loads(raw)

    # Split into heading lines (excluded) and body lines (linkable)
    lines = post.content.splitlines(keepends=True)
    heading_lines = {i for i, ln in enumerate(lines) if ln.lstrip().startswith('#')}

    links_added = 0

    for title, target, pattern in link_index:
        if target == own_link_target:
            continue
        if f'[[{target}' in post.content:
            continue  # already linked

        def _replace(m: re.Match) -> str:  # noqa: ANN001
            return f'[[{target}|{m.group(0)}]]'

        for i, line in enumerate(lines):
            if i in heading_lines:
                continue
            new_line, count = pattern.subn(_replace, line, count=1)
            if count:
                lines[i] = new_line
                links_added += count
                break  # first occurrence only

    if links_added:
        post.content = ''.join(lines)
        post['updated'] = _now_iso()
        note_path.write_text(frontmatter.dumps(post), encoding='utf-8')

    return links_added


# ---------------------------------------------------------------------------
# Main converter
# ---------------------------------------------------------------------------

def convert_pdf_to_obsidian_network(pdf_path: Path, output_dir: Path) -> list[Section]:
    """Convert one PDF into a set of atomic Obsidian notes (no cross-links yet).

    Call :func:`run_crosslink_pass` after processing all PDFs to add WikiLinks.

    Args:
        pdf_path:   Path to the source PDF.
        output_dir: Directory where .md files are written.

    Returns:
        List of :class:`Section` objects created.

    Raises:
        FileNotFoundError: If *pdf_path* does not exist.
        RuntimeError:      If text extraction fails.
    """
    if not pdf_path.exists():
        raise FileNotFoundError(f'PDF not found: {pdf_path}')

    output_dir.mkdir(parents=True, exist_ok=True)

    book_title = _book_human_title(pdf_path.stem)
    book_abbrev = _book_abbrev(pdf_path.stem)

    logger.info('📖  Extracting  %s …', pdf_path.name)
    try:
        md_text: str = pymupdf4llm.to_markdown(str(pdf_path))
    except Exception as exc:
        raise RuntimeError(f'pymupdf4llm failed on {pdf_path.name}: {exc}') from exc

    sections = _split_sections(md_text, book_title, book_abbrev, str(pdf_path))
    if not sections:
        logger.warning('⚠️   No sections extracted from %s', pdf_path.name)
        return []

    for section in sections:
        note_path = _write_section_note(section, output_dir)
        logger.info('  ✅  %s', note_path.name)

    _write_moc(sections, book_title, book_abbrev, str(pdf_path), output_dir)
    logger.info('  → %d notes created for "%s"', len(sections), book_title)
    return sections


def run_crosslink_pass(all_sections: list[Section], output_dir: Path) -> None:
    """Add [[WikiLinks]] across all notes for cross-book references.

    Args:
        all_sections: Every section produced in the current run.
        output_dir:   Directory containing the .md files.
    """
    link_index = _build_link_index(all_sections)
    total_links = 0

    for section in all_sections:
        note_path = output_dir / f'{section.note_filename}.md'
        if not note_path.exists():
            continue
        n = _add_wikilinks(note_path, section.link_target, link_index)
        if n:
            logger.debug('  🔗  %s  (+%d links)', note_path.name, n)
            total_links += n

    logger.info('Cross-link pass complete — %d WikiLinks inserted', total_links)


# ---------------------------------------------------------------------------
# Batch processor
# ---------------------------------------------------------------------------

def process_folder(pdf_dir: Path, vault_dir: Path) -> None:
    """Convert all PDFs in *pdf_dir* to an interconnected Obsidian vault.

    1. Each PDF → N atomic notes + 1 MOC note.
    2. Cross-link pass across all produced notes.

    Args:
        pdf_dir:  Source folder with PDF files.
        vault_dir: Destination Obsidian vault folder.

    Raises:
        FileNotFoundError: If *pdf_dir* does not exist.
    """
    if not pdf_dir.exists():
        raise FileNotFoundError(f'PDF directory not found: {pdf_dir}')

    pdfs = sorted(pdf_dir.glob('*.pdf'))
    if not pdfs:
        logger.warning('No PDF files found in %s', pdf_dir)
        return

    all_sections: list[Section] = []
    for pdf_path in pdfs:
        try:
            sections = convert_pdf_to_obsidian_network(pdf_path, vault_dir)
            all_sections.extend(sections)
        except Exception as exc:
            logger.error('❌  %s — %s', pdf_path.name, exc)

    if all_sections:
        logger.info('Running cross-link pass over %d notes…', len(all_sections))
        run_crosslink_pass(all_sections, vault_dir)

    logger.info('✨  Done — %d total notes across %d books', len(all_sections), len(pdfs))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) > 1:
        target = Path(sys.argv[1])
        sections = convert_pdf_to_obsidian_network(target, VAULT_DIR)
        run_crosslink_pass(sections, VAULT_DIR)
    else:
        process_folder(PDF_DIR, VAULT_DIR)
