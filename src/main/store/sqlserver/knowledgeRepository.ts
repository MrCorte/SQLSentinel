import * as sql from 'mssql'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { getPool } from './connection'
import {
  getQueryEmbedding,
  clearQueryCache,
  unpackEmbedding,
  cosineSimilarity
} from '../../ai/embedder'
import { createLogger } from '../../utils/logger'

const log = createLogger('knowledge-ss')

// Same path used by the legacy SQLite repositories. Treated as a one-shot
// build artifact: imported into dbo.dba_cards / knowledge_chunks /
// knowledge_embeddings on first boot, then ignored at runtime.
const SQLITE_BUILD_ARTIFACT = app?.isPackaged
  ? join(process.resourcesPath, 'knowledge_base.db')
  : join(process.cwd(), 'knowledge-pipeline', 'knowledge_base.db')

// Cosine threshold below which results are dropped — same as the legacy repo.
const SCORE_THRESHOLD = 0.5

export interface VecResult {
  title: string
  text: string
  score: number
}

export interface SearchResult {
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

interface ChunkRow {
  title: string
  content: string
  tags: string
}

interface EmbeddingRow {
  title: string
  text: string
  embedding: Buffer
}

// ---------------------------------------------------------------------------
// In-memory caches — same shape as the legacy SQLite-backed repos
// ---------------------------------------------------------------------------

let _vecIndex: { title: string; text: string; vec: Float32Array }[] | null = null
let _dbaCards: DbaCardRow[] | null = null
let _knowledgeChunks: ChunkRow[] | null = null

// ---------------------------------------------------------------------------
// One-shot importer — runs at boot and migrates the SQLite build artifact
// into the SQL Server tables if they are empty. Idempotent: a non-empty
// destination short-circuits and the SQLite file is never opened again.
// ---------------------------------------------------------------------------

export async function importKnowledgeIfEmpty(): Promise<void> {
  const pool = getPool()
  const counts = await pool.request().query<{ cards: number; chunks: number; embeds: number }>(
    `SELECT
       (SELECT COUNT(*) FROM dbo.dba_cards) AS cards,
       (SELECT COUNT(*) FROM dbo.knowledge_chunks) AS chunks,
       (SELECT COUNT(*) FROM dbo.knowledge_embeddings) AS embeds`
  )
  const { cards, chunks, embeds } = counts.recordset[0]
  if (cards > 0 && chunks > 0 && embeds > 0) return
  if (!existsSync(SQLITE_BUILD_ARTIFACT)) {
    log.warn('[knowledge] no build artifact at', SQLITE_BUILD_ARTIFACT, '— skipping import')
    return
  }

  // better-sqlite3 is imported lazily so a stripped-down image without it
  // can still boot (we only need it for the one-shot copy).
  let Database: typeof import('better-sqlite3')
  try {
    Database = (await import('better-sqlite3')).default as unknown as typeof import('better-sqlite3')
  } catch (err) {
    log.warn('[knowledge] better-sqlite3 unavailable — knowledge base import skipped:', err)
    return
  }
  const sqlite = new Database(SQLITE_BUILD_ARTIFACT, { readonly: true })

  try {
    if (cards === 0) await importDbaCards(pool, sqlite)
    if (chunks === 0) await importKnowledgeChunks(pool, sqlite)
    if (embeds === 0) await importKnowledgeEmbeddings(pool, sqlite)
    log.info('[knowledge] one-shot import complete')
  } finally {
    sqlite.close()
  }
}

// Chunk size targets the SQL Server 2100-parameter cap with a comfortable
// margin. dba_cards binds 6 params/row → 200 rows = 1200 params, well under.
const IMPORT_CHUNK_SIZE = 200

async function batchInsert<T>(
  pool: sql.ConnectionPool,
  rows: T[],
  bind: (req: sql.Request, row: T, idx: number) => void,
  buildValuesTuple: (idx: number) => string,
  insertHeader: string
): Promise<void> {
  if (rows.length === 0) return
  const tx = pool.transaction()
  await tx.begin()
  try {
    for (let off = 0; off < rows.length; off += IMPORT_CHUNK_SIZE) {
      const chunk = rows.slice(off, off + IMPORT_CHUNK_SIZE)
      const req = tx.request()
      const tuples: string[] = []
      for (let i = 0; i < chunk.length; i++) {
        bind(req, chunk[i], i)
        tuples.push(buildValuesTuple(i))
      }
      await req.query(`${insertHeader} VALUES ${tuples.join(', ')}`)
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

async function importDbaCards(
  pool: sql.ConnectionPool,
  sqlite: import('better-sqlite3').Database
): Promise<void> {
  const rows = sqlite
    .prepare<
      [],
      DbaCardRow
    >(
      'SELECT slug, title, tags, explanation, tsql_query, when_to_use FROM dba_cards_fts'
    )
    .all() as DbaCardRow[]
  await batchInsert(
    pool,
    rows,
    (req, r, i) => {
      req.input(`slug${i}`, sql.NVarChar(200), r.slug)
      req.input(`title${i}`, sql.NVarChar(500), r.title)
      req.input(`tags${i}`, sql.NVarChar(sql.MAX), r.tags ?? '')
      req.input(`expl${i}`, sql.NVarChar(sql.MAX), r.explanation ?? '')
      req.input(`tsql${i}`, sql.NVarChar(sql.MAX), r.tsql_query ?? '')
      req.input(`when${i}`, sql.NVarChar(sql.MAX), r.when_to_use ?? '')
    },
    (i) => `(@slug${i}, @title${i}, @tags${i}, @expl${i}, @tsql${i}, @when${i})`,
    `INSERT INTO dbo.dba_cards (slug, title, tags, explanation, tsql_query, when_to_use)`
  )
  log.info('[knowledge] imported', rows.length, 'dba_cards')
}

async function importKnowledgeChunks(
  pool: sql.ConnectionPool,
  sqlite: import('better-sqlite3').Database
): Promise<void> {
  type FtsRow = {
    rowid: number
    title: string
    content: string
    tags: string
    type: string
    source_file: string
  }
  const rows = sqlite
    .prepare<[], FtsRow>(
      'SELECT rowid AS rowid, title, content, tags, type, source_file FROM knowledge_fts'
    )
    .all() as FtsRow[]
  await batchInsert(
    pool,
    rows,
    (req, r, i) => {
      req.input(`id${i}`, sql.Int, r.rowid)
      req.input(`title${i}`, sql.NVarChar(500), r.title)
      req.input(`content${i}`, sql.NVarChar(sql.MAX), r.content)
      req.input(`tags${i}`, sql.NVarChar(sql.MAX), r.tags ?? '')
      req.input(`type${i}`, sql.NVarChar(50), r.type ?? '')
      req.input(`source${i}`, sql.NVarChar(500), r.source_file ?? '')
    },
    (i) => `(@id${i}, @title${i}, @content${i}, @tags${i}, @type${i}, @source${i})`,
    `INSERT INTO dbo.knowledge_chunks (id, title, content, tags, type_field, source_file)`
  )
  log.info('[knowledge] imported', rows.length, 'knowledge_chunks')
}

async function importKnowledgeEmbeddings(
  pool: sql.ConnectionPool,
  sqlite: import('better-sqlite3').Database
): Promise<void> {
  type EmbedRow = { id: number; title: string; chunk_idx: number; text: string; embedding: Buffer }
  const rows = sqlite
    .prepare<[], EmbedRow>(
      'SELECT id, title, chunk_idx, text, embedding FROM knowledge_embeddings'
    )
    .all() as EmbedRow[]
  // Embeddings bind 5 params/row but each row carries ~3KB of binary data, so
  // we use a smaller chunk size to keep individual statements under ~1MB.
  const oldChunk = IMPORT_CHUNK_SIZE
  const chunkSize = Math.min(oldChunk, 100)
  for (let off = 0; off < rows.length; off += chunkSize) {
    const slice = rows.slice(off, off + chunkSize)
    await batchInsert(
      pool,
      slice,
      (req, r, i) => {
        req.input(`id${i}`, sql.Int, r.id)
        req.input(`title${i}`, sql.NVarChar(500), r.title)
        req.input(`idx${i}`, sql.Int, r.chunk_idx)
        req.input(`text${i}`, sql.NVarChar(sql.MAX), r.text)
        req.input(`emb${i}`, sql.VarBinary(sql.MAX), r.embedding)
      },
      (i) => `(@id${i}, @title${i}, @idx${i}, @text${i}, @emb${i})`,
      `INSERT INTO dbo.knowledge_embeddings (id, title, chunk_idx, text, embedding)`
    )
  }
  log.info('[knowledge] imported', rows.length, 'knowledge_embeddings')
}

// ---------------------------------------------------------------------------
// Semantic search — cache + JS cosine. Falls back gracefully when the
// embedding table is empty (e.g. import skipped because no build artifact).
// ---------------------------------------------------------------------------

async function loadVecIndex(): Promise<{ title: string; text: string; vec: Float32Array }[]> {
  if (_vecIndex !== null) return _vecIndex
  const r = await getPool()
    .request()
    .query<EmbeddingRow>(`SELECT title, text, embedding FROM dbo.knowledge_embeddings`)
  _vecIndex = r.recordset.map((row) => ({
    title: row.title,
    text: row.text,
    vec: unpackEmbedding(row.embedding)
  }))
  log.info(`[knowledge] loaded ${_vecIndex.length} embedding chunks`)
  // Flat JS cosine search is O(n) per query. Above ~5 000 chunks the per-query
  // latency becomes noticeable; above ~20 000 it dominates inference time.
  // At that scale, migrate to an HNSW index or a dedicated vector store.
  const VEC_SCALE_WARN = 5_000
  if (_vecIndex.length > VEC_SCALE_WARN) {
    log.warn(
      `[knowledge] ${_vecIndex.length} embedding chunks loaded into memory — ` +
        `flat cosine search degrades past ${VEC_SCALE_WARN}; consider HNSW or pgvector`
    )
  }
  return _vecIndex
}

export async function semanticSearch(query: string, topK = 3): Promise<VecResult[]> {
  const index = await loadVecIndex()
  if (index.length === 0) return []

  const queryVec = await getQueryEmbedding(query)
  const scored = index.map((entry) => ({
    title: entry.title,
    text: entry.text,
    score: cosineSimilarity(queryVec, entry.vec)
  }))
  scored.sort((a, b) => b.score - a.score)
  const filtered = scored.filter((r) => r.score >= SCORE_THRESHOLD).slice(0, topK)
  log.info(
    `[knowledge] query="${query.slice(0, 60)}" topScore=${scored[0]?.score.toFixed(3) ?? 'n/a'} hits=${filtered.length}/${topK}`
  )
  return filtered
}

export function resetIndex(): void {
  _vecIndex = null
  _dbaCards = null
  _knowledgeChunks = null
  clearQueryCache()
}

export function preWarmIndex(): void {
  setImmediate(() => {
    void loadVecIndex().catch(() => {})
    void loadDbaCards().catch(() => {})
    void loadKnowledgeChunks().catch(() => {})
  })
}

// Re-export so legacy callers can keep importing warmupEmbedder from here.
export { warmupEmbedder } from '../../ai/embedder'

// ---------------------------------------------------------------------------
// FTS search — cache the rows once, then score in JS. Same priority order as
// the legacy SQLite impl: dba_cards first (exact T-SQL recipes), then chapters.
// ---------------------------------------------------------------------------

async function loadDbaCards(): Promise<DbaCardRow[]> {
  if (_dbaCards !== null) return _dbaCards
  const r = await getPool()
    .request()
    .query<DbaCardRow>(`SELECT slug, title, tags, explanation, tsql_query, when_to_use FROM dbo.dba_cards`)
  _dbaCards = r.recordset
  return _dbaCards
}

async function loadKnowledgeChunks(): Promise<ChunkRow[]> {
  if (_knowledgeChunks !== null) return _knowledgeChunks
  const r = await getPool()
    .request()
    .query<ChunkRow>(`SELECT title, content, tags FROM dbo.knowledge_chunks`)
  _knowledgeChunks = r.recordset
  return _knowledgeChunks
}

function sanitize(q: string): string {
  return q.replace(/["()*:]/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokenize(q: string): string[] {
  return sanitize(q)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

function extractSnippet(content: string, query: string, snippetLen = 800): string {
  const terms = tokenize(query)
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

// Lightweight TF-style scoring: terms in title weigh more than terms in body.
// Phrase hit (full sanitized query appearing verbatim) bumps the score so
// exact-phrase queries dominate single-term ones, mirroring FTS5 bm25 weights.
function scoreRow(
  text: { title: string; tags: string; body: string },
  phrase: string,
  terms: string[]
): number {
  const t = text.title.toLowerCase()
  const g = text.tags.toLowerCase()
  const b = text.body.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (t.includes(term)) score += 10
    if (g.includes(term)) score += 5
    if (b.includes(term)) score += 1
  }
  if (phrase.includes(' ')) {
    if (t.includes(phrase)) score += 30
    if (b.includes(phrase)) score += 15
  }
  return score
}

function rankRows<T>(
  rows: T[],
  fields: (row: T) => { title: string; tags: string; body: string },
  phrase: string,
  terms: string[],
  limit: number
): Array<{ row: T; score: number }> {
  if (terms.length === 0) return []
  const scored = rows.map((row) => ({ row, score: scoreRow(fields(row), phrase, terms) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.filter((r) => r.score > 0).slice(0, limit)
}

async function searchDbaCards(query: string, limit: number): Promise<SearchResult[]> {
  const cards = await loadDbaCards()
  const phrase = sanitize(query).toLowerCase()
  const terms = tokenize(query)
  return rankRows(
    cards,
    (c) => ({ title: c.title, tags: c.tags, body: `${c.explanation} ${c.when_to_use}` }),
    phrase,
    terms,
    limit
  ).map(({ row }) => ({
    title: row.title,
    tags: row.tags,
    content: `${row.explanation}\n\n\`\`\`sql\n${row.tsql_query}\n\`\`\`\n\nWhen to use:\n${row.when_to_use}`
  }))
}

async function searchKnowledgeChunks(query: string, limit: number): Promise<SearchResult[]> {
  const chunks = await loadKnowledgeChunks()
  const phrase = sanitize(query).toLowerCase()
  const terms = tokenize(query)
  return rankRows(
    chunks,
    (c) => ({ title: c.title, tags: c.tags, body: c.content }),
    phrase,
    terms,
    limit
  ).map(({ row }) => ({
    title: row.title,
    tags: row.tags,
    content: extractSnippet(row.content, query)
  }))
}

export async function searchFts(query: string, limit = 5): Promise<SearchResult[]> {
  if (sanitize(query).length === 0) return []
  // DBA cards first (up to 60% of slots); unused slots flow to book chapters.
  const dbaLimit = Math.ceil(limit * 0.6)
  const dbaResults = await searchDbaCards(query, dbaLimit)
  const bookLimit = limit - dbaResults.length
  const bookResults = bookLimit > 0 ? await searchKnowledgeChunks(query, bookLimit) : []
  return [...dbaResults, ...bookResults]
}
