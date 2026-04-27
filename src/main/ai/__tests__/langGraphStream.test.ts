import { describe, it, expect, vi, beforeEach } from 'vitest'

// langGraphStream calls getLlm().stream() directly — mock ChatOllama, not the agent.
const mockLlmStream = vi.fn()
const mockLlmInvoke = vi.fn()
vi.mock('@langchain/ollama', () => ({
  ChatOllama: vi.fn(() => ({ stream: mockLlmStream, invoke: mockLlmInvoke }))
}))
vi.mock('@langchain/langgraph/prebuilt', () => ({ createReactAgent: vi.fn() }))
vi.mock('../../store/serverStore', () => ({ getAll: vi.fn(() => []) }))
vi.mock('../../store/metricsRepository', () => ({ findLastNBulk: vi.fn(() => ({})) }))
vi.mock('../../metricsWorker', () => ({ getAlerts: vi.fn(() => []) }))
vi.mock('../../store/ftsRepository', () => ({ searchFts: vi.fn(() => []) }))

import { langGraphStream, abortActiveStream } from '../langGraphAgent'
import type { AiStreamEvent } from '../../ipc/types'

function makeLlmStream(texts: string[]): AsyncIterable<{ content: string }> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i >= texts.length) return { done: true, value: undefined }
          return { done: false, value: { content: texts[i++] } }
        }
      }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('langGraphStream', () => {
  it('emits token events for LLM output', async () => {
    mockLlmStream.mockReturnValue(makeLlmStream(['Hello', ' world']))

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events).toContainEqual({ type: 'token', text: 'Hello' })
    expect(events).toContainEqual({ type: 'token', text: ' world' })
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })

  it('emits tool_start and tool_end for the three parallel tools', async () => {
    mockLlmStream.mockReturnValue(makeLlmStream([]))

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    const toolNames = events.filter((e) => e.type === 'tool_start').map((e) => (e as { type: 'tool_start'; name: string }).name)
    expect(toolNames).toContain('get_server_metrics')
    expect(toolNames).toContain('get_recent_alerts')
    expect(toolNames).toContain('search_sql_documentation')
  })

  it('emits error event when LLM stream throws', async () => {
    mockLlmStream.mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new Error('Ollama down')
          }
        }
      }
    })

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events.find((e) => e.type === 'error')).toMatchObject({ type: 'error', message: 'Ollama down' })
  })

  it('emits error with "Cancelled" when aborted during streaming', async () => {
    mockLlmStream.mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            abortActiveStream()
            return { done: false, value: { content: '' } }
          }
        }
      }
    })

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events.find((e) => e.type === 'error')).toMatchObject({ type: 'error', message: 'Cancelled' })
  })
})
