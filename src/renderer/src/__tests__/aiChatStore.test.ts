import { describe, it, expect, beforeEach } from 'vitest'
import { useAiChatStore } from '../store/aiChatStore'

function getStore() {
  return useAiChatStore.getState()
}

beforeEach(() => {
  useAiChatStore.getState().clear()
})

describe('aiChatStore streaming state', () => {
  it('startStreaming clears streamingText and toolSteps', () => {
    const s = getStore()
    s.appendToken('leftover')
    s.addToolStep('old_tool')
    s.startStreaming()
    expect(getStore().streamingText).toBe('')
    expect(getStore().toolSteps).toHaveLength(0)
  })

  it('appendToken accumulates text', () => {
    const s = getStore()
    s.appendToken('Hello')
    s.appendToken(' world')
    expect(getStore().streamingText).toBe('Hello world')
  })

  it('addToolStep adds a running step', () => {
    const s = getStore()
    s.addToolStep('get_server_metrics')
    const steps = getStore().toolSteps
    expect(steps).toHaveLength(1)
    expect(steps[0]).toEqual({ name: 'get_server_metrics', status: 'running', output: undefined })
  })

  it('completeToolStep marks step done and adds output', () => {
    const s = getStore()
    s.addToolStep('get_server_metrics')
    s.completeToolStep('get_server_metrics', '{"cpu":90}')
    const step = getStore().toolSteps[0]
    expect(step.status).toBe('done')
    expect(step.output).toBe('{"cpu":90}')
  })

  it('finalizeStreaming moves streamingText to messages and clears streaming state', () => {
    const s = getStore()
    s.startStreaming()
    s.appendToken('Final answer')
    s.addToolStep('get_server_metrics')
    s.finalizeStreaming()
    const state = getStore()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({ role: 'assistant', content: 'Final answer' })
    expect(state.streamingText).toBe('')
    expect(state.toolSteps).toHaveLength(0)
  })

  it('finalizeStreaming does nothing if streamingText is empty', () => {
    getStore().finalizeStreaming()
    expect(getStore().messages).toHaveLength(0)
  })

  it('resetStreaming adds an error bubble and clears streaming state', () => {
    const s = getStore()
    s.appendToken('partial')
    s.resetStreaming('Ollama down')
    const state = getStore()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].content).toContain('Ollama down')
    expect(state.streamingText).toBe('')
    expect(state.toolSteps).toHaveLength(0)
  })
})
