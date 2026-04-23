"""
Central configuration for the PDF Knowledge Base Pipeline.
Modify the paths here — no other files need to be touched.
"""

import logging
import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths — adjust to your environment
# ---------------------------------------------------------------------------

# Source folder containing PDF files to convert
PDF_DIR: Path = Path(os.environ.get('KB_PDF_DIR', r'C:\Projects\Claude\Projects\SQLSentinel\data'))

# Obsidian vault subfolder where .md notes are written
VAULT_DIR: Path = Path(os.environ.get('KB_VAULT_DIR', r'C:\Projects\volt\SQL\SQL\wiki'))

# SQLite database used by SQL Sentinel's AI agent
DB_PATH: Path = Path(os.environ.get('KB_DB_PATH', r'C:\Projects\Claude\Projects\SQLSentinel\knowledge-pipeline\knowledge_base.db'))

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_LEVEL: int = logging.INFO

logging.basicConfig(
    level=LOG_LEVEL,
    format='%(asctime)s  %(levelname)-8s  %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
