import { describe, expect, it } from 'vitest'

import { AgentQueueGate } from '../agentQueueGate'

describe('AgentQueueGate', () => {
  it('reserves pending slots until the concurrent cap is reached', () => {
    const gate = new AgentQueueGate(5)

    expect(gate.tryReserve(4)).toBe(true)
    expect(gate.pending).toBe(1)
    expect(gate.tryReserve(4)).toBe(false)
    expect(gate.pending).toBe(1)
  })

  it('release never drops the pending count below zero', () => {
    const gate = new AgentQueueGate(5)

    gate.release()

    expect(gate.pending).toBe(0)
  })
})
