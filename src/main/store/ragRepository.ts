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
