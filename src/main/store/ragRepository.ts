import { getDb } from './database'

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isDocumentIndexed(filename: string, fileSize: number): boolean {
  const row = getDb()
    .prepare('SELECT id FROM rag_documents WHERE filename = ? AND file_size = ?')
    .get(filename, fileSize)
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
  db.transaction(() => {
    db.prepare(
      'INSERT OR REPLACE INTO rag_documents (id, filename, file_size, indexed_at, chunk_count) VALUES (?, ?, ?, ?, ?)'
    ).run(doc.id, doc.filename, doc.fileSize, doc.indexedAt, doc.chunks.length)

    // Delete existing chunks (handles OR REPLACE on rag_documents)
    db.prepare('DELETE FROM rag_chunks WHERE document_id = ?').run(doc.id)

    const ins = db.prepare(
      'INSERT INTO rag_chunks (id, document_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)'
    )
    for (let i = 0; i < doc.chunks.length; i++) {
      ins.run(`${doc.id}:${i}`, doc.id, i, doc.chunks[i].text, encodeEmbedding(doc.chunks[i].embedding))
    }
  })()
}

export function retrieveTopK(
  queryEmbedding: number[],
  k = 5
): { text: string; score: number }[] {
  const rows = getDb()
    .prepare('SELECT text, embedding FROM rag_chunks')
    .all() as { text: string; embedding: Buffer }[]

  if (rows.length === 0) return []

  const qv = new Float32Array(queryEmbedding)
  return rows
    .map((r) => ({ text: r.text, score: cosine(qv, decodeEmbedding(r.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

export function getAllDocuments(): RagDocument[] {
  return getDb()
    .prepare('SELECT id, filename, file_size AS fileSize, indexed_at AS indexedAt, chunk_count AS chunkCount FROM rag_documents ORDER BY indexed_at DESC')
    .all() as RagDocument[]
}
