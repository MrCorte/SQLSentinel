import { describe, expect, it } from 'vitest'
import {
  buildAiRecommendations,
  buildAiWorkspaceSummary,
  parseIncidentAiSections
} from '../aiWorkspace'
import type {
  IncidentAction,
  IncidentAuditEntry,
  IncidentEvent
} from '../../../../../preload/index'

function event(kind: IncidentEvent['kind'], payload: unknown, at = Date.now()): IncidentEvent {
  return {
    id: `${kind}-${at}`,
    incidentId: 'inc-1',
    kind,
    payload,
    at
  }
}

describe('buildAiWorkspaceSummary', () => {
  it('summarizes tool calls, action decisions and latest audit run', () => {
    const audit: IncidentAuditEntry[] = [
      {
        id: 'audit-1',
        incidentId: 'inc-1',
        provider: 'ollama',
        model: 'llama3',
        promptHash: 'prompt',
        responseHash: 'response',
        durationMs: 840,
        toolCallCount: 2,
        at: 100
      }
    ]
    const actions = [
      { id: 'a1', incidentId: 'inc-1', toolName: 'kill_session', status: 'pending' },
      { id: 'a2', incidentId: 'inc-1', toolName: 'update_statistics', status: 'executed' }
    ] as IncidentAction[]

    const summary = buildAiWorkspaceSummary({
      events: [
        event('tool_call', { name: 'get_blocking_sessions' }, 10),
        event('tool_call', { name: 'get_expensive_queries' }, 20),
        event('action_proposed', { toolName: 'kill_session' }, 30),
        event('action_executed', { toolName: 'update_statistics' }, 40)
      ],
      actions,
      audit
    })

    expect(summary.toolCallCount).toBe(2)
    expect(summary.toolNames).toEqual(['get_blocking_sessions', 'get_expensive_queries'])
    expect(summary.proposedActions).toBe(1)
    expect(summary.executedActions).toBe(1)
    expect(summary.latestRun).toEqual({
      provider: 'ollama',
      model: 'llama3',
      durationMs: 840,
      toolCallCount: 2,
      error: undefined
    })
  })

  it('falls back to persisted action statuses when action events are missing', () => {
    const summary = buildAiWorkspaceSummary({
      events: [],
      actions: [
        { id: 'a1', incidentId: 'inc-1', toolName: 'kill_session', status: 'pending' },
        { id: 'a2', incidentId: 'inc-1', toolName: 'update_statistics', status: 'executed' }
      ] as IncidentAction[],
      audit: []
    })

    expect(summary.proposedActions).toBe(1)
    expect(summary.executedActions).toBe(1)
  })
})

describe('buildAiRecommendations', () => {
  it('returns all model action proposals with status and SQL preview', () => {
    const actions = [
      {
        id: 'a1',
        incidentId: 'inc-1',
        toolName: 'kill_session',
        status: 'pending',
        explanation: 'Kill the blocking session after validation.',
        tsqlPreview: 'KILL 51;',
        params: { session_id: 51 }
      },
      {
        id: 'a2',
        incidentId: 'inc-1',
        toolName: 'update_statistics',
        status: 'executed',
        explanation: 'Refresh stale stats.',
        tsqlPreview: 'UPDATE STATISTICS dbo.T;',
        params: { table: 'dbo.T' }
      }
    ] as IncidentAction[]

    const recommendations = buildAiRecommendations({
      events: [],
      actions,
      summary: undefined,
      rootCauseMd: undefined
    })

    expect(recommendations.items).toEqual([
      {
        id: 'a1',
        kind: 'action',
        title: 'kill session',
        status: 'pending',
        explanation: 'Kill the blocking session after validation.',
        sqlPreview: 'KILL 51;',
        action: actions[0]
      },
      {
        id: 'a2',
        kind: 'action',
        title: 'update statistics',
        status: 'executed',
        explanation: 'Refresh stale stats.',
        sqlPreview: 'UPDATE STATISTICS dbo.T;',
        action: actions[1]
      }
    ])
  })

  it('falls back to the latest AI message when no executable action was proposed', () => {
    const recommendations = buildAiRecommendations({
      events: [
        event('llm_message', {
          summary: 'Full backups are missing.',
          rootCauseMd: 'Run a full backup for AppDB and check the backup job schedule.'
        })
      ],
      actions: [],
      summary: undefined,
      rootCauseMd: undefined
    })

    expect(recommendations.items).toEqual([
      {
        id: 'ai-note',
        kind: 'note',
        title: 'Model recommendation',
        status: 'info',
        explanation: 'Full backups are missing.'
      }
    ])
  })

  it('prefers the model-provided recommended fix section over a diagnostic summary', () => {
    const recommendations = buildAiRecommendations({
      events: [
        event('llm_message', {
          summary: 'Full backups are missing.',
          rootCauseMd:
            '## Root Cause\nThe monitored databases have no recorded full backup history.\n\n## Recommended Fix\nRun the backup remediation selected by the model and verify that SQL Server records the next full backup completion.'
        })
      ],
      actions: [],
      summary: undefined,
      rootCauseMd: undefined
    })

    expect(recommendations.items[0]?.explanation).toBe(
      'Run the backup remediation selected by the model and verify that SQL Server records the next full backup completion.'
    )
  })

  it('uses a dedicated recommended fix payload when the root cause is stored separately', () => {
    const recommendations = buildAiRecommendations({
      events: [
        event('llm_message', {
          summary: 'Full backups are missing.',
          rootCauseMd: 'The monitored databases have no recorded full backup history.',
          recommendedFix: 'Review the SQL Agent backup job and run a manual full backup.'
        })
      ],
      actions: [],
      summary: undefined,
      rootCauseMd: undefined
    })

    expect(recommendations.items[0]?.explanation).toBe(
      'Review the SQL Agent backup job and run a manual full backup.'
    )
  })
})

describe('parseIncidentAiSections', () => {
  it('separates root cause text from the recommended fix section', () => {
    const sections = parseIncidentAiSections(
      'The backup job has not recorded a successful full backup.\n\n## Recommended Fix\nVerify SQL Agent job history, run a manual full backup, then monitor the next scheduled run.'
    )

    expect(sections).toEqual({
      rootCause: 'The backup job has not recorded a successful full backup.',
      recommendedFix:
        'Verify SQL Agent job history, run a manual full backup, then monitor the next scheduled run.'
    })
  })
})
