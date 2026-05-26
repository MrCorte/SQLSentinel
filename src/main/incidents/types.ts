import type { AlertCategory, AlertSeverity } from '../ipc/types'

export type { AlertCategory, AlertSeverity }

export type IncidentStatus =
  | 'open'
  | 'investigating'
  | 'awaiting_approval'
  | 'resolved'
  | 'archived'

export type IncidentEventKind =
  | 'alert_added'
  | 'agent_run'
  | 'tool_call'
  | 'llm_message'
  | 'action_proposed'
  | 'action_executed'
  | 'status_change'

export type ActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'

export interface Incident {
  id: string
  serverId: string
  category: AlertCategory
  severity: AlertSeverity
  status: IncidentStatus
  openedAt: number
  resolvedAt?: number
  summary?: string
  rootCauseMd?: string
}

export interface IncidentEvent {
  id: string
  incidentId: string
  kind: IncidentEventKind
  payload: unknown
  at: number
}

export interface IncidentAction {
  id: string
  incidentId: string
  toolName: string
  params: Record<string, unknown>
  tsqlPreview: string
  explanation: string
  status: ActionStatus
  approvedBy?: string
  executedAt?: number
  result?: unknown
  rejectionReason?: string
}

export interface IncidentAuditEntry {
  id: string
  incidentId: string
  provider: 'ollama' | 'claude'
  model: string
  promptHash: string
  responseHash: string
  tokensIn?: number
  tokensOut?: number
  durationMs?: number
  toolCallCount?: number
  error?: string
  at: number
}

export interface IncidentAuditTelemetry {
  tokensIn?: number
  tokensOut?: number
  durationMs?: number
  toolCallCount?: number
  error?: string
}

export interface IncidentAiProviderStats {
  provider: 'ollama' | 'claude'
  runs: number
  failedRuns: number
}

export interface IncidentAiStats {
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  successRate: number
  avgDurationMs: number
  p95DurationMs: number
  avgToolCalls: number
  proposedActions: number
  executedActions: number
  lastRunAt?: number
  providers: IncidentAiProviderStats[]
}
