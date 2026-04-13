import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// node:fs mock — createReadStream returns an empty readable for ingestPdf tests
// ---------------------------------------------------------------------------

vi.mock('node:fs', async () => {
  const { Readable } = await import('node:stream')
  return {
    createReadStream: vi.fn(() => Readable.from(Buffer.from(''))),
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([])
  }
})

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
    expect(chunkText('Hello SQL Server, this is a short paragraph.')).toHaveLength(1)
  })

  it('splits on double newlines', () => {
    const p1 = 'First paragraph about SQL Server indexes and query plans.'
    const p2 = 'Second paragraph about memory grants and wait statistics.'
    const result = chunkText(`${p1}\n\n${p2}`)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(p1)
    expect(result[1]).toBe(p2)
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

// ---------------------------------------------------------------------------
// Mock Ollama client
// ---------------------------------------------------------------------------

vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(function () {
    return {
      chat: vi.fn(),
      list: vi.fn(),
      embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] })
    }
  })
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
    Ollama.mockImplementation(function () {
      return { embed: vi.fn().mockResolvedValue({ embeddings: [] }) }
    })
    const { ollamaEmbed } = await import('../ai/ollama')
    await expect(ollamaEmbed('test')).rejects.toThrow('empty')
  })
})

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
    const { Ollama } = (await import('ollama')) as any
    Ollama.mockImplementation(function () {
      return {
        chat: vi.fn(),
        list: vi.fn(),
        embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] })
      }
    })
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
    Ollama.mockImplementation(function () {
      return { embed: vi.fn().mockResolvedValue({ embeddings: [[1, 0]] }) } // query ~ c1
    })
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
