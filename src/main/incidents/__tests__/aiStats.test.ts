import { describe, expect, it } from 'vitest'
import { buildIncidentAiStats } from '../aiStats'
import type { IncidentAction, IncidentAuditEntry } from '../types'

function audit(partial: Partial<IncidentAuditEntry>): IncidentAuditEntry {
  return {
    id: partial.id ?? `audit-${partial.at ?? 0}`,
    incidentId: partial.incidentId ?? 'inc-1',
    provider: partial.provider ?? 'ollama',
    model: partial.model ?? 'llama3',
    promptHash: 'prompt',
    responseHash: 'response',
    at: partial.at ?? Date.now(),
    ...partial
  }
}

function action(partial: Partial<IncidentAction>): IncidentAction {
  return {
    id: partial.id ?? 'action-1',
    incidentId: partial.incidentId ?? 'inc-1',
    toolName: partial.toolName ?? 'kill_session',
    params: {},
    tsqlPreview: 'KILL 99;',
    explanation: 'blocking',
    status: partial.status ?? 'pending',
    ...partial
  }
}

describe('buildIncidentAiStats', () => {
  it('aggregates run reliability, latency and tool usage', () => {
    const stats = buildIncidentAiStats({
      audit: [
        audit({ provider: 'ollama', durationMs: 100, toolCallCount: 1, at: 10 }),
        audit({ provider: 'claude', durationMs: 400, toolCallCount: 3, at: 20 }),
        audit({ provider: 'claude', durationMs: 900, toolCallCount: 0, error: 'timeout', at: 30 })
      ],
      actions: [action({ status: 'pending' }), action({ status: 'executed' })]
    })

    expect(stats.totalRuns).toBe(3)
    expect(stats.successfulRuns).toBe(2)
    expect(stats.failedRuns).toBe(1)
    expect(stats.successRate).toBeCloseTo(2 / 3)
    expect(stats.avgDurationMs).toBeCloseTo(467)
    expect(stats.p95DurationMs).toBe(900)
    expect(stats.avgToolCalls).toBeCloseTo(1.33)
    expect(stats.proposedActions).toBe(1)
    expect(stats.executedActions).toBe(1)
    expect(stats.lastRunAt).toBe(30)
    expect(stats.providers).toEqual([
      { provider: 'claude', runs: 2, failedRuns: 1 },
      { provider: 'ollama', runs: 1, failedRuns: 0 }
    ])
  })

  it('returns zeroed metrics when no audit exists', () => {
    expect(buildIncidentAiStats({ audit: [], actions: [] })).toEqual({
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      successRate: 0,
      avgDurationMs: 0,
      p95DurationMs: 0,
      avgToolCalls: 0,
      proposedActions: 0,
      executedActions: 0,
      lastRunAt: undefined,
      providers: []
    })
  })
})
