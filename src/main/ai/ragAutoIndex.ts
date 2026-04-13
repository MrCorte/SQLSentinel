import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

  const pdfFiles = readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith('.pdf'))

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
      console.error(
        `[RAG] Failed to index ${filename}:`,
        err instanceof Error ? err.message : err
      )
      // Don't stop — continue with remaining books
    }
  }

  invalidateChunkCache()
  console.info('[RAG] Auto-index complete')
}
