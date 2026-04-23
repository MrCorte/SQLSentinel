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

interface FtsRow {
  title: string
  content: string
  tags: string
}

// Return a ~1500-char snippet centred on the best keyword match within the document.
// Without this, long chapters always return their opening paragraph, which may be
// unrelated to the search terms even though the keywords appear further in the text.
function extractSnippet(content: string, query: string, snippetLen = 1500): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3)

  let bestPos = -1
  let bestTermLen = 0
  for (const term of terms) {
    const pos = content.toLowerCase().indexOf(term)
    if (pos !== -1 && term.length > bestTermLen) {
      bestTermLen = term.length
      bestPos = pos
    }
  }

  if (bestPos === -1) return content.slice(0, snippetLen)
  const start = Math.max(0, bestPos - 300)
  return content.slice(start, start + snippetLen)
}

export function searchFts(query: string, limit = 5): { title: string; content: string; tags: string }[] {
  const db = getFtsDb()
  if (!db) return []

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
