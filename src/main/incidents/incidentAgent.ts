import * as serverStore from '../store/serverStore'
import * as repo from './repository'
import { getProvider } from '../ai/providers'
import { buildDiagnosticTools } from '../ai/diagnosticTools'
import type { ToolDefinition } from '../ai/providers'
import type { AiStreamEvent } from '../ipc/types'
import type { Incident } from './types'
import { createLogger } from '../utils/logger'

const log = createLogger('incident-agent')

const EMPTY_SCHEMA = {
  type: 'object' as const,
  properties: {}
}

// Token budget guard — prevents runaway loops that exhaust the context.
const MAX_OUTPUT_TOKENS = 1024

function buildSystemPrompt(incident: Incident, serverLabel: string): string {
  return `You are an expert SQL Server DBA assistant performing automated root-cause analysis.

INCIDENT
- ID: ${incident.id}
- Server: ${serverLabel}
- Category: ${incident.category}
- Severity: ${incident.severity}
- Opened: ${new Date(incident.openedAt).toISOString()}

TASK
1. Use the diagnostic tools to collect live data from the affected server.
2. Identify the most likely root cause based on the data.
3. Write a concise summary (1 sentence) and a markdown root-cause analysis (2-4 paragraphs).

RULES
- Always respond in English.
- Use only the provided tools. Do not invent data.
- Queries are executed live against the monitored server — do not run destructive commands.
- End with a section "## Root Cause" followed by your analysis.
- Do not repeat the incident metadata in the body.`
}

export interface AgentRunOptions {
  /** Push live AiStreamEvents to the renderer */
  onEvent?: (ev: AiStreamEvent) => void
}

export async function runIncidentAgent(
  incidentId: string,
  opts: AgentRunOptions = {}
): Promise<void> {
  const incident = repo.getIncidentById(incidentId)
  if (!incident) {
    log.warn(`runIncidentAgent: incident ${incidentId} not found`)
    return
  }

  // Resolve server connection — needs decrypted credentials.
  const server = serverStore.getById(incident.serverId)
  if (!server) {
    log.warn(`runIncidentAgent: server ${incident.serverId} not found for incident ${incidentId}`)
    return
  }

  const serverLabel = `${server.host}:${server.port}${server.instanceName ? `\\${server.instanceName}` : ''}`

  // Mark the incident as "investigating" as soon as the agent starts.
  repo.setIncidentStatus(incidentId, 'investigating')
  repo.addEvent(incidentId, 'status_change', { status: 'investigating' })

  const conn = {
    ip: server.host,
    port: server.port,
    instanceName: server.instanceName,
    username: server.username,
    password: server.password,
    useWindowsAuth: server.useWindowsAuth,
    encrypt: true,
    trustServerCertificate: true
  }

  const diagnosticTools = buildDiagnosticTools(conn)

  // Build ToolDefinition array for the provider (all tools here have empty schemas).
  const toolDefs: ToolDefinition[] = diagnosticTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: EMPTY_SCHEMA
  }))

  // Dispatch table: tool name → DynamicStructuredTool.invoke()
  const toolMap = new Map(diagnosticTools.map((t) => [t.name, t]))

  const ac = new AbortController()

  let provider
  try {
    provider = getProvider()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('runIncidentAgent: provider unavailable:', msg)
    repo.addEvent(incidentId, 'llm_message', { error: msg })
    return
  }

  let finalText = ''
  const promptIdentifier = `${incident.id}:${incident.category}:${provider.name}:${provider.model}`

  try {
    await provider.stream({
      systemPrompt: buildSystemPrompt(incident, serverLabel),
      messages: [{ role: 'user', content: `Analyse incident ${incident.id}: ${incident.category} on ${serverLabel}` }],
      tools: toolDefs,
      signal: ac.signal,
      onEvent: (ev) => {
        opts.onEvent?.(ev)

        if (ev.type === 'token') {
          finalText += ev.text
          // Hard-cut if output grows beyond budget to avoid OOM.
          if (finalText.length > MAX_OUTPUT_TOKENS * 6) ac.abort()
        } else if (ev.type === 'tool_start') {
          repo.addEvent(incidentId, 'tool_call', { name: ev.name })
        } else if (ev.type === 'done') {
          // Persist final text after the loop.
        }
      },
      onToolCall: async (name, _params) => {
        const tool = toolMap.get(name)
        if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` })
        try {
          const result = await tool.invoke({})
          return typeof result === 'string' ? result : JSON.stringify(result)
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        }
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('runIncidentAgent stream error:', msg)
    repo.addEvent(incidentId, 'llm_message', { error: msg })
    return
  }

  // Parse summary + root-cause from the agent's final answer.
  const rootCauseMatch = finalText.match(/##\s*Root Cause\s*\n([\s\S]+)/)
  const rootCauseMd = rootCauseMatch ? rootCauseMatch[1].trim() : finalText.trim()

  // Build a one-sentence summary from the first non-empty line before "## Root Cause".
  const before = rootCauseMatch ? finalText.slice(0, rootCauseMatch.index ?? 0) : finalText
  const summary =
    before
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#')) ?? incident.category.replace(/_/g, ' ')

  repo.setSummary(incidentId, summary)
  repo.setRootCause(incidentId, rootCauseMd)
  repo.addEvent(incidentId, 'llm_message', { summary, rootCauseMd: rootCauseMd.slice(0, 500) })

  // Audit log — repository hashes prompt/response internally; we pass identifiers only.
  repo.addAuditEntry(incidentId, provider.name, provider.model, promptIdentifier, finalText)

  log.info(`runIncidentAgent: completed for incident ${incidentId}`)
}
