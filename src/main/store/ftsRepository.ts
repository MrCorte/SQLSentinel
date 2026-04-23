import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'

const FTS_DB_PATH = app.isPackaged
  ? join(process.resourcesPath, 'knowledge_base.db')
  : join(process.cwd(), 'knowledge-pipeline', 'knowledge_base.db')

let _ftsDb: Database.Database | null = null

function getFtsDb(): Database.Database | null {
  if (_ftsDb) return _ftsDb
  if (!existsSync(FTS_DB_PATH)) return null
  _ftsDb = new Database(FTS_DB_PATH, { readonly: true })
  return _ftsDb
}

// Strip FTS5 special characters to avoid syntax errors on arbitrary queries
function sanitize(q: string): string {
  return q.replace(/["()*:]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Snippet extraction — sliding window, scored by total keyword hit density
// ---------------------------------------------------------------------------

function extractSnippet(content: string, query: string, snippetLen = 1500): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3)

  if (terms.length === 0) return content.slice(0, snippetLen)

  const lower = content.toLowerCase()
  const stride = 100
  let bestScore = 0
  let bestStart = 0

  for (let start = 0; start < lower.length; start += stride) {
    const window = lower.slice(start, start + snippetLen)
    let score = 0
    for (const term of terms) {
      let pos = window.indexOf(term)
      while (pos !== -1) {
        score++
        pos = window.indexOf(term, pos + 1)
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestStart = start
    }
  }

  return content.slice(bestStart, bestStart + snippetLen)
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface FtsRow {
  title: string
  content: string
  tags: string
}

interface DbaCardRow {
  slug: string
  title: string
  tags: string
  explanation: string
  tsql_query: string
  when_to_use: string
}

export interface SearchResult {
  title: string
  content: string
  tags: string
}

// ---------------------------------------------------------------------------
// Priority 1 — structured DBA reference cards (exact T-SQL, phrase-first)
// ---------------------------------------------------------------------------

function searchDbaCards(db: Database.Database, query: string, limit: number): SearchResult[] {
  const clean = sanitize(query)
  if (!clean) return []

  const sql =
    'SELECT slug, title, tags, explanation, tsql_query, when_to_use ' +
    'FROM dba_cards_fts WHERE dba_cards_fts MATCH ? ORDER BY rank LIMIT ?'

  let rows: DbaCardRow[] = []

  // Try phrase match first for multi-word queries (more precise)
  if (clean.includes(' ')) {
    try {
      rows = db.prepare<[string, number], DbaCardRow>(sql).all(`"${clean}"`, limit)
    } catch {
      // phrase match failed — fall through to term match
    }
  }

  // Fall back to individual-term matching
  if (rows.length === 0) {
    try {
      rows = db.prepare<[string, number], DbaCardRow>(sql).all(clean, limit)
    } catch {
      return []
    }
  }

  return rows.map((r) => ({
    title: r.title,
    tags: r.tags,
    // Return structured content: explanation + T-SQL code block + when-to-use
    content: `${r.explanation}\n\n\`\`\`sql\n${r.tsql_query}\n\`\`\`\n\nWhen to use:\n${r.when_to_use}`,
  }))
}

// ---------------------------------------------------------------------------
// Priority 2 — general knowledge (book chapters, scripts)
// ---------------------------------------------------------------------------

function searchKnowledgeFts(db: Database.Database, query: string, limit: number): SearchResult[] {
  const clean = sanitize(query)
  if (!clean) return []

  try {
    return db
      .prepare<[string, number], FtsRow>(
        'SELECT title, content, tags FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?'
      )
      .all(clean, limit)
      .map((r) => ({ title: r.title, content: extractSnippet(r.content, clean), tags: r.tags }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Public API — priority-merged search
// ---------------------------------------------------------------------------

export function searchFts(query: string, limit = 5): SearchResult[] {
  const db = getFtsDb()
  if (!db) return []

  const clean = sanitize(query)
  if (!clean) return []

  // Give up to 60% of slots to structured DBA cards, rest to book chapters
  const dbaLimit = Math.ceil(limit * 0.6)
  const dbaResults = searchDbaCards(db, query, dbaLimit)
  const remaining = limit - dbaResults.length
  const bookResults = remaining > 0 ? searchKnowledgeFts(db, query, remaining) : []

  return [...dbaResults, ...bookResults]
}
