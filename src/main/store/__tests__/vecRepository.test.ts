import { describe, it, expect, vi, beforeEach } from 'vitest'

// packF32 defined BEFORE vi.mock factory so it's available at hoist time
function packF32(vals: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vals.length * 4)
  vals.forEach((v, i) => buf.writeFloatLE(v, i * 4))
  return buf
}

// Realistic 768-dim mock matching production embeddings: [1, 0, 0, ..., 0]
const MOCK_VEC_768: number[] = [1, ...new Array(767).fill(0)]
const MOCK_EMBEDDING = packF32(MOCK_VEC_768)

vi.mock('better-sqlite3', () => ({
  default: vi.fn(function () {
    return {
      prepare: vi.fn(() => ({
        all: vi.fn(() => [
          { id: 1, title: 'Blocking', chunk_idx: 0, text: 'Blocking occurs when session holds lock.', embedding: MOCK_EMBEDDING }
        ])
      })),
      close: vi.fn()
    }
  })
}))

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('fs', () => ({ existsSync: vi.fn(() => true) }))
vi.mock('../../ai/ollama', () => ({ OLLAMA_HOST: 'http://localhost:11434' }))

describe('vecRepository', () => {
  beforeEach(() => {
    vi.resetModules() // fresh module = _index starts null; queryCache also empty
  })

  it('cosine similarity returns 1 for identical vectors', async () => {
    const { cosineSimilarity } = await import('../vecRepository')
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
  })

  it('cosine similarity returns 0 for orthogonal vectors', async () => {
    const { cosineSimilarity } = await import('../vecRepository')
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })

  it('cosineSimilarity returns 0 for mismatched dimensions', async () => {
    const { cosineSimilarity } = await import('../vecRepository')
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0)
  })

  it('loadIndex returns empty array when DB file absent', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValueOnce(false)
    const { semanticSearch } = await import('../vecRepository')
    global.fetch = vi.fn()
    const results = await semanticSearch('blocking', 3)
    expect(results).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('semanticSearch returns ranked results from loaded index', async () => {
    const { semanticSearch } = await import('../vecRepository')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [MOCK_VEC_768] })
    })
    const results = await semanticSearch('blocking session', 3)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Blocking')
    expect(results[0].score).toBeGreaterThan(0.99)
  })

  it('semanticSearch throws when Ollama returns non-2xx', async () => {
    const { semanticSearch } = await import('../vecRepository')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await expect(semanticSearch('blocking', 3)).rejects.toThrow(/Ollama embed error: 500/)
  })

  it('semanticSearch throws on malformed JSON', async () => {
    const { semanticSearch } = await import('../vecRepository')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json') }
    })
    await expect(semanticSearch('blocking', 3)).rejects.toThrow(/malformed JSON/)
  })

  it('semanticSearch throws on empty embeddings array', async () => {
    const { semanticSearch } = await import('../vecRepository')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [] })
    })
    await expect(semanticSearch('blocking', 3)).rejects.toThrow(/unexpected response shape/)
  })

  it('semanticSearch filters out results below SCORE_THRESHOLD (0.5)', async () => {
    const { semanticSearch } = await import('../vecRepository')
    // Orthogonal query vec → cosine 0 with stored [1,0,...] → filtered out
    const orthogonal = [0, 1, ...new Array(766).fill(0)]
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [orthogonal] })
    })
    const results = await semanticSearch('unrelated', 3)
    expect(results).toEqual([])
  })

  it('semanticSearch caches query embeddings (second call skips fetch)', async () => {
    const { semanticSearch } = await import('../vecRepository')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [MOCK_VEC_768] })
    })
    global.fetch = fetchMock
    await semanticSearch('blocking', 3)
    await semanticSearch('blocking', 3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
