import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIMessageChunk } from '@langchain/core/messages'

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../ollama', () => ({
  OLLAMA_HOST: 'http://x',
  checkOllamaHealth: vi.fn(async () => true)
}))

// Each stream() call consumes the next scripted "turn" (list of chunks).
const { turns, streamCalls, gate } = vi.hoisted(() => ({
  turns: [] as unknown[][],
  streamCalls: [] as unknown[],
  gate: { release: null as null | (() => void) }
}))

vi.mock('@langchain/ollama', () => {
  class ChatOllama {
    bindTools(): this {
      return this
    }
    async stream(messages: unknown): Promise<AsyncIterable<unknown>> {
      streamCalls.push(messages)
      const chunks = turns.shift() ?? []
      return (async function* () {
        for (const c of chunks) {
          if (c === 'PAUSE') {
            await new Promise<void>((r) => (gate.release = r))
            continue
          }
          yield c
        }
      })()
    }
  }
  return { ChatOllama }
})

import { OllamaProvider } from '../providers/ollamaProvider'
import type { AiStreamEvent } from '../../ipc/types'

function req(over: Partial<Parameters<OllamaProvider['stream']>[0]> = {}) {
  const events: AiStreamEvent[] = []
  return {
    events,
    r: {
      systemPrompt: 'sys',
      messages: [{ role: 'user' as const, content: 'hi' }],
      tools: [],
      onToolCall: vi.fn(async () => 'tool-output'),
      onEvent: (e: AiStreamEvent) => events.push(e),
      signal: new AbortController().signal,
      ...over
    }
  }
}

beforeEach(() => {
  turns.length = 0
  streamCalls.length = 0
  gate.release = null
})

describe('OllamaProvider streaming', () => {
  it('emits tokens as they arrive — before the model has finished', async () => {
    turns.push([
      new AIMessageChunk({ content: 'Hello ' }),
      'PAUSE',
      new AIMessageChunk({ content: 'world' }),
      new AIMessageChunk({
        content: '',
        usage_metadata: { input_tokens: 120, output_tokens: 7, total_tokens: 127 }
      })
    ])
    const onUsage = vi.fn()
    const { events, r } = req({ onUsage })
    const done = new OllamaProvider('m').stream(r)

    // Model is "still generating" (paused) but the first token is already out
    await vi.waitFor(() => expect(gate.release).not.toBeNull())
    expect(events).toEqual([{ type: 'token', text: 'Hello ' }])

    gate.release!()
    await done
    expect(events).toEqual([
      { type: 'token', text: 'Hello ' },
      { type: 'token', text: 'world' },
      { type: 'done' }
    ])
    expect(onUsage).toHaveBeenCalledWith({ tokensIn: 120, tokensOut: 7 })
  })

  it('aggregates streamed tool calls, runs them and continues the loop', async () => {
    turns.push([
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          { name: 'propose_fix', args: '{"spid":55}', id: 't1', index: 0, type: 'tool_call_chunk' }
        ]
      })
    ])
    turns.push([new AIMessageChunk({ content: 'Proposed.' })])
    const { events, r } = req({
      tools: [{ name: 'propose_fix', description: 'd', inputSchema: { type: 'object' } }]
    })
    await new OllamaProvider('m').stream(r)

    expect(r.onToolCall).toHaveBeenCalledWith('propose_fix', { spid: 55 })
    expect(events.map((e) => e.type)).toEqual(['tool_start', 'tool_end', 'token', 'done'])
    expect(streamCalls).toHaveLength(2)
  })

  it('reports Cancelled when aborted mid-stream', async () => {
    const controller = new AbortController()
    turns.push([
      new AIMessageChunk({ content: 'partial' }),
      'PAUSE',
      new AIMessageChunk({ content: 'never' })
    ])
    const { events, r } = req({ signal: controller.signal })
    const done = new OllamaProvider('m').stream(r)
    await vi.waitFor(() => expect(gate.release).not.toBeNull())
    controller.abort()
    gate.release!()
    await done
    expect(events).toEqual([
      { type: 'token', text: 'partial' },
      { type: 'error', message: 'Cancelled' }
    ])
  })
})
