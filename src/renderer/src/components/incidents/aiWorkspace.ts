import type { IncidentAction, IncidentAuditEntry, IncidentEvent } from '../../../../preload/index'

export interface AiWorkspaceSummary {
  toolCallCount: number
  toolNames: string[]
  proposedActions: number
  executedActions: number
  latestRun?: {
    provider: IncidentAuditEntry['provider']
    model: string
    durationMs?: number
    toolCallCount?: number
    error?: string
  }
}

export interface AiRecommendationItem {
  id: string
  kind: 'action' | 'note'
  title: string
  status: IncidentAction['status'] | 'info'
  explanation: string
  sqlPreview?: string
  action?: IncidentAction
}

export interface AiRecommendations {
  items: AiRecommendationItem[]
}

export interface IncidentAiSections {
  rootCause?: string
  recommendedFix?: string
}

interface BuildAiWorkspaceSummaryInput {
  events: IncidentEvent[]
  actions: IncidentAction[]
  audit: IncidentAuditEntry[]
}

interface BuildAiRecommendationsInput {
  events: IncidentEvent[]
  actions: IncidentAction[]
  summary?: string
  rootCauseMd?: string
}

function payloadValue(event: IncidentEvent, key: string): string | undefined {
  const payload = event.payload as Record<string, unknown> | null
  const value = payload?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function parseIncidentAiSections(text?: string): IncidentAiSections {
  const source = text?.trim()
  if (!source) return {}

  const rootCauseMatch = source.match(/(?:^|\n)##\s*Root Cause\s*\n([\s\S]*?)(?=\n##\s+|$)/i)
  const recommendedFixMatch = source.match(
    /(?:^|\n)##\s*Recommended Fix\s*\n([\s\S]*?)(?=\n##\s+|$)/i
  )

  const rootCause = rootCauseMatch?.[1]?.trim()
  const recommendedFix = recommendedFixMatch?.[1]?.trim()

  if (rootCause || recommendedFix) {
    return {
      rootCause:
        rootCause ||
        source
          .slice(0, recommendedFixMatch?.index ?? source.length)
          .trim()
          .replace(/^##\s*Root Cause\s*/i, '')
          .trim() ||
        undefined,
      recommendedFix: recommendedFix || undefined
    }
  }

  return { rootCause: source }
}

export function buildAiWorkspaceSummary({
  events,
  actions,
  audit
}: BuildAiWorkspaceSummaryInput): AiWorkspaceSummary {
  const toolNames = events
    .filter((event) => event.kind === 'tool_call')
    .map((event) => payloadValue(event, 'name'))
    .filter((name): name is string => Boolean(name))

  const proposedEvents = events.filter((event) => event.kind === 'action_proposed').length
  const executedEvents = events.filter((event) => event.kind === 'action_executed').length
  const latestAudit = audit.at(-1)

  return {
    toolCallCount: toolNames.length,
    toolNames: [...new Set(toolNames)],
    proposedActions:
      proposedEvents || actions.filter((action) => action.status === 'pending').length,
    executedActions:
      executedEvents || actions.filter((action) => action.status === 'executed').length,
    latestRun: latestAudit
      ? {
          provider: latestAudit.provider,
          model: latestAudit.model,
          durationMs: latestAudit.durationMs,
          toolCallCount: latestAudit.toolCallCount,
          error: latestAudit.error
        }
      : undefined
  }
}

export function buildAiRecommendations({
  events,
  actions,
  summary,
  rootCauseMd
}: BuildAiRecommendationsInput): AiRecommendations {
  if (actions.length > 0) {
    return {
      items: actions.map((action) => ({
        id: action.id,
        kind: 'action' as const,
        title: action.toolName.replace(/_/g, ' '),
        status: action.status,
        explanation: action.explanation,
        sqlPreview: action.tsqlPreview || undefined,
        action
      }))
    }
  }

  const llmMessages = events.filter((event) => event.kind === 'llm_message')
  const latestLlmMessage = llmMessages.at(-1)
  const payload = latestLlmMessage?.payload as Record<string, unknown> | undefined
  const rootCauseText =
    (typeof payload?.rootCauseMd === 'string' && payload.rootCauseMd.trim()) || rootCauseMd?.trim()
  const recommendedFix =
    (typeof payload?.recommendedFix === 'string' && payload.recommendedFix.trim()) ||
    parseIncidentAiSections(rootCauseText).recommendedFix
  const note =
    recommendedFix ||
    (typeof payload?.summary === 'string' && payload.summary.trim()) ||
    summary?.trim() ||
    rootCauseText

  return {
    items: note
      ? [
          {
            id: 'ai-note',
            kind: 'note',
            title: 'Model recommendation',
            status: 'info',
            explanation: note
          }
        ]
      : []
  }
}
