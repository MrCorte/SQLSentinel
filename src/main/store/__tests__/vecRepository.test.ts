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

// Fake mssql pool returning one knowledge_embeddings row.
const fakePool = {
  request: () => ({
    input: () => ({ input: () => ({}) }), // unused — knowledge query is parameterless
    query: async (sqlText: string) => {
      const norm = sqlText.replace(/\s+/g, ' ').toLowerCase()
      if (norm.includes('from dbo.knowledge_embeddings')) {
        return {
          recordset: [
            {
              title: 'Blocking',
              text: 'Blocking occurs when session holds lock.',
              embedding: MOCK_EMBEDDING
            }
          ]
        }
      }
      if (norm.includes('from dbo.dba_cards')) return { recordset: [] }
      if (norm.includes('from dbo.knowledge_chunks')) return { recordset: [] }
      return { recordset: [] }
    }
  })
}

vi.mock('../sqlserver/connection', () => ({ getPool: () => fakePool }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => false) }))
vi.mock('../../ai/ollama', () => ({ OLLAMA_HOST: 'http://localhost:11434' }))

import { cosineSimilarity } from '../../ai/embedder'

// Each test calls vi.resetModules() then dynamically re-imports the
// knowledgeRepository module graph (embedder + connection + ollama). That cold
// re-import is cheap in isolation but can exceed the 5s default under a
// saturated full-suite run, so give these tests headroom — the work itself is
// correct, only the wall-clock budget was too tight.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 })

describe('knowledgeRepository', () => {
  beforeEach(() => {
    vi.resetModules() // fresh module = caches start null; query cache also empty
  })

  it('cosineSimilarity returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
  })

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })

  it('cosineSimilarity returns 0 for mismatched dimensions', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0)
  })

  it('semanticSearch returns ranked results from loaded index', async () => {
    const { semanticSearch } = await import('../sqlserver/knowledgeRepository')
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
    const { semanticSearch } = await import('../sqlserver/knowledgeRepository')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await expect(semanticSearch('blocking', 3)).rejects.toThrow(/Ollama embed error: 500/)
  })

  it('semanticSearch throws on malformed JSON', async () => {
    const { semanticSearch } = await import('../sqlserver/knowledgeRepository')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('bad json')
      }
    })
    await expect(semanticSearch('blocking', 3)).rejects.toThrow(/malformed JSON/)
  })

  it('semanticSearch throws on empty embeddings array', async () => {
    const { semanticSearch } = await import('../sqlserver/knowledgeRepository')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [] })
    })
    await expect(semanticSearch('blocking', 3)).rejects.toThrow(/unexpected response shape/)
  })

  it('semanticSearch filters out results below SCORE_THRESHOLD (0.5)', async () => {
    const { semanticSearch } = await import('../sqlserver/knowledgeRepository')
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
    const { semanticSearch } = await import('../sqlserver/knowledgeRepository')
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
