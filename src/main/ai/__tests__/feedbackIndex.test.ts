import { describe, it, expect, vi, beforeEach } from 'vitest'

function packF32(vals: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vals.length * 4)
  vals.forEach((v, i) => buf.writeFloatLE(v, i * 4))
  return buf
}

const VEC_A = packF32([1, 0, 0, ...new Array(765).fill(0)])
const VEC_A_ARRAY = [1, 0, 0, ...new Array(765).fill(0)]
const VEC_ORTHOGONAL = [0, 1, 0, ...new Array(765).fill(0)]

vi.mock('../../store/sqlserver/aiFeedbackRepository', () => ({
  listEmbeddable: vi.fn(async () => [
    {
      id: 'row-1',
      question: 'show blocking sessions',
      response: 'SELECT * FROM sys.dm_exec_requests',
      questionHash: 'h1',
      rating: 1 as const,
      embedding: VEC_A,
      provider: 'ollama',
      model: 'gemma',
      incidentId: null,
      createdAt: '2026-05-26T10:00:00Z',
      createdBy: null
    }
  ])
}))

vi.mock('../ollama', () => ({ OLLAMA_HOST: 'http://localhost:11434' }))
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

describe('feedbackIndex', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('findSimilar returns matching row when query embedding is identical to stored', async () => {
    const mod = await import('../feedbackIndex')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [VEC_A_ARRAY] })
    })
    await mod.preWarm()
    const hits = await mod.findSimilar('something', 2)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('row-1')
    expect(hits[0].score).toBeGreaterThan(0.99)
  })

  it('findSimilar filters below SIMILARITY_THRESHOLD (0.6)', async () => {
    const mod = await import('../feedbackIndex')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [VEC_ORTHOGONAL] })
    })
    await mod.preWarm()
    const hits = await mod.findSimilar('unrelated', 2)
    expect(hits).toEqual([])
  })

  it('findSimilar returns empty array when index is empty', async () => {
    vi.doMock('../../store/sqlserver/aiFeedbackRepository', () => ({
      listEmbeddable: vi.fn(async () => [])
    }))
    const mod = await import('../feedbackIndex')
    await mod.preWarm()
    global.fetch = vi.fn()
    const hits = await mod.findSimilar('anything', 2)
    expect(hits).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('addRow makes a new entry immediately retrievable', async () => {
    vi.doMock('../../store/sqlserver/aiFeedbackRepository', () => ({
      listEmbeddable: vi.fn(async () => [])
    }))
    const mod = await import('../feedbackIndex')
    await mod.preWarm()
    mod.addRow({
      id: 'new-1',
      question: 'test',
      response: 'answer',
      vec: new Float32Array(VEC_A_ARRAY)
    })
    expect(mod.size()).toBe(1)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [VEC_A_ARRAY] })
    })
    const hits = await mod.findSimilar('test', 2)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('new-1')
  })

  it('removeRow drops an entry by id', async () => {
    vi.doMock('../../store/sqlserver/aiFeedbackRepository', () => ({
      listEmbeddable: vi.fn(async () => [])
    }))
    const mod = await import('../feedbackIndex')
    await mod.preWarm()
    mod.addRow({ id: 'a', question: 'q', response: 'r', vec: new Float32Array(VEC_A_ARRAY) })
    mod.addRow({ id: 'b', question: 'q2', response: 'r2', vec: new Float32Array(VEC_A_ARRAY) })
    expect(mod.size()).toBe(2)
    mod.removeRow('a')
    expect(mod.size()).toBe(1)
  })

  it('findSimilar swallows embedder failure and returns []', async () => {
    const mod = await import('../feedbackIndex')
    await mod.preWarm()
    global.fetch = vi.fn().mockRejectedValue(new Error('Ollama down'))
    const hits = await mod.findSimilar('anything', 2)
    expect(hits).toEqual([])
  })
})
