import { describe, it, expect, vi, beforeEach } from 'vitest'

// packF32 defined BEFORE vi.mock factory so it's available at hoist time
function packF32(vals: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vals.length * 4)
  vals.forEach((v, i) => buf.writeFloatLE(v, i * 4))
  return buf
}

const MOCK_EMBEDDING = packF32([1, 0, 0])

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

describe('vecRepository', () => {
  beforeEach(() => {
    vi.resetModules()  // fresh module = _index starts null; resetIndex() not needed
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
    // Mock fetch to return embedding identical to the stored [1,0,0] chunk
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[1, 0, 0, ...new Array(765).fill(0)]] })
    })
    const results = await semanticSearch('blocking session', 3)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Blocking')
    expect(results[0].score).toBeGreaterThan(0.99)
  })
})
