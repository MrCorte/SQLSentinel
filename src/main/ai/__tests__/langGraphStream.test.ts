import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock LangGraph agent factory — must come before importing langGraphAgent
const mockStream = vi.fn()
const mockAgent = { stream: mockStream }
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn(() => mockAgent)
}))
vi.mock('@langchain/ollama', () => ({
  ChatOllama: vi.fn()
}))
vi.mock('../../store/serverStore', () => ({ getAll: vi.fn(() => []) }))
vi.mock('../../store/metricsRepository', () => ({ findLastNBulk: vi.fn(() => ({})) }))
vi.mock('../../metricsWorker', () => ({ getAlerts: vi.fn(() => []) }))
vi.mock('../../store/ftsRepository', () => ({ searchFts: vi.fn(() => []) }))

import { langGraphStream, abortActiveStream } from '../langGraphAgent'
import type { AiStreamEvent } from '../../ipc/types'

function makeStream(chunks: [string, unknown][]): AsyncIterable<[string, unknown]> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i >= chunks.length) return { done: true, value: undefined }
          return { done: false, value: chunks[i++] }
        }
      }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('langGraphStream', () => {
  it('emits token events for AI message content', async () => {
    mockStream.mockReturnValue(
      makeStream([
        ['messages', [{ _getType: () => 'ai', content: 'Hello' }]],
        ['messages', [{ _getType: () => 'ai', content: ' world' }]]
      ])
    )

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events).toContainEqual({ type: 'token', text: 'Hello' })
    expect(events).toContainEqual({ type: 'token', text: ' world' })
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })

  it('emits tool_start on agent tool_calls', async () => {
    mockStream.mockReturnValue(
      makeStream([
        [
          'updates',
          { agent: { messages: [{ tool_calls: [{ id: 'tc1', name: 'get_server_metrics' }] }] } }
        ],
        [
          'updates',
          { tools: { messages: [{ _getType: () => 'tool', tool_call_id: 'tc1', content: '{}' }] } }
        ]
      ])
    )

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events).toContainEqual({ type: 'tool_start', name: 'get_server_metrics' })
    expect(events).toContainEqual({ type: 'tool_end', name: 'get_server_metrics', output: '{}' })
  })

  it('emits error event when stream throws', async () => {
    mockStream.mockReturnValue({
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

    expect(events[0]).toEqual({ type: 'error', message: 'Ollama down' })
  })

  it('emits error with "Cancelled" when aborted', async () => {
    mockStream.mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            abortActiveStream()
            return { done: false, value: ['messages', [{ _getType: () => 'ai', content: '' }]] }
          }
        }
      }
    })

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events[0]).toEqual({ type: 'error', message: 'Cancelled' })
  })
})
