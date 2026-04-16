import { readdir, stat, readFile } from 'fs/promises'
import { join } from 'path'
import { createRequire } from 'node:module'
import { app } from 'electron'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { OllamaEmbeddings } from '@langchain/ollama'
import { isDocumentIndexed, saveDocument } from '../store/ragRepository'

const _require = createRequire(import.meta.url)
// pdf-parse 1.x è un modulo CJS puro — createRequire garantisce la funzione diretta
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = (_require('pdf-parse') as any) as (buf: Buffer) => Promise<{ text: string; numpages: number }>

const DATA_DIR = app.isPackaged
  ? join(process.resourcesPath, 'data')
  : join(process.cwd(), 'data')

const EMBED_MODEL = 'nomic-embed-text'
const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 50
const EMBED_BATCH = 20

export async function autoIndexRagBooks(): Promise<void> {
  let files: string[]
  try {
    const entries = await readdir(DATA_DIR)
    files = entries.filter((f) => f.endsWith('.pdf'))
  } catch {
    // data/ non presente — non è un errore bloccante
    return
  }

  if (files.length === 0) return

  const embeddings = new OllamaEmbeddings({
    model: EMBED_MODEL,
    baseUrl: 'http://localhost:11434'
  })

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP
  })

  for (const filename of files) {
    const filePath = join(DATA_DIR, filename)
    const { size } = await stat(filePath)

    if (isDocumentIndexed(filename, size)) {
      console.log(`[RAG] Already indexed: ${filename}`)
      continue
    }

    console.log(`[RAG] Indexing: ${filename} (${Math.round(size / 1024 / 1024)} MB)`)
    try {
      const buffer = await readFile(filePath)
      const { text } = await pdfParse(buffer)
      const docs = await splitter.createDocuments([text])
      const texts = docs.map((d) => d.pageContent)

      // Embed in batch per non saturare Ollama
      const allEmbeddings: number[][] = []
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH)
        const vecs = await embeddings.embedDocuments(batch)
        allEmbeddings.push(...vecs)
        if (i % 200 === 0 && i > 0) {
          console.log(`[RAG] ${filename}: ${i}/${texts.length} chunks embedded`)
        }
      }

      saveDocument({
        id: crypto.randomUUID(),
        filename,
        fileSize: size,
        indexedAt: new Date().toISOString(),
        chunks: texts.map((t, i) => ({ text: t, embedding: allEmbeddings[i] }))
      })
      console.log(`[RAG] Done: ${filename} — ${texts.length} chunks`)
    } catch (err) {
      console.error(
        `[RAG] Failed to index ${filename}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}
