import { getDb } from './database'
import type Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'

export interface RagDocument {
  id: string
  filename: string
  fileSize: number
  indexedAt: string
  chunkCount: number
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function encodeEmbedding(v: number[]): Buffer {
  const buf = Buffer.allocUnsafe(v.length * 4)
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i], i * 4)
  return buf
}

function decodeEmbedding(blob: Buffer): Float32Array {
  const arr = new Float32Array(blob.byteLength / 4)
  for (let i = 0; i < arr.length; i++) arr[i] = blob.readFloatLE(i * 4)
  return arr
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, ma = 0, mb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    ma += a[i] * a[i]
    mb += b[i] * b[i]
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb)
  return denom === 0 ? 0 : dot / denom
}

interface RagDocumentIdRow {
  id: string
}

interface RagChunkRow {
  text: string
  embedding: Buffer
}

// ---------------------------------------------------------------------------
// Cached prepared statements
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null
let _stmts: {
  isDocumentIndexed: Statement<[string, number], RagDocumentIdRow>
  upsertDocument: Statement<[string, string, number, string, number]>
  deleteChunks: Statement<[string]>
  insertChunk: Statement<[string, string, number, string, Buffer]>
  getAllChunks: Statement<[], RagChunkRow>
  getAllDocuments: Statement<[], RagDocument>
} | null = null

function stmts() {
  const db = getDb()
  if (_stmts && _db === db) return _stmts
  _db = db
  _stmts = {
    isDocumentIndexed: db.prepare<[string, number], RagDocumentIdRow>(
      'SELECT id FROM rag_documents WHERE filename = ? AND file_size = ?'
    ),
    upsertDocument: db.prepare<[string, string, number, string, number]>(
      'INSERT OR REPLACE INTO rag_documents (id, filename, file_size, indexed_at, chunk_count) VALUES (?, ?, ?, ?, ?)'
    ),
    deleteChunks: db.prepare<[string]>('DELETE FROM rag_chunks WHERE document_id = ?'),
    insertChunk: db.prepare<[string, string, number, string, Buffer]>(
      'INSERT INTO rag_chunks (id, document_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)'
    ),
    getAllChunks: db.prepare<[], RagChunkRow>('SELECT text, embedding FROM rag_chunks'),
    getAllDocuments: db.prepare<[], RagDocument>(
      'SELECT id, filename, file_size AS fileSize, indexed_at AS indexedAt, chunk_count AS chunkCount FROM rag_documents ORDER BY indexed_at DESC'
    ),
  }
  return _stmts
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isDocumentIndexed(filename: string, fileSize: number): boolean {
  const row = stmts().isDocumentIndexed.get(filename, fileSize)
  return row !== undefined
}

export function saveDocument(doc: {
  id: string
  filename: string
  fileSize: number
  indexedAt: string
  chunks: { text: string; embedding: number[] }[]
}): void {
  const db = getDb()
  const s = stmts()
  db.transaction(() => {
    s.upsertDocument.run(doc.id, doc.filename, doc.fileSize, doc.indexedAt, doc.chunks.length)

    // Delete existing chunks (handles OR REPLACE on rag_documents)
    s.deleteChunks.run(doc.id)

    for (let i = 0; i < doc.chunks.length; i++) {
      s.insertChunk.run(`${doc.id}:${i}`, doc.id, i, doc.chunks[i].text, encodeEmbedding(doc.chunks[i].embedding))
    }
  })()
}

export function retrieveTopK(
  queryEmbedding: number[],
  k = 5
): { text: string; score: number }[] {
  const rows = stmts().getAllChunks.all()

  if (rows.length === 0) return []

  const qv = new Float32Array(queryEmbedding)
  return rows
    .map((r) => ({ text: r.text, score: cosine(qv, decodeEmbedding(r.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

export function getAllDocuments(): RagDocument[] {
  return stmts().getAllDocuments.all()
}
