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
vi.mock('../../store/serverStore', () => ({
  getAll: vi.fn(() => []),
  getAllStripped: vi.fn(() => [])
}))
vi.mock('../../store/metricsRepository', () => ({ findLastNBulk: vi.fn(() => ({})) }))
vi.mock('../../metricsWorker', () => ({ getAlerts: vi.fn(() => []) }))
vi.mock('../../store/ftsRepository', () => ({ searchFts: vi.fn(() => []) }))
vi.mock('../../store/vecRepository', () => ({ semanticSearch: vi.fn(async () => [
  { title: 'Mock Semantic', text: 'Relevant semantic result.', score: 0.82 }
]) }))
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

  it('emits tool_start and tool_end for all six parallel tools', async () => {
    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    const toolNames = events.filter((e) => e.type === 'tool_start').map((e) => (e as { type: 'tool_start'; name: string }).name)
    expect(toolNames).toContain('get_server_metrics')
    expect(toolNames).toContain('get_recent_alerts')
    expect(toolNames).toContain('search_sql_documentation')
    expect(toolNames).toContain('get_slow_queries')
    expect(toolNames).toContain('get_server_notes')
    expect(toolNames).toContain('semantic_knowledge_search')
  })

  it('injects <<SEMANTIC_DOCS>> block when semantic search returns results', async () => {
    await langGraphStream('blocking query', [], () => {})

    const systemPrompt = mockProviderStream.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('<<SEMANTIC_DOCS>>')
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
