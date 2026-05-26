/**
 * Integration test for runIncidentAgent — covers the end-to-end flow:
 *   incident status change → tool call events → action proposal →
 *   summary/root-cause parsing → audit entry.
 *
 * All external deps (SQL Server, LLM, SQLite) are replaced with lightweight fakes.
 * Pattern: mirrors actionTools.test.ts (vi.mock at top, import after mocks).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any import that triggers module resolution
// ---------------------------------------------------------------------------

vi.mock('../../store/serverStore', () => ({
  getById: vi.fn(),
  getByIpPort: vi.fn()
}))

vi.mock('../repository', () => ({
  getIncidentById: vi.fn(),
  setIncidentStatus: vi.fn(),
  addEvent: vi.fn(),
  setSummary: vi.fn(),
  setRootCause: vi.fn(),
  addAuditEntry: vi.fn(),
  createAction: vi.fn()
}))

vi.mock('../../ai/providers', () => ({
  getProvider: vi.fn()
}))

vi.mock('../../store/database', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => null), all: vi.fn(() => []) }))
  }))
}))

vi.mock('../../ai/diagnosticTools', () => ({
  buildDiagnosticTools: vi.fn(() => [])
}))

// ---------------------------------------------------------------------------
// Imports AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  isIncidentAgentRunning,
  runIncidentAgent,
  selectActionToolsForIncident,
  selectDiagnosticToolsForIncident
} from '../incidentAgent'
import { toolDefinitionFromDynamicTool } from '../incidentAgent'
import * as serverStore from '../../store/serverStore'
import * as repo from '../repository'
import * as providers from '../../ai/providers'
import * as diagnosticTools from '../../ai/diagnosticTools'
import { buildActionTools } from '../../ai/actionTools'
import type { LlmProvider, LlmRequest } from '../../ai/providers/provider'
import type { Incident } from '../types'
import type { StoredServer } from '../../../preload'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_INCIDENT: Incident = {
  id: 'inc-test-001',
  serverId: 'srv-001',
  category: 'cpu_high',
  severity: 'CRITICAL',
  status: 'open',
  openedAt: Date.now() - 60_000
}

const FAKE_SERVER = {
  id: 'srv-001',
  host: '10.0.0.1',
  port: 1433,
  instanceName: undefined as string | undefined,
  username: 'sa',
  password: 'secret',
  useWindowsAuth: false
} as unknown as StoredServer

const FAKE_ACTION = {
  id: 'action-abc',
  incidentId: 'inc-test-001',
  toolName: 'kill_session',
  status: 'pending'
} as ReturnType<typeof repo.createAction>

function makeFakeProvider(
  options: {
    callKillSession?: boolean
    finalText?: string
    throwStream?: string
  } = {}
): LlmProvider {
  return {
    name: 'ollama' as const,
    model: 'llama3',
    health: async () => true,
    stream: async (req: LlmRequest) => {
      if (options.throwStream) throw new Error(options.throwStream)

      if (options.callKillSession) {
        req.onEvent({ type: 'tool_start', name: 'kill_session' })
        await req.onToolCall('kill_session', {
          session_id: 99,
          reason: 'long-running blocking query'
        })
        req.onEvent({ type: 'tool_end', name: 'kill_session', output: 'proposed' })
      }

      const text =
        options.finalText ??
        'High CPU caused by blocking.\n\n## Root Cause\nA long-running query blocked other sessions for 15 minutes.'
      req.onEvent({ type: 'token', text })
      req.onEvent({ type: 'done' })
    }
  }
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('runIncidentAgent — early-exit guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns without action when incident not found', async () => {
    vi.mocked(repo.getIncidentById).mockReturnValue(null)
    await expect(runIncidentAgent('inc-missing')).resolves.toEqual({
      status: 'skipped',
      reason: 'incident_not_found'
    })
    expect(repo.setIncidentStatus).not.toHaveBeenCalled()
  })

  it('returns without action when server not found', async () => {
    vi.mocked(repo.getIncidentById).mockReturnValue(FAKE_INCIDENT)
    vi.mocked(serverStore.getById).mockReturnValue(null)
    await expect(runIncidentAgent('inc-test-001')).resolves.toEqual({
      status: 'failed',
      error: 'Server srv-001 not found'
    })
    expect(repo.setIncidentStatus).not.toHaveBeenCalled()
  })

  it('logs error event and returns when provider throws', async () => {
    vi.mocked(repo.getIncidentById).mockReturnValue(FAKE_INCIDENT)
    vi.mocked(serverStore.getById).mockReturnValue(FAKE_SERVER)
    vi.mocked(providers.getProvider).mockImplementation(() => {
      throw new Error('No provider configured')
    })
    await runIncidentAgent('inc-test-001')
    expect(repo.addEvent).toHaveBeenCalledWith('inc-test-001', 'llm_message', {
      error: 'No provider configured'
    })
    expect(repo.setSummary).not.toHaveBeenCalled()
  })

  it('resolves incidents whose serverId is stored as host:port', async () => {
    vi.mocked(repo.getIncidentById).mockReturnValue({
      ...FAKE_INCIDENT,
      serverId: 'localhost:1434'
    })
    vi.mocked(serverStore.getById).mockReturnValue(undefined)
    vi.mocked(serverStore.getByIpPort).mockReturnValue({
      ...FAKE_SERVER,
      host: 'localhost',
      port: 1434
    })
    vi.mocked(providers.getProvider).mockReturnValue(makeFakeProvider())

    await expect(runIncidentAgent('inc-test-001')).resolves.toEqual({ status: 'completed' })

    expect(serverStore.getByIpPort).toHaveBeenCalledWith('localhost', 1434)
    expect(repo.setIncidentStatus).toHaveBeenCalledWith('inc-test-001', 'investigating')
  })
})

describe('runIncidentAgent — status lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getIncidentById).mockReturnValue(FAKE_INCIDENT)
    vi.mocked(serverStore.getById).mockReturnValue(FAKE_SERVER)
    vi.mocked(providers.getProvider).mockReturnValue(makeFakeProvider())
    vi.mocked(repo.createAction).mockReturnValue(FAKE_ACTION)
  })

  it('sets incident status to investigating', async () => {
    await runIncidentAgent('inc-test-001')
    expect(repo.setIncidentStatus).toHaveBeenCalledWith('inc-test-001', 'investigating')
  })

  it('logs status_change event with investigating status', async () => {
    await runIncidentAgent('inc-test-001')
    expect(repo.addEvent).toHaveBeenCalledWith('inc-test-001', 'status_change', {
      status: 'investigating'
    })
  })

  it('prefetches single diagnostic-only incidents before calling the model', async () => {
    const diagnosticTool = {
      name: 'get_backup_status',
      description: 'Backup status',
      schema: { shape: {} },
      invoke: vi.fn().mockResolvedValue('[{"database_name":"AppDB"}]')
    }
    vi.mocked(repo.getIncidentById).mockReturnValue({
      ...FAKE_INCIDENT,
      category: 'backup_overdue'
    })
    vi.mocked(diagnosticTools.buildDiagnosticTools).mockReturnValue([diagnosticTool as never])
    vi.mocked(providers.getProvider).mockReturnValue({
      name: 'ollama' as const,
      model: 'gemma4:e4b',
      health: async () => true,
      stream: async (req: LlmRequest) => {
        expect(req.tools).toEqual([])
        expect(req.messages[0].content).toContain('get_backup_status')
        expect(req.messages[0].content).toContain('AppDB')
        req.onEvent({ type: 'token', text: 'Backups are overdue.\n\n## Root Cause\nNo full backup exists.' })
        req.onEvent({ type: 'done' })
      }
    })

    await runIncidentAgent('inc-test-001')

    expect(diagnosticTool.invoke).toHaveBeenCalledWith({})
    expect(repo.addEvent).toHaveBeenCalledWith('inc-test-001', 'tool_call', {
      name: 'get_backup_status'
    })
  })
})

describe('runIncidentAgent — root cause & summary parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getIncidentById).mockReturnValue(FAKE_INCIDENT)
    vi.mocked(serverStore.getById).mockReturnValue(FAKE_SERVER)
    vi.mocked(repo.createAction).mockReturnValue(FAKE_ACTION)
  })

  it('extracts summary from first non-empty line before ## Root Cause', async () => {
    vi.mocked(providers.getProvider).mockReturnValue(makeFakeProvider())
    await runIncidentAgent('inc-test-001')
    expect(repo.setSummary).toHaveBeenCalledWith('inc-test-001', 'High CPU caused by blocking.')
  })

  it('extracts root cause text from ## Root Cause section', async () => {
    vi.mocked(providers.getProvider).mockReturnValue(makeFakeProvider())
    await runIncidentAgent('inc-test-001')
    expect(repo.setRootCause).toHaveBeenCalledWith(
      'inc-test-001',
      'A long-running query blocked other sessions for 15 minutes.'
    )
  })

  it('falls back to category (underscores → spaces) when no text before ## Root Cause', async () => {
    vi.mocked(providers.getProvider).mockReturnValue(
      makeFakeProvider({ finalText: '## Root Cause\nBlocking detected.' })
    )
    await runIncidentAgent('inc-test-001')
    // FAKE_INCIDENT.category = 'cpu_high' → 'cpu high'
    expect(repo.setSummary).toHaveBeenCalledWith('inc-test-001', 'cpu high')
  })

  it('uses full text as root cause when ## Root Cause section is absent', async () => {
    vi.mocked(providers.getProvider).mockReturnValue(
      makeFakeProvider({ finalText: 'No clear root cause identified.' })
    )
    await runIncidentAgent('inc-test-001')
    expect(repo.setRootCause).toHaveBeenCalledWith(
      'inc-test-001',
      'No clear root cause identified.'
    )
  })
})

describe('runIncidentAgent — audit trail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getIncidentById).mockReturnValue(FAKE_INCIDENT)
    vi.mocked(serverStore.getById).mockReturnValue(FAKE_SERVER)
    vi.mocked(providers.getProvider).mockReturnValue(makeFakeProvider())
    vi.mocked(repo.createAction).mockReturnValue(FAKE_ACTION)
  })

  it('creates audit entry with provider name and model after stream completes', async () => {
    await runIncidentAgent('inc-test-001')
    expect(repo.addAuditEntry).toHaveBeenCalledWith(
      'inc-test-001',
      'ollama',
      'llama3',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        durationMs: expect.any(Number),
        toolCallCount: 0
      })
    )
  })

  it('records tool call count in the audit telemetry', async () => {
    vi.mocked(providers.getProvider).mockReturnValue(makeFakeProvider({ callKillSession: true }))
    await runIncidentAgent('inc-test-001')
    expect(repo.addAuditEntry).toHaveBeenCalledWith(
      'inc-test-001',
      'ollama',
      'llama3',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        durationMs: expect.any(Number),
        toolCallCount: 1
      })
    )
  })

  it('adds llm_message event with summary after stream completes', async () => {
    await runIncidentAgent('inc-test-001')
    expect(repo.addEvent).toHaveBeenCalledWith(
      'inc-test-001',
      'llm_message',
      expect.objectContaining({ summary: 'High CPU caused by blocking.' })
    )
  })

  it('logs stream error as llm_message event without calling setSummary', async () => {
    vi.mocked(providers.getProvider).mockReturnValue(
      makeFakeProvider({ throwStream: 'Stream timeout' })
    )
    await runIncidentAgent('inc-test-001')
    expect(repo.addEvent).toHaveBeenCalledWith('inc-test-001', 'llm_message', {
      error: 'Stream timeout'
    })
    expect(repo.addAuditEntry).toHaveBeenCalledWith(
      'inc-test-001',
      'ollama',
      'llama3',
      expect.any(String),
      '',
      expect.objectContaining({
        durationMs: expect.any(Number),
        toolCallCount: 0,
        error: 'Stream timeout'
      })
    )
    expect(repo.setSummary).not.toHaveBeenCalled()
  })

  it('fails a hung provider run after the configured timeout', async () => {
    vi.mocked(providers.getProvider).mockReturnValue({
      name: 'ollama' as const,
      model: 'llama3',
      health: async () => true,
      stream: async () => new Promise<void>(() => {})
    })

    const events: unknown[] = []
    await runIncidentAgent('inc-test-001', {
      timeoutMs: 5,
      onEvent: (event) => events.push(event)
    })

    expect(repo.addEvent).toHaveBeenCalledWith('inc-test-001', 'agent_run', {
      status: 'failed',
      error: 'Agent run timed out after 5 ms'
    })
    expect(repo.addAuditEntry).toHaveBeenCalledWith(
      'inc-test-001',
      'ollama',
      'llama3',
      expect.any(String),
      '',
      expect.objectContaining({
        error: 'Agent run timed out after 5 ms'
      })
    )
    expect(events).toContainEqual({
      type: 'error',
      message: 'Agent run timed out after 5 ms'
    })
    expect(repo.setSummary).not.toHaveBeenCalled()
  })

  it('allows slow local model runs past two minutes before the default timeout', async () => {
    vi.useFakeTimers()
    vi.mocked(providers.getProvider).mockReturnValue({
      name: 'ollama' as const,
      model: 'gemma4:e4b',
      health: async () => true,
      stream: async () => new Promise<void>(() => {})
    })

    const run = runIncidentAgent('inc-test-001')

    await vi.advanceTimersByTimeAsync(120_001)
    expect(repo.addEvent).not.toHaveBeenCalledWith(
      'inc-test-001',
      'agent_run',
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('timed out')
      })
    )

    await vi.advanceTimersByTimeAsync(180_000)
    await expect(run).resolves.toEqual({
      status: 'failed',
      error: 'Agent run timed out after 300000 ms'
    })
    vi.useRealTimers()
  })

  it('skips a concurrent run for the same incident while one is already active', async () => {
    let release!: () => void
    const stream = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    vi.mocked(providers.getProvider).mockReturnValue({
      name: 'ollama' as const,
      model: 'llama3',
      health: async () => true,
      stream
    })

    const first = runIncidentAgent('inc-test-001')
    expect(isIncidentAgentRunning('inc-test-001')).toBe(true)
    const second = await runIncidentAgent('inc-test-001')

    expect(second).toEqual({ status: 'skipped', reason: 'already_running' })
    expect(repo.addEvent).toHaveBeenCalledWith('inc-test-001', 'agent_run', {
      status: 'skipped',
      reason: 'already_running'
    })
    expect(stream).toHaveBeenCalledTimes(1)

    release()
    await first
    expect(isIncidentAgentRunning('inc-test-001')).toBe(false)
  })
})

describe('runIncidentAgent — action proposal flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getIncidentById).mockReturnValue({
      ...FAKE_INCIDENT,
      category: 'blocking_sessions'
    })
    vi.mocked(serverStore.getById).mockReturnValue(FAKE_SERVER)
    vi.mocked(repo.createAction).mockReturnValue(FAKE_ACTION)
  })

  it('logs tool_call event when provider fires tool_start', async () => {
    vi.mocked(providers.getProvider).mockReturnValue({
      name: 'ollama' as const,
      model: 'llama3',
      health: async () => true,
      stream: async (req: LlmRequest) => {
        req.onEvent({ type: 'tool_start', name: 'get_blocking_sessions' })
        req.onEvent({ type: 'token', text: 'Analysis done.\n\n## Root Cause\nNo blocking.' })
        req.onEvent({ type: 'done' })
      }
    })
    await runIncidentAgent('inc-test-001')
    expect(repo.addEvent).toHaveBeenCalledWith('inc-test-001', 'tool_call', {
      name: 'get_blocking_sessions'
    })
  })

  it('stores a pending action via createAction when kill_session tool is invoked', async () => {
    vi.mocked(providers.getProvider).mockReturnValue(makeFakeProvider({ callKillSession: true }))
    await runIncidentAgent('inc-test-001')
    expect(repo.createAction).toHaveBeenCalledWith(
      'inc-test-001',
      'kill_session',
      { session_id: 99 },
      'KILL 99;',
      'long-running blocking query'
    )
  })

  it('logs action_proposed event including toolName and actionId', async () => {
    vi.mocked(providers.getProvider).mockReturnValue(makeFakeProvider({ callKillSession: true }))
    await runIncidentAgent('inc-test-001')
    expect(repo.addEvent).toHaveBeenCalledWith(
      'inc-test-001',
      'action_proposed',
      expect.objectContaining({
        toolName: 'kill_session',
        actionId: 'action-abc',
        session_id: 99
      })
    )
  })

  it('wraps unknown tool result in TOOL_OUTPUT markers', async () => {
    let capturedOutput = ''
    vi.mocked(providers.getProvider).mockReturnValue({
      name: 'ollama' as const,
      model: 'llama3',
      health: async () => true,
      stream: async (req: LlmRequest) => {
        // Call a tool that is NOT in the tool map (no diagnostic, no action tool named this)
        capturedOutput = await req.onToolCall('nonexistent_tool', {})
        req.onEvent({ type: 'token', text: '## Root Cause\nTest.' })
        req.onEvent({ type: 'done' })
      }
    })
    await runIncidentAgent('inc-test-001')
    expect(capturedOutput).toContain('<<TOOL_OUTPUT>>')
    expect(capturedOutput).toContain('Unknown tool: nonexistent_tool')
    expect(capturedOutput).toContain('<<END_TOOL_OUTPUT>>')
  })
})

describe('toolDefinitionFromDynamicTool', () => {
  it('keeps numeric action params as JSON schema numbers', () => {
    const killSession = buildActionTools('inc-test-001').find((t) => t.name === 'kill_session')
    expect(killSession).toBeDefined()

    const def = toolDefinitionFromDynamicTool(killSession!)

    expect(def.inputSchema.properties.session_id.type).toBe('number')
    expect(def.inputSchema.properties.reason.type).toBe('string')
    expect(def.inputSchema.required).toEqual(['session_id', 'reason'])
  })
})

describe('selectDiagnosticToolsForIncident', () => {
  it('restricts backup overdue incidents to the backup status tool', () => {
    const tools = [
      { name: 'get_backup_status' },
      { name: 'get_disk_usage' },
      { name: 'get_wait_stats' },
      { name: 'get_top_queries' }
    ] as never

    const selected = selectDiagnosticToolsForIncident('backup_overdue', tools)

    expect(selected.map((tool) => tool.name)).toEqual(['get_backup_status'])
  })
})

describe('selectActionToolsForIncident', () => {
  it('does not expose action tools for backup overdue incidents', () => {
    const tools = [
      { name: 'kill_session' },
      { name: 'update_statistics' },
      { name: 'rebuild_index' }
    ] as never

    const selected = selectActionToolsForIncident('backup_overdue', tools)

    expect(selected).toEqual([])
  })
})
