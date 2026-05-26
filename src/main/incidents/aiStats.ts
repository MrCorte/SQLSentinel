import type { IncidentAction, IncidentAiStats, IncidentAuditEntry } from './types'

interface BuildIncidentAiStatsInput {
  audit: IncidentAuditEntry[]
  actions: IncidentAction[]
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)
  return sorted[index]
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100
}

export function buildIncidentAiStats({
  audit,
  actions
}: BuildIncidentAiStatsInput): IncidentAiStats {
  const totalRuns = audit.length
  const failedRuns = audit.filter((entry) => Boolean(entry.error)).length
  const successfulRuns = totalRuns - failedRuns
  const durations = audit
    .map((entry) => entry.durationMs)
    .filter((duration): duration is number => typeof duration === 'number')
  const toolCounts = audit
    .map((entry) => entry.toolCallCount)
    .filter((count): count is number => typeof count === 'number')

  const providers = new Map<IncidentAuditEntry['provider'], { runs: number; failedRuns: number }>()
  for (const entry of audit) {
    const current = providers.get(entry.provider) ?? { runs: 0, failedRuns: 0 }
    current.runs += 1
    if (entry.error) current.failedRuns += 1
    providers.set(entry.provider, current)
  }

  return {
    totalRuns,
    successfulRuns,
    failedRuns,
    successRate: totalRuns > 0 ? successfulRuns / totalRuns : 0,
    avgDurationMs: Math.round(average(durations)),
    p95DurationMs: percentile(durations, 0.95),
    avgToolCalls: roundMetric(average(toolCounts)),
    proposedActions: actions.filter((action) => action.status === 'pending').length,
    executedActions: actions.filter((action) => action.status === 'executed').length,
    lastRunAt: audit.length > 0 ? Math.max(...audit.map((entry) => entry.at)) : undefined,
    providers: [...providers.entries()]
      .map(([provider, stats]) => ({ provider, ...stats }))
      .sort((a, b) => b.runs - a.runs || a.provider.localeCompare(b.provider))
  }
}
