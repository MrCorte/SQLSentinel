import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockProviderStream = vi.fn()
const mockProviderHealth = vi.fn(async () => true)
vi.mock('../providers', () => ({
  getProvider: vi.fn(() => ({
    name: 'claude',
    model: 'claude-test',
    health: mockProviderHealth,
    stream: mockProviderStream
  }))
}))
vi.mock('../../store/sqlserver/serverRepository', () => ({
  getAll: vi.fn(() => []),
  getAllStripped: vi.fn(() => [])
}))
vi.mock('../../store/sqlserver/metricsRepository', () => ({
  findLastNBulk: vi.fn(async () => ({}))
}))
vi.mock('../../metricsWorker', () => ({ getAlerts: vi.fn(() => []) }))
vi.mock('../../store/sqlserver/knowledgeRepository', () => ({
  searchFts: vi.fn(async () => []),
  semanticSearch: vi.fn(async () => [
    { title: 'Mock Semantic', text: 'Relevant semantic result.', score: 0.82 }
  ]),
  warmupEmbedder: vi.fn(async () => {})
}))
import { langGraphAsk, langGraphStream, abortActiveStream } from '../langGraphAgent'
import type { AiStreamEvent } from '../../ipc/types'

beforeEach(() => {
  vi.clearAllMocks()
  mockProviderHealth.mockResolvedValue(true)
  mockProviderStream.mockImplementation(async (req) => {
    req.onEvent({ type: 'token', text: 'Hello world' })
    req.onEvent({ type: 'done' })
  })
})

describe('langGraphStream', () => {
  it('langGraphAsk returns text from the configured provider path', async () => {
    const answer = await langGraphAsk('test', [])

    expect(answer).toBe('Hello world')
    expect(mockProviderStream).toHaveBeenCalledOnce()
  })

  it('emits token events for LLM output', async () => {
    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events).toContainEqual({ type: 'token', text: 'Hello world' })
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })

  it('streams through the configured provider instead of hardcoded Ollama', async () => {
    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(mockProviderHealth).toHaveBeenCalledOnce()
    expect(mockProviderStream).toHaveBeenCalledOnce()
    expect(mockProviderStream.mock.calls[0][0].systemPrompt).toContain('SQL Server DBA assistant')
  })

  it('emits tool_start and tool_end for all five parallel tools', async () => {
    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    const toolNames = events.filter((e) => e.type === 'tool_start').map((e) => (e as { type: 'tool_start'; name: string }).name)
    expect(toolNames).toContain('get_server_metrics')
    expect(toolNames).toContain('get_recent_alerts')
    expect(toolNames).toContain('knowledge_retrieval')
    expect(toolNames).toContain('get_slow_queries')
    expect(toolNames).toContain('get_server_notes')
  })

  it('injects <<KNOWLEDGE>> block when semantic search returns results', async () => {
    await langGraphStream('blocking query', [], () => {})

    const systemPrompt = mockProviderStream.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('<<KNOWLEDGE>>')
    expect(systemPrompt).toContain('Mock Semantic')
  })

  it('emits error event when LLM stream throws', async () => {
    mockProviderStream.mockImplementation(async () => {
      throw new Error('Provider down')
    })

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events.find((e) => e.type === 'error')).toMatchObject({ type: 'error', message: 'Provider down' })
  })

  it('stops emitting tokens once abortActiveStream() is called mid-stream', async () => {
    mockProviderStream.mockImplementation(async (req) => {
      req.onEvent({ type: 'token', text: 'before' })
      abortActiveStream()
      if (!req.signal.aborted) {
        req.onEvent({ type: 'token', text: 'after' })
      }
    })

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    const tokens = events.filter((e) => e.type === 'token').map((e) => (e as { type: 'token'; text: string }).text)
    // 'before' may or may not arrive depending on tool ordering; 'after' must not.
    expect(tokens).not.toContain('after')
  })
})
