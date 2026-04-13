# RAG SQL Books Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arricchire l'AI assistant con una pipeline RAG che indicizza automaticamente i PDF presenti in `data/` all'avvio dell'app e inietta gli excerpt rilevanti nel system prompt di ogni risposta.

**Architecture:** All'avvio il main process scansiona `data/*.pdf`, confronta con i documenti già in SQLite (per filename), indicizza solo i nuovi con Ollama `nomic-embed-text`, e rimuove quelli non più presenti. Ad ogni query AI, i chunk più simili (cosine similarity in TypeScript) vengono iniettati nel system prompt prima dei dati di monitoraggio. Niente UI di upload: il developer aggiunge PDF nella cartella e riavvia.

**Tech Stack:** `pdf-parse` (estrazione testo), Ollama `embed()` API (`nomic-embed-text`), `better-sqlite3` BLOB per Float32Array, cosine similarity in TS puro, MUI read-only list nel pannello AI.

---

## File Map

| Stato | File | Responsabilità |
|-------|------|----------------|
| **Crea** | `data/` | Cartella dove il developer mette i PDF (da `.gitignore` se i libri sono proprietari) |
| **Crea** | `src/main/store/ragRepository.ts` | CRUD SQLite per `rag_documents` + `rag_chunks`; serializzazione Float32Array ↔ BLOB |
| **Crea** | `src/main/ai/rag.ts` | `chunkText`, `cosineSimilarity`, `ingestPdf`, `retrieveFromBooks` |
| **Crea** | `src/main/ai/ragAutoIndex.ts` | `autoIndexRagBooks()`: scansiona `data/`, indicizza nuovi, rimuove cancellati |
| **Crea** | `src/main/__tests__/rag.test.ts` | Test per `chunkText`, `cosineSimilarity`, pipeline ingest con mock |
| **Crea** | `src/renderer/src/components/ai/RAGStatus.tsx` | Lista read-only dei libri indicizzati nel pannello AI |
| **Modifica** | `src/main/store/database.ts` | DDL per `rag_documents` e `rag_chunks` |
| **Modifica** | `src/main/ai/ollama.ts` | Aggiunge `ollamaEmbed(text): Promise<number[]>` |
| **Modifica** | `src/main/ai/agent.ts` | Inietta excerpt RAG nel system prompt via `retrieveFromBooks` |
| **Modifica** | `src/main/index.ts` | Chiama `autoIndexRagBooks()` dopo `initDb()` all'avvio |
| **Modifica** | `src/main/ipc/types.ts` | Aggiunge `RAG_GET_DOCUMENTS = 'rag:getDocuments'` |
| **Modifica** | `src/main/ipc/handlers.ts` | Handler per `RAG_GET_DOCUMENTS` (sola lettura) |
| **Modifica** | `src/preload/index.ts` | `rag.getDocuments()` in `realApi`, `mockApi`, `bridgeApi` |
| **Modifica** | `src/preload/index.d.ts` | `RagDocument` type + `rag` namespace in `SqlSentinelAPI` |
| **Modifica** | `src/renderer/src/components/ai/AIPanel.tsx` | Tab "Libri" che monta `RAGStatus` |

---

## Task 1 — Dipendenza + schema SQLite + cartella `data/`

**Files:**
- `package.json`
- `src/main/store/database.ts`
- `data/.gitkeep` (crea la cartella)
- `.gitignore` (opzionale: esclude i PDF)

- [ ] **Step 1.1 — Installa `pdf-parse`**

```bash
cd c:/Projects/Claude/Projects/SQLSentinel
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

Verifica: `grep '"pdf-parse"' package.json` deve restituire la versione installata.

- [ ] **Step 1.2 — Crea cartella `data/` con placeholder**

```bash
mkdir -p data
echo "" > data/.gitkeep
```

Opzionalmente aggiungi a `.gitignore` (se i libri non devono finire in git):

```
# SQL books for RAG indexing
data/*.pdf
```

- [ ] **Step 1.3 — Aggiungi DDL a `src/main/store/database.ts`**

Trova `const DDL = \`` e aggiungi in coda, **prima** del backtick di chiusura:

```sql
  CREATE TABLE IF NOT EXISTS rag_documents (
    id          TEXT    PRIMARY KEY,
    filename    TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL DEFAULT '',
    added_at    TEXT    NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rag_chunks (
    id           TEXT    PRIMARY KEY,
    document_id  TEXT    NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL,
    content      TEXT    NOT NULL,
    embedding    BLOB    NOT NULL,
    UNIQUE(document_id, chunk_index)
  );

  CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc ON rag_chunks(document_id);
```

Nota: `filename TEXT NOT NULL UNIQUE` permette di controllare facilmente se un PDF è già stato indicizzato.

- [ ] **Step 1.4 — Typecheck**

```bash
npm run typecheck
```

Output atteso: 0 errori.

- [ ] **Step 1.5 — Commit**

```bash
git add package.json package-lock.json src/main/store/database.ts data/.gitkeep
git commit -m "feat(rag): add pdf-parse, rag_documents/rag_chunks tables, data/ folder"
```

---

## Task 2 — `ragRepository.ts`

**Files:**
- Create: `src/main/store/ragRepository.ts`

- [ ] **Step 2.1 — Crea `src/main/store/ragRepository.ts`**

```typescript
import { randomUUID } from 'node:crypto'
import { getDb } from './database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RagDocument {
  id: string
  filename: string
  title: string
  addedAt: string
  chunkCount: number
}

export interface RagChunk {
  id: string
  documentId: string
  chunkIndex: number
  content: string
  embedding: number[]
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function embeddingToBlob(embedding: number[]): Buffer {
  const arr = new Float32Array(embedding)
  return Buffer.from(arr.buffer)
}

function blobToEmbedding(blob: Buffer): number[] {
  const arr = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
  return Array.from(arr)
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface DocumentRow {
  id: string
  filename: string
  title: string
  added_at: string
  chunk_count: number
}

interface ChunkRow {
  id: string
  document_id: string
  chunk_index: number
  content: string
  embedding: Buffer
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export function insertDocument(doc: Omit<RagDocument, 'id'>): RagDocument {
  const id = randomUUID()
  getDb()
    .prepare<[string, string, string, string, number]>(`
      INSERT INTO rag_documents (id, filename, title, added_at, chunk_count)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(id, doc.filename, doc.title, doc.addedAt, doc.chunkCount)
  return { id, ...doc }
}

export function updateChunkCount(documentId: string, count: number): void {
  getDb()
    .prepare<[number, string]>('UPDATE rag_documents SET chunk_count = ? WHERE id = ?')
    .run(count, documentId)
}

export function insertChunks(chunks: Omit<RagChunk, 'id'>[]): void {
  if (chunks.length === 0) return
  const db = getDb()
  const stmt = db.prepare<[string, string, number, string, Buffer]>(`
    INSERT INTO rag_chunks (id, document_id, chunk_index, content, embedding)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction((list: Omit<RagChunk, 'id'>[]) => {
    for (const c of list) {
      stmt.run(randomUUID(), c.documentId, c.chunkIndex, c.content, embeddingToBlob(c.embedding))
    }
  })
  insertAll(chunks)
}

export function getAllDocuments(): RagDocument[] {
  const rows = getDb()
    .prepare<[], DocumentRow>('SELECT * FROM rag_documents ORDER BY added_at DESC')
    .all()
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    title: r.title,
    addedAt: r.added_at,
    chunkCount: r.chunk_count
  }))
}

/** Returns filenames of all indexed documents — used for incremental sync. */
export function getIndexedFilenames(): Set<string> {
  const rows = getDb()
    .prepare<[], { filename: string }>('SELECT filename FROM rag_documents')
    .all()
  return new Set(rows.map((r) => r.filename))
}

export function getAllChunks(): RagChunk[] {
  const rows = getDb()
    .prepare<[], ChunkRow>('SELECT * FROM rag_chunks')
    .all()
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    chunkIndex: r.chunk_index,
    content: r.content,
    embedding: blobToEmbedding(r.embedding)
  }))
}

export function deleteDocumentByFilename(filename: string): void {
  // ON DELETE CASCADE removes related chunks
  getDb()
    .prepare<[string]>('DELETE FROM rag_documents WHERE filename = ?')
    .run(filename)
}
```

- [ ] **Step 2.2 — Typecheck**

```bash
npm run typecheck
```

Output atteso: 0 errori.

- [ ] **Step 2.3 — Commit**

```bash
git add src/main/store/ragRepository.ts
git commit -m "feat(rag): ragRepository - CRUD rag_documents/rag_chunks with Float32 BLOB"
```

---

## Task 3 — `ollamaEmbed()` in `ollama.ts`

**Files:**
- Modify: `src/main/ai/ollama.ts`
- Create: `src/main/__tests__/rag.test.ts` (sezione embed)

- [ ] **Step 3.1 — Scrivi il test che fallisce**

Crea `src/main/__tests__/rag.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Ollama client
// ---------------------------------------------------------------------------

vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(() => ({
    chat: vi.fn(),
    list: vi.fn(),
    embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] })
  }))
}))

// ---------------------------------------------------------------------------
// ollamaEmbed
// ---------------------------------------------------------------------------

describe('ollamaEmbed', () => {
  beforeEach(() => vi.resetModules())

  it('returns the first embedding vector', async () => {
    const { ollamaEmbed } = await import('../ai/ollama')
    const result = await ollamaEmbed('SELECT * FROM sys.databases')
    expect(result).toEqual([0.1, 0.2, 0.3])
  })

  it('throws when Ollama returns empty embeddings', async () => {
    const { Ollama } = (await import('ollama')) as any
    Ollama.mockImplementation(() => ({
      embed: vi.fn().mockResolvedValue({ embeddings: [] })
    }))
    const { ollamaEmbed } = await import('../ai/ollama')
    await expect(ollamaEmbed('test')).rejects.toThrow('empty')
  })
})
```

- [ ] **Step 3.2 — Verifica che fallisca**

```bash
npm test -- --reporter=verbose src/main/__tests__/rag.test.ts
```

Output atteso: `FAIL` — `ollamaEmbed is not a function`.

- [ ] **Step 3.3 — Aggiungi `ollamaEmbed` a `src/main/ai/ollama.ts`**

Aggiungi in fondo al file:

```typescript
export async function ollamaEmbed(
  text: string,
  model = 'nomic-embed-text'
): Promise<number[]> {
  const res = await client.embed({ model, input: text })
  if (!res.embeddings || res.embeddings.length === 0) {
    throw new Error('[ollamaEmbed] Ollama returned empty embeddings')
  }
  return res.embeddings[0]
}
```

- [ ] **Step 3.4 — Verifica che i test passino**

```bash
npm test -- --reporter=verbose src/main/__tests__/rag.test.ts
```

Output atteso: `PASS` — 2 test.

- [ ] **Step 3.5 — Commit**

```bash
git add src/main/ai/ollama.ts src/main/__tests__/rag.test.ts
git commit -m "feat(rag): ollamaEmbed() wraps Ollama embed API for nomic-embed-text"
```

---

## Task 4 — `src/main/ai/rag.ts`

**Files:**
- Create: `src/main/ai/rag.ts`
- Modify: `src/main/__tests__/rag.test.ts`

- [ ] **Step 4.1 — Aggiungi test per funzioni pure a `rag.test.ts`**

Aggiungi **prima** del blocco `vi.mock('ollama', ...)` esistente:

```typescript
// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  let chunkText: (text: string, maxChars?: number, overlap?: number) => string[]

  beforeEach(async () => {
    vi.resetModules()
    ;({ chunkText } = await import('../ai/rag'))
  })

  it('returns one chunk for short text', () => {
    expect(chunkText('Hello SQL.')).toHaveLength(1)
  })

  it('splits on double newlines', () => {
    const result = chunkText('Para one.\n\nPara two.')
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('Para one.')
    expect(result[1]).toBe('Para two.')
  })

  it('splits long paragraphs with overlap', () => {
    const long = 'X'.repeat(500)
    const result = chunkText(long, 400, 50)
    expect(result.length).toBeGreaterThan(1)
  })

  it('filters chunks shorter than 30 chars', () => {
    const text = 'Hi.\n\nThis paragraph is long enough to pass the minimum length filter check.'
    const result = chunkText(text)
    expect(result.every((c) => c.length >= 30)).toBe(true)
  })

  it('returns empty array for empty input', () => {
    expect(chunkText('')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  let cosineSimilarity: (a: number[], b: number[]) => number

  beforeEach(async () => {
    vi.resetModules()
    ;({ cosineSimilarity } = await import('../ai/rag'))
  })

  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0)
  })

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0)
  })

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0)
  })

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0)
  })
})
```

Aggiungi inoltre in fondo al file (dopo il describe `ollamaEmbed`):

```typescript
// ---------------------------------------------------------------------------
// ingestPdf + retrieveFromBooks — mock di pdf-parse e ragRepository
// ---------------------------------------------------------------------------

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({
    text: 'First paragraph about SQL Server indexes.\n\nSecond paragraph about query plans.',
    info: { Title: 'SQL Guide' }
  })
}))

vi.mock('../store/ragRepository', () => ({
  insertDocument: vi.fn().mockReturnValue({
    id: 'doc-1', filename: 'guide.pdf', title: 'SQL Guide',
    addedAt: '2026-01-01T00:00:00.000Z', chunkCount: 0
  }),
  updateChunkCount: vi.fn(),
  insertChunks: vi.fn(),
  getAllDocuments: vi.fn().mockReturnValue([{ id: 'doc-1', chunkCount: 2 }]),
  getAllChunks: vi.fn().mockReturnValue([
    { id: 'c1', documentId: 'doc-1', chunkIndex: 0,
      content: 'First paragraph about SQL Server indexes.', embedding: [1, 0] },
    { id: 'c2', documentId: 'doc-1', chunkIndex: 1,
      content: 'Second paragraph about query plans.', embedding: [0, 1] }
  ]),
  getIndexedFilenames: vi.fn().mockReturnValue(new Set()),
  deleteDocumentByFilename: vi.fn()
}))

describe('ingestPdf', () => {
  it('parses, chunks, embeds, and saves to repository', async () => {
    vi.resetModules()
    const ragRepo = await import('../store/ragRepository') as any
    const { ingestPdf, invalidateChunkCache } = await import('../ai/rag')
    invalidateChunkCache()

    const phases: string[] = []
    const result = await ingestPdf('/fake/guide.pdf', (p) => phases.push(p.phase))

    expect(result.title).toBe('SQL Guide')
    expect(ragRepo.insertChunks).toHaveBeenCalled()
    expect(ragRepo.updateChunkCount).toHaveBeenCalledWith('doc-1', 2)
    expect(phases).toContain('parsing')
    expect(phases).toContain('embedding')
  })
})

describe('retrieveFromBooks', () => {
  it('returns chunks sorted by cosine similarity', async () => {
    vi.resetModules()
    const { Ollama } = (await import('ollama')) as any
    Ollama.mockImplementation(() => ({
      embed: vi.fn().mockResolvedValue({ embeddings: [[1, 0]] }) // query ~ c1
    }))
    const { retrieveFromBooks, invalidateChunkCache } = await import('../ai/rag')
    invalidateChunkCache()

    const chunks = await retrieveFromBooks('SQL indexes', 2)
    expect(chunks[0].content).toBe('First paragraph about SQL Server indexes.')
  })

  it('returns empty array when no documents', async () => {
    vi.resetModules()
    const ragRepo = await import('../store/ragRepository') as any
    ragRepo.getAllDocuments.mockReturnValueOnce([])
    const { retrieveFromBooks } = await import('../ai/rag')
    expect(await retrieveFromBooks('anything')).toHaveLength(0)
  })
})
```

- [ ] **Step 4.2 — Verifica che i test falliscano**

```bash
npm test -- --reporter=verbose src/main/__tests__/rag.test.ts
```

Output atteso: `FAIL` — `chunkText is not a function`, `cosineSimilarity is not a function`.

- [ ] **Step 4.3 — Crea `src/main/ai/rag.ts`**

```typescript
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import pdfParse from 'pdf-parse'
import { ollamaEmbed } from './ollama'
import * as ragRepository from '../store/ragRepository'
import type { RagChunk, RagDocument } from '../store/ragRepository'

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

export function chunkText(text: string, maxChars = 400, overlap = 50): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  const paragraphs = normalized.split(/\n\n+/)
  const chunks: string[] = []

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (trimmed.length === 0) continue
    if (trimmed.length <= maxChars) {
      chunks.push(trimmed)
    } else {
      let start = 0
      while (start < trimmed.length) {
        const end = Math.min(start + maxChars, trimmed.length)
        chunks.push(trimmed.slice(start, end))
        start += maxChars - overlap
      }
    }
  }
  return chunks.filter((c) => c.length >= 30)
}

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export interface IngestProgress {
  phase: 'parsing' | 'embedding'
  current: number
  total: number
}

export async function ingestPdf(
  filePath: string,
  onProgress?: (p: IngestProgress) => void
): Promise<RagDocument> {
  // 1. Read & parse PDF
  onProgress?.({ phase: 'parsing', current: 0, total: 1 })
  const dataBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    createReadStream(filePath)
      .on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject)
  })
  const pdfData = await pdfParse(dataBuffer)

  // 2. Chunk text
  const textChunks = chunkText(pdfData.text)
  const filename = basename(filePath)
  const title = (pdfData.info?.Title as string | undefined) || filename.replace(/\.pdf$/i, '')

  // 3. Persist placeholder document
  const doc = ragRepository.insertDocument({
    filename,
    title,
    addedAt: new Date().toISOString(),
    chunkCount: 0
  })

  // 4. Embed each chunk and collect
  const total = textChunks.length
  const chunkRows: Omit<RagChunk, 'id'>[] = []
  for (let i = 0; i < textChunks.length; i++) {
    onProgress?.({ phase: 'embedding', current: i + 1, total })
    const embedding = await ollamaEmbed(textChunks[i])
    chunkRows.push({ documentId: doc.id, chunkIndex: i, content: textChunks[i], embedding })
  }

  // 5. Batch save and update count
  ragRepository.insertChunks(chunkRows)
  ragRepository.updateChunkCount(doc.id, chunkRows.length)

  return { ...doc, chunkCount: chunkRows.length }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

// In-memory cache — invalidated when documents change
let _chunksCache: RagChunk[] | null = null
let _cacheDocCount = -1

export async function retrieveFromBooks(query: string, topK = 5): Promise<RagChunk[]> {
  const docs = ragRepository.getAllDocuments()
  if (docs.length === 0) return []

  if (_chunksCache === null || _cacheDocCount !== docs.length) {
    _chunksCache = ragRepository.getAllChunks()
    _cacheDocCount = docs.length
  }
  if (_chunksCache.length === 0) return []

  const queryEmbedding = await ollamaEmbed(query)
  return _chunksCache
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.chunk)
}

export function invalidateChunkCache(): void {
  _chunksCache = null
  _cacheDocCount = -1
}
```

- [ ] **Step 4.4 — Esegui i test**

```bash
npm test -- --reporter=verbose src/main/__tests__/rag.test.ts
```

Output atteso: tutti i test passano.

- [ ] **Step 4.5 — Suite completa**

```bash
npm run typecheck && npm test
```

Output atteso: 0 errori, tutti i test passano.

- [ ] **Step 4.6 — Commit**

```bash
git add src/main/ai/rag.ts src/main/__tests__/rag.test.ts
git commit -m "feat(rag): chunkText, cosineSimilarity, ingestPdf, retrieveFromBooks with tests"
```

---

## Task 5 — `ragAutoIndex.ts` — indicizzazione automatica all'avvio

**Files:**
- Create: `src/main/ai/ragAutoIndex.ts`

Questo modulo viene chiamato una volta all'avvio. Scansiona `data/*.pdf`, confronta con i filename già in SQLite, indicizza quelli nuovi e rimuove le righe per i PDF eliminati dalla cartella.

- [ ] **Step 5.1 — Crea `src/main/ai/ragAutoIndex.ts`**

```typescript
import { readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { app } from 'electron'
import { ingestPdf, invalidateChunkCache } from './rag'
import * as ragRepository from '../store/ragRepository'

function getDataDir(): string {
  // In dev (and packaged if data/ is alongside the exe)
  const appPath = app.getAppPath()
  const candidate = join(appPath, 'data')
  if (existsSync(candidate)) return candidate
  // Packaged fallback: resources/data (requires extraResources in electron-builder)
  return join(process.resourcesPath ?? appPath, 'data')
}

/**
 * Called once at app startup (after initDb).
 * - Indexes PDFs in data/ that are not yet in SQLite
 * - Removes rows for PDFs no longer present on disk
 */
export async function autoIndexRagBooks(): Promise<void> {
  const dataDir = getDataDir()
  if (!existsSync(dataDir)) {
    console.info('[RAG] data/ directory not found — skipping auto-index')
    return
  }

  const pdfFiles = readdirSync(dataDir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))

  const indexed = ragRepository.getIndexedFilenames()

  // Remove rows for PDFs deleted from disk
  for (const filename of indexed) {
    if (!pdfFiles.includes(filename)) {
      console.info(`[RAG] Removing deleted book: ${filename}`)
      ragRepository.deleteDocumentByFilename(filename)
    }
  }

  // Index new PDFs
  const toIndex = pdfFiles.filter((f) => !indexed.has(f))
  if (toIndex.length === 0) {
    console.info(`[RAG] All ${pdfFiles.length} book(s) already indexed`)
    invalidateChunkCache()
    return
  }

  console.info(`[RAG] Indexing ${toIndex.length} new book(s)…`)
  for (const filename of toIndex) {
    const filePath = join(dataDir, filename)
    try {
      console.info(`[RAG]  → ${filename}`)
      const doc = await ingestPdf(filePath, (p) => {
        if (p.phase === 'embedding' && p.current % 50 === 0) {
          console.info(`[RAG]     embedding ${p.current}/${p.total}`)
        }
      })
      console.info(`[RAG]  ✓ ${doc.title} — ${doc.chunkCount} chunks`)
    } catch (err) {
      console.error(`[RAG] Failed to index ${filename}:`, err instanceof Error ? err.message : err)
      // Don't stop — continue with remaining books
    }
  }

  invalidateChunkCache()
  console.info('[RAG] Auto-index complete')
}
```

- [ ] **Step 5.2 — Typecheck**

```bash
npm run typecheck
```

Output atteso: 0 errori.

- [ ] **Step 5.3 — Commit**

```bash
git add src/main/ai/ragAutoIndex.ts
git commit -m "feat(rag): ragAutoIndex - scan data/*.pdf at startup, incremental sync"
```

---

## Task 6 — Chiamata in `src/main/index.ts`

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 6.1 — Aggiungi l'import e la chiamata in `src/main/index.ts`**

Leggi il file e cerca il blocco `app.whenReady().then(async () => {`. Aggiungi l'import in cima:

```typescript
import { autoIndexRagBooks } from './ai/ragAutoIndex'
```

Poi, **dopo** la riga `initDb(defaultDbPath(...))` (e le migrazioni), aggiungi:

```typescript
  // Auto-index SQL books from data/ folder (non-blocking — logs to console)
  autoIndexRagBooks().catch((err) =>
    console.error('[RAG] autoIndexRagBooks failed:', err instanceof Error ? err.message : err)
  )
```

L'indicizzazione è fire-and-forget intenzionale: l'app si apre subito; i libri vengono indicizzati in background durante il primo avvio (o quando se ne aggiungono di nuovi).

- [ ] **Step 6.2 — Typecheck + test suite**

```bash
npm run typecheck && npm test
```

Output atteso: 0 errori, tutti i test passano.

- [ ] **Step 6.3 — Commit**

```bash
git add src/main/index.ts
git commit -m "feat(rag): call autoIndexRagBooks() at app startup (fire-and-forget)"
```

---

## Task 7 — IPC read-only + preload bridge

**Files:**
- Modify: `src/main/ipc/types.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 7.1 — Aggiungi canale a `src/main/ipc/types.ts`**

Dopo `AI_CHECK = 'ai:check',` aggiungi:

```typescript
  // RAG — read-only status for renderer
  RAG_GET_DOCUMENTS = 'rag:getDocuments',
```

Aggiungi i tipi in fondo al file:

```typescript
export interface RagDocument {
  id: string
  filename: string
  title: string
  addedAt: string
  chunkCount: number
}
```

- [ ] **Step 7.2 — Aggiungi handler a `src/main/ipc/handlers.ts`**

Import in cima (accanto agli altri import AI):

```typescript
import * as ragRepository from '../store/ragRepository'
import type { RagDocument } from './types'
```

Handler **prima** di `// Restore original ipcMain.handle`:

```typescript
  // RAG_GET_DOCUMENTS — lista libri indicizzati (sola lettura)
  ipcMain.handle(IpcChannel.RAG_GET_DOCUMENTS, async (): Promise<IpcResult<RagDocument[]>> => {
    try {
      return { ok: true, data: ragRepository.getAllDocuments() }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })
```

- [ ] **Step 7.3 — Aggiorna `src/preload/index.ts`**

In `realApi`, dopo `aiCheck`:

```typescript
  rag: {
    getDocuments: (): Promise<IpcResult<RagDocument[]>> =>
      ipcRenderer.invoke(IpcChannel.RAG_GET_DOCUMENTS)
  },
```

In `mockApi`, dopo `aiCheck`:

```typescript
  rag: {
    getDocuments: async (): Promise<IpcResult<RagDocument[]>> => ({ ok: true, data: [] })
  },
```

In `bridgeApi`, dopo `aiCheck`:

```typescript
  rag: {
    getDocuments: () => api.rag.getDocuments()
  },
```

- [ ] **Step 7.4 — Aggiorna `src/preload/index.d.ts`**

Aggiungi prima della fine di `SqlSentinelAPI`:

```typescript
export interface RagDocument {
  id: string
  filename: string
  title: string
  addedAt: string
  chunkCount: number
}
```

In `SqlSentinelAPI`:

```typescript
  rag: {
    getDocuments(): Promise<IpcResult<RagDocument[]>>
  }
```

- [ ] **Step 7.5 — Typecheck**

```bash
npm run typecheck
```

Output atteso: 0 errori.

- [ ] **Step 7.6 — Commit**

```bash
git add src/main/ipc/types.ts src/main/ipc/handlers.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(rag): RAG_GET_DOCUMENTS IPC channel + preload bridge (read-only)"
```

---

## Task 8 — UI `RAGStatus.tsx` + tab "Libri" in `AIPanel.tsx`

**Files:**
- Create: `src/renderer/src/components/ai/RAGStatus.tsx`
- Modify: `src/renderer/src/components/ai/AIPanel.tsx`

- [ ] **Step 8.1 — Crea `src/renderer/src/components/ai/RAGStatus.tsx`**

Componente read-only: mostra la lista dei libri indicizzati. Nessun bottone di upload.

```typescript
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import { tokens } from '../../styles/tokens'
import type { RagDocument } from '../../../../preload/index'

export function RAGStatus(): React.JSX.Element {
  const [documents, setDocuments] = useState<RagDocument[]>([])

  useEffect(() => {
    window.sqlSentinel.rag.getDocuments().then((result) => {
      if (result.ok) setDocuments(result.data)
    })
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <MenuBookIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography sx={{ fontSize: tokens.font.sizeSm, fontWeight: tokens.font.weightSemibold }}>
          Libri SQL indicizzati ({documents.length})
        </Typography>
      </Box>

      {documents.length === 0 ? (
        <Box sx={{ py: 2, textAlign: 'center' }}>
          <Typography sx={{ fontSize: tokens.font.sizeSm, color: 'text.disabled' }}>
            Nessun libro indicizzato.
          </Typography>
          <Typography sx={{ fontSize: tokens.font.sizeXs, color: 'text.disabled', mt: 0.5 }}>
            Aggiungi PDF in <code>data/</code> e riavvia l&apos;app.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {documents.map((doc) => (
            <Box
              key={doc.id}
              sx={{
                px: 1.5,
                py: 1,
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper'
              }}
            >
              <Typography
                sx={{
                  fontSize: tokens.font.sizeSm,
                  fontWeight: tokens.font.weightSemibold,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {doc.title}
              </Typography>
              <Typography sx={{ fontSize: tokens.font.sizeXs, color: 'text.secondary' }}>
                {doc.chunkCount} chunk · {doc.filename}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
```

- [ ] **Step 8.2 — Modifica `src/renderer/src/components/ai/AIPanel.tsx`**

Aggiungi gli import:

```typescript
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import { RAGStatus } from './RAGStatus'
```

Aggiungi stato tab dopo `const [input, setInput] = useState('')`:

```typescript
const [activeTab, setActiveTab] = useState<'chat' | 'books'>('chat')
```

Sostituisci il blocco header `{/* Header */}` con questa versione che include le tab:

```typescript
      {/* Header */}
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 0,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: tokens.color.primary,
          color: '#fff',
          flexShrink: 0
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <SmartToyIcon sx={{ fontSize: 20 }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: tokens.font.sizeMd, fontWeight: tokens.font.weightBold, lineHeight: 1.2 }}>
              Assistente AI DBA
            </Typography>
            <Typography sx={{ fontSize: tokens.font.sizeXs, opacity: 0.85 }}>
              Code Llama · tutto locale
            </Typography>
          </Box>
          {activeTab === 'chat' && (
            <Tooltip title="Cancella cronologia">
              <IconButton size="small" onClick={clear} sx={{ color: 'rgba(255,255,255,0.8)' }}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Chiudi">
            <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(255,255,255,0.8)' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v as 'chat' | 'books')}
          sx={{
            minHeight: 32,
            '& .MuiTab-root': {
              minHeight: 32,
              fontSize: tokens.font.sizeXs,
              color: 'rgba(255,255,255,0.7)',
              py: 0.5
            },
            '& .Mui-selected': { color: '#fff !important' },
            '& .MuiTabs-indicator': { backgroundColor: '#fff' }
          }}
        >
          <Tab value="chat" label="Chat" />
          <Tab value="books" label="Libri" />
        </Tabs>
      </Box>
```

Avvolgi il blocco messages + input in un condizionale:

```typescript
      {activeTab === 'chat' ? (
        <>
          {/* Messages area — INVARIATO */}
          ...
          {/* Input area — INVARIATO */}
          ...
        </>
      ) : (
        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2, bgcolor: 'background.default' }}>
          <RAGStatus />
        </Box>
      )}
```

- [ ] **Step 8.3 — Typecheck**

```bash
npm run typecheck
```

Output atteso: 0 errori.

- [ ] **Step 8.4 — Commit**

```bash
git add src/renderer/src/components/ai/RAGStatus.tsx src/renderer/src/components/ai/AIPanel.tsx
git commit -m "feat(rag): RAGStatus read-only panel + Books tab in AIPanel"
```

---

## Task 9 — Arricchimento del system prompt in `agent.ts`

**Files:**
- Modify: `src/main/ai/agent.ts`

- [ ] **Step 9.1 — Sostituisci `src/main/ai/agent.ts`**

```typescript
import { gatherContext } from './context'
import { ollamaChat } from './ollama'
import { retrieveFromBooks } from './rag'
import type { ChatMessage } from './ollama'

const SYSTEM_PROMPT = `Sei un DBA esperto SQL Server. Rispondi SEMPRE in italiano.
Struttura la risposta in 3 sezioni brevi:
1. OSSERVAZIONE: cosa vedi nei dati
2. CAUSA PROBABILE: diagnosi
3. AZIONE IMMEDIATA: query SELECT da eseguire (no DROP/DELETE/UPDATE)
Se i dati non bastano scrivi solo "Ho bisogno di più contesto".`

export async function aiAsk(
  question: string,
  history: ChatMessage[] = []
): Promise<string> {
  const [ctx, bookChunks] = await Promise.all([
    gatherContext(),
    retrieveFromBooks(question, 5)
  ])

  const bookSection =
    bookChunks.length > 0
      ? `\n\nCONOSCENZA DAI LIBRI SQL:\n${bookChunks
          .map((c, i) => `[${i + 1}] ${c.content}`)
          .join('\n\n')}`
      : ''

  const systemWithCtx = `${SYSTEM_PROMPT}${bookSection}\n\nDATI CORRENTI:\n${JSON.stringify(ctx, null, 2)}`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemWithCtx },
    ...history.slice(-6),
    { role: 'user', content: question }
  ]
  return ollamaChat(messages)
}
```

- [ ] **Step 9.2 — Typecheck + test suite completa**

```bash
npm run typecheck && npm test
```

Output atteso: 0 errori typecheck, tutti i test passano (174+).

- [ ] **Step 9.3 — Commit finale**

```bash
git add src/main/ai/agent.ts
git commit -m "feat(rag): inject top-5 book excerpts into AI system prompt"
```

---

## Smoke test

```bash
# 1. Copia un PDF SQL in data/
cp ~/Downloads/sql-server-internals.pdf data/

# 2. Avvia Ollama con il modello di embedding
ollama serve &
ollama pull nomic-embed-text   # ~274 MB — solo la prima volta

# 3. Avvia l'app
npm run dev
```

**Verifica nel log del main process:**
```
[RAG] Indexing 1 new book(s)…
[RAG]  → sql-server-internals.pdf
[RAG]     embedding 50/1200
[RAG]     embedding 100/1200
...
[RAG]  ✓ SQL Server Internals — 1247 chunks
[RAG] Auto-index complete
```

**Verifica nel pannello AI:**
1. Icona robot → pannello aperto
2. Tab **Libri** → "SQL Server Internals — 1247 chunk"
3. Tab **Chat** → "come funzionano gli indici columnstore?"
4. Risposta cita `[1]`, `[2]`, `[3]` con excerpts dal libro

**Secondo avvio** (senza PDF nuovi):
```
[RAG] All 1 book(s) already indexed
```

---

## Note operative

| Scenario | Comportamento |
|----------|---------------|
| Nuovo PDF in `data/` | Indicizzato al prossimo avvio |
| PDF rimosso da `data/` | Riga rimossa da SQLite al prossimo avvio (CASCADE sui chunk) |
| Ollama non attivo | `autoIndexRagBooks` fallisce silenziosamente (log errore), app apre normalmente |
| `nomic-embed-text` non scaricato | Errore per ogni chunk, log `[RAG] Failed to index ...` |
| Libro molto grande (2000+ chunk) | Indicizzazione richiede ~30-60 min; il log mostra progresso ogni 50 chunk |
| Modello alternativo più veloce | Cambia il default in `ollamaEmbed(text, 'all-minilm')` — vettori 384-dim, più veloci ma meno precisi |
