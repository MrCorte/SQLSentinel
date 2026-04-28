import * as sql from 'mssql'
import { getPool } from './connection'

export interface RagDocument {
  id: string
  filename: string
  fileSize: number
  indexedAt: string
  chunkCount: number
}

export interface RagChunk {
  id: string
  documentId: string
  chunkIndex: number
  text: string
}

export interface SimilarChunk extends RagChunk {
  score: number
}

export async function findDocumentByFilename(filename: string): Promise<RagDocument | null> {
  const pool = getPool()
  const r = await pool
    .request()
    .input('filename', sql.NVarChar(500), filename)
    .query<{ id: string; filename: string; file_size: number; indexed_at: string; chunk_count: number }>(
      `SELECT id, filename, file_size, indexed_at, chunk_count FROM dbo.rag_documents WHERE filename = @filename`
    )
  const row = r.recordset[0]
  if (!row) return null
  return {
    id: row.id,
    filename: row.filename,
    fileSize: row.file_size,
    indexedAt: row.indexed_at,
    chunkCount: row.chunk_count
  }
}

export async function upsertDocument(doc: RagDocument): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(36), doc.id)
    .input('filename', sql.NVarChar(500), doc.filename)
    .input('file_size', sql.BigInt, doc.fileSize)
    .input('indexed_at', sql.NVarChar(50), doc.indexedAt)
    .input('chunk_count', sql.Int, doc.chunkCount)
    .query(`MERGE dbo.rag_documents AS t
            USING (SELECT @id AS id, @filename AS filename, @file_size AS file_size,
                          @indexed_at AS indexed_at, @chunk_count AS chunk_count) AS s ON t.id = s.id
            WHEN MATCHED THEN
              UPDATE SET t.filename = s.filename, t.file_size = s.file_size,
                         t.indexed_at = s.indexed_at, t.chunk_count = s.chunk_count
            WHEN NOT MATCHED THEN
              INSERT (id, filename, file_size, indexed_at, chunk_count)
              VALUES (s.id, s.filename, s.file_size, s.indexed_at, s.chunk_count);`)
}

export async function saveChunk(chunk: RagChunk, embedding: number[]): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(36), chunk.id)
    .input('document_id', sql.NVarChar(36), chunk.documentId)
    .input('chunk_index', sql.Int, chunk.chunkIndex)
    .input('text', sql.NVarChar(sql.MAX), chunk.text)
    .input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embedding))
    .query(`INSERT INTO dbo.rag_chunks (id, document_id, chunk_index, text, embedding)
            VALUES (@id, @document_id, @chunk_index, @text, CAST(@embedding AS vector(1536)))`)
}

export async function searchSimilar(queryEmbedding: number[], topK = 5): Promise<SimilarChunk[]> {
  const pool = getPool()
  const r = await pool
    .request()
    .input('qvec', sql.NVarChar(sql.MAX), JSON.stringify(queryEmbedding))
    .input('k', sql.Int, topK)
    .query<{ id: string; document_id: string; chunk_index: number; text: string; score: number }>(`
      SELECT TOP (@k) id, document_id, chunk_index, text,
             VECTOR_DISTANCE('cosine', embedding, CAST(@qvec AS vector(1536))) AS score
      FROM dbo.rag_chunks
      ORDER BY score ASC`)
  return r.recordset.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    text: row.text,
    score: row.score
  }))
}

export async function deleteDocument(id: string): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .query(`DELETE FROM dbo.rag_documents WHERE id = @id`)
}

export async function listDocuments(): Promise<RagDocument[]> {
  const pool = getPool()
  const r = await pool
    .request()
    .query<{ id: string; filename: string; file_size: number; indexed_at: string; chunk_count: number }>(
      `SELECT id, filename, file_size, indexed_at, chunk_count FROM dbo.rag_documents ORDER BY indexed_at DESC`
    )
  return r.recordset.map((row) => ({
    id: row.id,
    filename: row.filename,
    fileSize: row.file_size,
    indexedAt: row.indexed_at,
    chunkCount: row.chunk_count
  }))
}
