/**
 * Tests for ClaudeProvider performance fixes:
 *  - Fix #1: tool output capped at 8000 chars before API payload
 *  - Fix #2: health() result cached for 60s to avoid repeated API calls
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock state — must use vi.hoisted so these refs are available in
// the vi.mock() factory (which is hoisted before variable declarations).
// ---------------------------------------------------------------------------

const { mockModelsList, mockMessages, mockClient } = vi.hoisted(() => {
  const mockModelsList = vi.fn().mockResolvedValue({ data: [] })

  let _callCount = 0
  let _capturedMessages: unknown[] = []
  let _onToolCall: (() => void) | undefined = undefined

  const mockMessages = {
    resetCallCount: () => {
      _callCount = 0
      _capturedMessages = []
      _onToolCall = undefined
    },
    setOnToolCall: (fn: () => void) => {
      _onToolCall = fn
    },
    getCapturedMessages: () => _capturedMessages,
    getCallCount: () => _callCount,
    stream: vi.fn((params: { messages: unknown[] }) => {
      _callCount++
      _capturedMessages = params.messages
      const isFirstCall = _callCount === 1
      const toolUseBlock = {
        type: 'tool_use' as const,
        id: 'tu_1',
        name: 'test_tool',
        input: {}
      }
      return {
        [Symbol.asyncIterator]: async function* () {
          if (isFirstCall) {
            yield { type: 'content_block_start', content_block: toolUseBlock }
          }
        },
        finalMessage: vi.fn().mockResolvedValue({
          stop_reason: isFirstCall ? 'tool_use' : 'end_turn',
          content: isFirstCall ? [toolUseBlock] : [],
          usage: { input_tokens: 10, output_tokens: 5 }
        })
      }
    })
  }

  const mockClient = {
    models: { list: mockModelsList },
    messages: mockMessages
  }

  return { mockModelsList, mockMessages, mockClient }
})

// ---------------------------------------------------------------------------
// SDK mock — constructor must be a regular function (arrow fns can't be `new`d)
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function MockAnthropic() {
    return mockClient
  })
}))

// Import AFTER mock registration
import { ClaudeProvider } from '../providers/claudeProvider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(): AbortSignal {
  return new AbortController().signal
}

// ---------------------------------------------------------------------------
// Fix #2: health() caching
// ---------------------------------------------------------------------------

describe('ClaudeProvider.health()', () => {
  beforeEach(() => {
    mockModelsList.mockClear()
  })

  it('returns true when models.list() succeeds', async () => {
    const provider = new ClaudeProvider('test-key')
    expect(await provider.health()).toBe(true)
  })

  it('caches successful result: models.list() called only once within 60s', async () => {
    const provider = new ClaudeProvider('test-key')

    await provider.health()
    await provider.health()
    await provider.health()

    expect(mockModelsList).toHaveBeenCalledTimes(1)
  })

  it('makes a fresh API call after 60s TTL expires', async () => {
    const provider = new ClaudeProvider('test-key')
    const realDateNow = Date.now

    try {
      await provider.health()
      expect(mockModelsList).toHaveBeenCalledTimes(1)

      Date.now = () => realDateNow() + 61_000
      await provider.health()
      expect(mockModelsList).toHaveBeenCalledTimes(2)
    } finally {
      Date.now = realDateNow
    }
  })

  it('does not cache failure: retries immediately after a failed check', async () => {
    mockModelsList.mockRejectedValueOnce(new Error('network error'))
    const provider = new ClaudeProvider('test-key')

    expect(await provider.health()).toBe(false)

    mockModelsList.mockResolvedValueOnce({ data: [] })
    expect(await provider.health()).toBe(true)
    expect(mockModelsList).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Fix #1: tool output cap in API payload
// ---------------------------------------------------------------------------

describe('ClaudeProvider.stream() — tool output cap', () => {
  beforeEach(() => {
    mockMessages.resetCallCount()
    mockMessages.stream.mockClear()
  })

  it('caps tool output at 8000 chars before inserting into API message history', async () => {
    const provider = new ClaudeProvider('test-key')
    const largeOutput = 'x'.repeat(12_000)

    await provider.stream({
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      signal: makeSignal(),
      onEvent: () => {},
      onToolCall: async () => largeOutput
    })

    // Two stream calls: one returning tool_use, one returning end_turn
    expect(mockMessages.getCallCount()).toBe(2)

    // The second call's messages should contain the tool_result with capped content
    const msgs = mockMessages.getCapturedMessages() as Array<{
      role: string
      content: unknown
    }>
    const userTurn = msgs.find((m) => m.role === 'user' && Array.isArray(m.content))
    expect(userTurn).toBeDefined()

    const blocks = userTurn!.content as Array<{ type: string; content?: string }>
    const toolResult = blocks.find((b) => b.type === 'tool_result')
    expect(toolResult).toBeDefined()
    // Must be shorter than the original 12k string
    expect(toolResult!.content!.length).toBeLessThan(12_000)
    // Must be at most 8000 chars + the truncation suffix
    expect(toolResult!.content!.length).toBeLessThanOrEqual(8_000 + 20)
  })

  it('passes tool output unchanged when within the 8000-char limit', async () => {
    const provider = new ClaudeProvider('test-key')
    const smallOutput = 'hello world'

    await provider.stream({
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      signal: makeSignal(),
      onEvent: () => {},
      onToolCall: async () => smallOutput
    })

    const msgs = mockMessages.getCapturedMessages() as Array<{
      role: string
      content: unknown
    }>
    const userTurn = msgs.find((m) => m.role === 'user' && Array.isArray(m.content))
    const blocks = userTurn!.content as Array<{ type: string; content?: string }>
    const toolResult = blocks.find((b) => b.type === 'tool_result')
    expect(toolResult!.content).toBe(smallOutput)
  })
})
