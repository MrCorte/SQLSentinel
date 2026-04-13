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

  // 3. Embed all chunks BEFORE inserting anything into the DB.
  //    This prevents ghost documents with 0 chunks when Ollama is unreachable.
  const total = textChunks.length
  const embeddings: number[][] = []
  for (let i = 0; i < textChunks.length; i++) {
    onProgress?.({ phase: 'embedding', current: i + 1, total })
    embeddings.push(await ollamaEmbed(textChunks[i]))
  }

  // 4. Persist document + chunks atomically (embedding succeeded for all)
  const doc = ragRepository.insertDocument({
    filename,
    title,
    addedAt: new Date().toISOString(),
    chunkCount: 0
  })

  const chunkRows: Omit<RagChunk, 'id'>[] = textChunks.map((content, i) => ({
    documentId: doc.id,
    chunkIndex: i,
    content,
    embedding: embeddings[i]
  }))

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
