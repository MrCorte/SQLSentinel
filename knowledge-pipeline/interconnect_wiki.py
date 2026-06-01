#!/usr/bin/env python3
"""
Interconnect two Obsidian wiki books via shared SQL Server concepts.
Scans all .md files, builds concept index, adds [[wikilinks]] cross-references.
Usage: python3 interconnect_wiki.py [--dry-run]
"""

import argparse
import re
from collections import defaultdict
from pathlib import Path

WIKI_DIR = Path("/Users/andreacortesi/Documents/Projects/Obsidian/wiki")

BOOK_DIRS = {
    "dmvs": "sql-server-dmvs-in-action",
    "admin": "pro-sql-server-2019-administration-2nd-edition",
}

# SQL Server concept patterns to extract
CONCEPT_PATTERNS = [
    # DMVs and DMFs
    r"\bsys\.dm_[a-z_]+\b",
    r"\bsys\.fn_[a-z_]+\b",
    # System catalog views
    r"\bsys\.[a-z_]{4,}\b",
    # T-SQL keywords / features
    r"\b(?:Always\s*On|AlwaysOn)\b",
    r"\bAvailability\s+Group[s]?\b",
    r"\bTempDB\b",
    r"\bBuffer\s+Pool\b",
    r"\bQuery\s+Store\b",
    r"\bIn-Memory\s+OLTP\b",
    r"\bColumnstore\b",
    r"\bStretch\s+Database\b",
    r"\bLog\s+Shipping\b",
    r"\bDatabase\s+Mirroring\b",
    r"\bReplication\b",
    r"\bChange\s+Data\s+Capture\b",
    r"\bCDC\b",
    r"\bSQLOS\b",
    r"\bLAZY\s+WRITER\b",
    r"\bCHECKPOINT\b",
    r"\bWAIT\s+STATS\b",
    r"\bWAITSTATS\b",
    r"\bSPIN\s*LOCK[S]?\b",
    r"\bLATCH\b",
    r"\bLOCK\s+ESCALATION\b",
    r"\bDEADLOCK\b",
    r"\bBLOCKING\b",
    r"\bEXECUTION\s+PLAN[S]?\b",
    r"\bQUERY\s+OPTIMIZER\b",
    r"\bSTATISTICS\b",
    r"\bINDEX\s+FRAGMENTATION\b",
    r"\bFILLFACTOR\b",
    r"\bPAGE\s+SPLIT[S]?\b",
    r"\bAuto-?Shrink\b",
    r"\bAuto-?Growth\b",
    r"\bVLF[S]?\b",
    r"\bTransaction\s+Log\b",
    r"\bLog\s+Buffer\b",
    r"\bFull-?Text\s+Search\b",
    r"\bService\s+Broker\b",
    r"\bSSIS\b",
    r"\bSSRS\b",
    r"\bSSAS\b",
    r"\bPolyBase\b",
    r"\bStretchDB\b",
    r"\bR\s+Services\b",
    r"\bMachine\s+Learning\s+Services\b",
    r"\bResourceGovernor\b",
    r"\bResource\s+Governor\b",
    r"\bWorker\s+Thread[S]?\b",
    r"\bSCHEDULER[S]?\b",
    r"\bNUMA\b",
    r"\bSoft.?NUMA\b",
    r"\bMax\s+Degree\s+of\s+Parallelism\b",
    r"\bMAXDOP\b",
    r"\bCost\s+Threshold\b",
    r"\bPlan\s+Cache\b",
    r"\bAd.?Hoc\s+Workload[S]?\b",
    r"\bCLR\b",
    r"\bLinked\s+Server[S]?\b",
    r"\bExtended\s+Events\b",
    r"\bXEvents\b",
    r"\bSQL\s+Trace\b",
    r"\bProfiler\b",
    r"\bPerformance\s+Monitor\b",
    r"\bPerfMon\b",
    r"\bWMI\b",
    r"\bBackup\s+Compression\b",
    r"\bTDE\b",
    r"\bTransparent\s+Data\s+Encryption\b",
    r"\bRow.?Level\s+Security\b",
    r"\bDynamic\s+Data\s+Masking\b",
    r"\bAudit\b",
    r"\bFail\s*over\s+Cluster\b",
    r"\bFCI\b",
    r"\bWSFC\b",
    r"\bDatabase\s+Snapshot[S]?\b",
    r"\bFileStream\b",
    r"\bFileTable\b",
    r"\bSparse\s+Column[S]?\b",
    r"\bXML\s+Index\b",
    r"\bSpatial\s+Index\b",
    r"\bFiltered\s+Index\b",
    r"\bCovering\s+Index\b",
    r"\bIncluded\s+Column[S]?\b",
    r"\bPartition(?:ing|ed\s+Table|ed\s+View)[S]?\b",
    r"\bPUSH\s+DOWN\b",
    r"\bBatch\s+Mode\b",
    r"\bRow\s+Mode\b",
    r"\bAdaptive\s+Join[S]?\b",
    r"\bInterleaved\s+Execution\b",
    r"\bMemory\s+Grant[S]?\b",
    r"\bSpill(?:ing)?\s+to\s+TempDB\b",
    r"\bHASH\s+JOIN\b",
    r"\bNested\s+LOOP[S]?\b",
    r"\bMERGE\s+JOIN\b",
    r"\bIndex\s+SEEK\b",
    r"\bIndex\s+SCAN\b",
    r"\bTable\s+SCAN\b",
    r"\bRID\s+LOOKUP\b",
    r"\bKey\s+LOOKUP\b",
    r"\bParallelism\b",
    r"\bDOP\b",
]

COMPILED = [re.compile(p, re.IGNORECASE) for p in CONCEPT_PATTERNS]


def extract_concepts(text: str) -> set[str]:
    concepts = set()
    for pattern in COMPILED:
        for m in pattern.finditer(text):
            concepts.add(m.group(0).lower().strip())
    return concepts


def page_title(filepath: Path) -> str:
    """Extract title from first # heading or filename."""
    try:
        for line in filepath.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except Exception:
        pass
    return filepath.stem


def wikilink(filepath: Path, wiki_root: Path) -> str:
    """Return Obsidian [[relative/path|Title]] link."""
    rel = filepath.relative_to(wiki_root)
    parts = list(rel.parts)
    # Obsidian: [[folder/file]] without .md extension
    path_no_ext = str(rel.with_suffix(""))
    title = page_title(filepath)
    return f"[[{path_no_ext}|{title}]]"


def build_index(wiki_root: Path, book_dirs: dict) -> dict[str, dict[str, set]]:
    """Build concept → {book_key → set of filepaths} index."""
    index = defaultdict(lambda: defaultdict(set))
    for book_key, book_dir in book_dirs.items():
        book_path = wiki_root / book_dir
        if not book_path.exists():
            print(f"  [!] {book_dir} not found, skipping")
            continue
        for md in sorted(book_path.glob("*.md")):
            if md.name.startswith("00"):  # skip index
                continue
            text = md.read_text(encoding="utf-8")
            for concept in extract_concepts(text):
                index[concept][book_key].add(md)
    return index


def add_crosslinks(filepath: Path, related: list[Path], wiki_root: Path, dry_run: bool):
    text = filepath.read_text(encoding="utf-8")

    # Remove existing cross-reference section
    text = re.sub(r"\n---\n## Cross-References.*$", "", text, flags=re.DOTALL)

    links = [wikilink(p, wiki_root) for p in sorted(related, key=lambda p: p.name)]
    section = "\n\n---\n## Cross-References\n\n" + "\n".join(f"- {l}" for l in links)

    new_text = text.rstrip() + section + "\n"

    if dry_run:
        print(f"  [{filepath.parent.name}/{filepath.name}] → {len(links)} cross-links")
    else:
        filepath.write_text(new_text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("Building concept index...")
    index = build_index(WIKI_DIR, BOOK_DIRS)
    print(f"Found {len(index)} unique concepts")

    # For each page in book A, find pages in book B sharing concepts
    cross_links: dict[Path, set[Path]] = defaultdict(set)

    for concept, books in index.items():
        if len(books) < 2:
            continue  # concept only in one book, skip
        book_keys = list(books.keys())
        for i, key_a in enumerate(book_keys):
            for key_b in book_keys[i + 1 :]:
                for page_a in books[key_a]:
                    for page_b in books[key_b]:
                        cross_links[page_a].add(page_b)
                        cross_links[page_b].add(page_a)

    # Filter: only add if 2+ shared concepts (avoid noise)
    min_shared = 2
    filtered: dict[Path, list[Path]] = {}
    for page, related_set in cross_links.items():
        # Re-count actual shared concepts per related page
        page_concepts = set()
        page_text = page.read_text(encoding="utf-8")
        page_concepts = extract_concepts(page_text)

        strong = []
        for rel in related_set:
            rel_concepts = extract_concepts(rel.read_text(encoding="utf-8"))
            shared = page_concepts & rel_concepts
            if len(shared) >= min_shared:
                strong.append(rel)

        if strong:
            filtered[page] = strong

    print(f"Pages with cross-links: {len(filtered)}")

    # Write cross-reference sections
    for page, related in filtered.items():
        add_crosslinks(page, related, WIKI_DIR, args.dry_run)

    if not args.dry_run:
        print(f"\nDone. Wiki interconnected at: {WIKI_DIR}")
    else:
        print(f"\nDry run complete. Run without --dry-run to apply.")


if __name__ == "__main__":
    main()
