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
      .map((r) => ({ title: r.title, content: r.content.slice(0, 1500), tags: r.tags }))
  } catch {
    return []
  }
}
