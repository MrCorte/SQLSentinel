# AI Streaming & Tool Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silent 60-second `agent.invoke()` call with real-time IPC push streaming that shows tool calls (collapsible) and streams LLM tokens token-by-token in the AIPanel.

**Architecture:** `langGraphStream()` in the main process uses LangGraph's `agent.stream()` and pushes `AiStreamEvent` payloads to the renderer via `webContents.send()`. The renderer listens via a preload bridge listener, stores incremental state in Zustand, and renders a `ToolTimeline` + `StreamingBubble` in `AIPanel`.

**Tech Stack:** LangGraph `@langchain/langgraph` (already installed), Electron IPC push (`webContents.send` / `ipcRenderer.on`), Zustand, MUI Accordion, Vitest.

---

## File map

| File                                             | Change                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `src/main/ipc/types.ts`                          | Add 3 IPC channels + `AiStreamEvent` type                                     |
| `src/preload/index.d.ts`                         | Add `AiStreamEvent`, 3 new methods to `SqlSentinelAPI`                        |
| `src/main/ai/langGraphAgent.ts`                  | Add `langGraphStream()`, `abortActiveStream()`, module-level AbortController  |
| `src/main/ipc/handlers/knowledge.ipc.ts`         | Add `AI_AGENT_STREAM` + `AI_AGENT_CANCEL` handlers                            |
| `src/main/index.ts`                              | Add `app.on('before-quit')` abort guard                                       |
| `src/preload/index.ts`                           | Extend `realApi`, `mockApi`, `bridgeApi` with 3 new methods                   |
| `src/renderer/src/store/aiChatStore.ts`          | Add streaming state + 6 new actions                                           |
| `src/renderer/src/components/ai/AIPanel.tsx`     | Add `ToolTimeline`, `StreamingBubble`, Cancel button, new `sendMessage` logic |
| `src/main/ai/__tests__/langGraphStream.test.ts`  | Unit tests for `langGraphStream` event mapping                                |
| `src/renderer/src/__tests__/aiChatStore.test.ts` | Unit tests for store state transitions                                        |

---

## Task 1 — Add `AiStreamEvent` type and new IPC channels

**Files:**

- Modify: `src/main/ipc/types.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1.1: Add channels and type to `types.ts`**

In `src/main/ipc/types.ts`, add after the `AI_AGENT_ASK` entry in the enum and after `IpcResult`:

```typescript
// In IpcChannel enum, after AI_AGENT_ASK:
AI_AGENT_STREAM = 'ai:agentStream',   // invoke: starts stream, returns IpcResult<void> immediately
AI_AGENT_CANCEL = 'ai:agentCancel',   // invoke: aborts active stream
AI_STREAM_EVENT = 'ai:streamEvent',   // push-only: main → renderer
```

Then add after the `IpcResult` type definition:

```typescript
export type AiStreamEvent =
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; output: string }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

- [ ] **Step 1.2: Add `AiStreamEvent` and 3 methods to `index.d.ts`**

In `src/preload/index.d.ts`, add before the closing `}` of `SqlSentinelAPI`:

```typescript
export type AiStreamEvent =
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; output: string }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

Then in the `SqlSentinelAPI` interface, after `aiAgentAsk`:

```typescript
aiAgentStream(question: string, history: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<IpcResult<void>>
aiAgentCancel(): Promise<void>
onAiStreamEvent(callback: (event: AiStreamEvent) => void): () => void
```

- [ ] **Step 1.3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 1.4: Commit**

```bash
git add src/main/ipc/types.ts src/preload/index.d.ts
git commit -m "feat(ai): add AiStreamEvent type and streaming IPC channels"
```

---

## Task 2 — Implement `langGraphStream` and `abortActiveStream`

**Files:**

- Modify: `src/main/ai/langGraphAgent.ts`
- Create: `src/main/ai/__tests__/langGraphStream.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/main/ai/__tests__/langGraphStream.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock LangGraph agent factory — must come before importing langGraphAgent
const mockStream = vi.fn()
const mockAgent = { stream: mockStream }
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn(() => mockAgent)
}))
vi.mock('@langchain/ollama', () => ({
  ChatOllama: vi.fn(),
  OllamaEmbeddings: vi.fn()
}))
vi.mock('../../store/serverStore', () => ({ getAll: vi.fn(() => []) }))
vi.mock('../../store/metricsRepository', () => ({ findLastNBulk: vi.fn(() => ({})) }))
vi.mock('../../metricsWorker', () => ({ getAlerts: vi.fn(() => []) }))
vi.mock('../../store/ragRepository', () => ({ retrieveTopK: vi.fn(() => []) }))

import { langGraphStream, abortActiveStream } from '../langGraphAgent'
import type { AiStreamEvent } from '../../ipc/types'

function makeStream(chunks: [string, unknown][]): AsyncIterable<[string, unknown]> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i >= chunks.length) return { done: true, value: undefined }
          return { done: false, value: chunks[i++] }
        }
      }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('langGraphStream', () => {
  it('emits token events for AI message content', async () => {
    mockStream.mockReturnValue(
      makeStream([
        ['messages', [{ _getType: () => 'ai', content: 'Hello' }]],
        ['messages', [{ _getType: () => 'ai', content: ' world' }]]
      ])
    )

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events).toContainEqual({ type: 'token', text: 'Hello' })
    expect(events).toContainEqual({ type: 'token', text: ' world' })
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })

  it('emits tool_start on agent tool_calls', async () => {
    mockStream.mockReturnValue(
      makeStream([
        [
          'updates',
          { agent: { messages: [{ tool_calls: [{ id: 'tc1', name: 'get_server_metrics' }] }] } }
        ],
        [
          'updates',
          { tools: { messages: [{ _getType: () => 'tool', tool_call_id: 'tc1', content: '{}' }] } }
        ]
      ])
    )

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events).toContainEqual({ type: 'tool_start', name: 'get_server_metrics' })
    expect(events).toContainEqual({ type: 'tool_end', name: 'get_server_metrics', output: '{}' })
  })

  it('emits error event when stream throws', async () => {
    mockStream.mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new Error('Ollama down')
          }
        }
      }
    })

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events[0]).toEqual({ type: 'error', message: 'Ollama down' })
  })

  it('emits error with "Cancelled" when aborted', async () => {
    mockStream.mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            abortActiveStream()
            return { done: false, value: ['messages', [{ _getType: () => 'ai', content: '' }]] }
          }
        }
      }
    })

    const events: AiStreamEvent[] = []
    await langGraphStream('test', [], (e) => events.push(e))

    expect(events[0]).toEqual({ type: 'error', message: 'Cancelled' })
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npm test -- src/main/ai/__tests__/langGraphStream.test.ts
```

Expected: FAIL — `langGraphStream` not exported, `abortActiveStream` not exported.

- [ ] **Step 2.3: Implement `langGraphStream` and `abortActiveStream` in `langGraphAgent.ts`**

Add these imports at the top of `src/main/ai/langGraphAgent.ts` (extend existing import):

```typescript
import { HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
```

Add module-level abort controller and export `abortActiveStream` after the existing `resetAgent()` export:

```typescript
let _activeAbortController: AbortController | null = null

export function abortActiveStream(): void {
  _activeAbortController?.abort()
}
```

Add `langGraphStream` after `langGraphAsk`:

```typescript
export async function langGraphStream(
  question: string,
  history: AgentHistory[],
  onEvent: (event: import('./types').AiStreamEvent) => void
): Promise<void> {
  const controller = new AbortController()
  _activeAbortController = controller

  const agent = getAgent()
  const messages = [
    ...history
      .slice(-6)
      .map((h) => (h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content))),
    new HumanMessage(question)
  ]

  // Maps tool_call_id → tool name so tool_end can reference the name from tool_start
  const pendingTools = new Map<string, string>()

  try {
    const stream = await agent.stream(
      { messages },
      { streamMode: ['messages', 'updates'], signal: controller.signal, recursionLimit: 10 }
    )

    for await (const chunk of stream as AsyncIterable<[string, unknown]>) {
      if (controller.signal.aborted) break

      const [mode, data] = chunk

      if (mode === 'updates') {
        const update = data as Record<string, { messages?: BaseMessage[] }>

        // Agent node: AIMessage with tool_calls → emit tool_start for each
        if (update.agent?.messages) {
          for (const msg of update.agent.messages) {
            const toolCalls = (msg as AIMessage).tool_calls
            if (toolCalls?.length) {
              for (const tc of toolCalls) {
                pendingTools.set(tc.id ?? tc.name, tc.name)
                onEvent({ type: 'tool_start', name: tc.name })
              }
            }
          }
        }

        // Tools node: ToolMessages → emit tool_end with matched name
        if (update.tools?.messages) {
          for (const msg of update.tools.messages) {
            if (msg._getType() === 'tool') {
              const tm = msg as ToolMessage
              const name = pendingTools.get(tm.tool_call_id) ?? 'tool'
              pendingTools.delete(tm.tool_call_id)
              onEvent({ type: 'tool_end', name, output: String(tm.content).slice(0, 2000) })
            }
          }
        }
      }

      if (mode === 'messages') {
        const [msg] = data as [{ _getType: () => string; content: unknown }]
        if (msg._getType() === 'ai') {
          const text = typeof msg.content === 'string' ? msg.content : ''
          if (text.length > 0) onEvent({ type: 'token', text })
        }
      }
    }

    onEvent(controller.signal.aborted ? { type: 'error', message: 'Cancelled' } : { type: 'done' })
  } catch (err) {
    onEvent({
      type: 'error',
      message: controller.signal.aborted
        ? 'Cancelled'
        : err instanceof Error
          ? err.message
          : String(err)
    })
  } finally {
    if (_activeAbortController === controller) _activeAbortController = null
  }
}
```

Note: The import for `AiStreamEvent` needs to come from `../ipc/types`. Add to imports at top of file:

```typescript
import type { AiStreamEvent } from '../ipc/types'
```

Then update the `onEvent` parameter type in `langGraphStream`:

```typescript
onEvent: (event: AiStreamEvent) => void
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
npm test -- src/main/ai/__tests__/langGraphStream.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 2.5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2.6: Commit**

```bash
git add src/main/ai/langGraphAgent.ts src/main/ai/__tests__/langGraphStream.test.ts
git commit -m "feat(ai): add langGraphStream with tool tracking and abort support"
```

---

## Task 3 — Wire IPC handlers for stream and cancel

**Files:**

- Modify: `src/main/ipc/handlers/knowledge.ipc.ts`

- [ ] **Step 3.1: Add `AI_AGENT_STREAM` and `AI_AGENT_CANCEL` handlers**

Replace the entire content of `src/main/ipc/handlers/knowledge.ipc.ts`:

```typescript
import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { checkOllamaHealth } from '../../ai/ollama'
import {
  langGraphAsk,
  langGraphStream,
  abortActiveStream,
  type AgentHistory
} from '../../ai/langGraphAgent'
import { IpcChannel, type IpcResult, type AiStreamEvent } from '../types'

export function registerKnowledgeHandlers(): void {
  handle(IpcChannel.AI_CHECK, async (): Promise<IpcResult<boolean>> => {
    try {
      return { ok: true, data: await checkOllamaHealth() }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.AI_AGENT_ASK,
    async (
      _event: IpcMainInvokeEvent,
      question: string,
      history: AgentHistory[]
    ): Promise<IpcResult<string>> => {
      try {
        return { ok: true, data: await langGraphAsk(question, history) }
      } catch (err) {
        log.error('[IPC] AI_AGENT_ASK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // Starts a streaming session. Returns immediately; events arrive via AI_STREAM_EVENT push.
  handle(
    IpcChannel.AI_AGENT_STREAM,
    (event: IpcMainInvokeEvent, question: string, history: AgentHistory[]): IpcResult<void> => {
      const sender = event.sender
      const send = (ev: AiStreamEvent): void => {
        if (!sender.isDestroyed()) sender.send(IpcChannel.AI_STREAM_EVENT, ev)
      }
      langGraphStream(question, history, send).catch((err) => {
        send({ type: 'error', message: safeError(err) })
      })
      return { ok: true, data: undefined }
    }
  )

  handle(IpcChannel.AI_AGENT_CANCEL, (): void => {
    abortActiveStream()
  })
}
```

- [ ] **Step 3.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/main/ipc/handlers/knowledge.ipc.ts
git commit -m "feat(ai): register AI_AGENT_STREAM and AI_AGENT_CANCEL IPC handlers"
```

---

## Task 4 — Add `before-quit` abort guard in main process

**Files:**

- Modify: `src/main/index.ts`

- [ ] **Step 4.1: Import `abortActiveStream` and add quit guard**

In `src/main/index.ts`, add `abortActiveStream` to the existing import from `langGraphAgent` (or add a new import if not already imported):

```typescript
import { autoIndexRagBooks } from './ai/ragIndexer'
import { abortActiveStream } from './ai/langGraphAgent'
```

Then, in the `app.whenReady()` callback (or at module level after the imports), add:

```typescript
app.on('before-quit', () => {
  abortActiveStream()
})
```

Place it near the other `app.on(...)` listeners (e.g., after `app.on('browser-window-created', ...)`).

- [ ] **Step 4.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(ai): abort active stream on app before-quit"
```

---

## Task 5 — Extend preload bridge

**Files:**

- Modify: `src/preload/index.ts`

The preload has three layers: `realApi`, `mockApi`, and `bridgeApi`. All three need updating.

- [ ] **Step 5.1: Add `AiStreamEvent` to the existing top-level import in `preload/index.ts`**

The file already has `import type { ..., IpcResult, ... } from '../main/ipc/types'` at the top. Add `AiStreamEvent` to that import:

```typescript
import type {
  // ... existing types ...
  IpcResult,
  AiStreamEvent // ← add this
  // ... rest ...
} from '../main/ipc/types'
```

Then add to `realApi` after the existing `aiAgentAsk` entry:

```typescript
  aiAgentStream: (
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(IpcChannel.AI_AGENT_STREAM, question, history),

  aiAgentCancel: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.AI_AGENT_CANCEL),

  onAiStreamEvent: (callback: (event: AiStreamEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, ev: AiStreamEvent) => callback(ev)
    ipcRenderer.on(IpcChannel.AI_STREAM_EVENT, listener)
    return () => ipcRenderer.removeListener(IpcChannel.AI_STREAM_EVENT, listener)
  },
```

- [ ] **Step 5.2: Add to `mockApi` (lines ~546+)**

In the `mockApi` object, after `aiAgentAsk` (or wherever the AI methods are in mockApi):

```typescript
  aiAgentStream: (
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<IpcResult<void>> => {
    void question; void history
    return Promise.resolve({ ok: true, data: undefined })
  },

  aiAgentCancel: (): Promise<void> => Promise.resolve(),

  onAiStreamEvent: (_cb: (event: import('../main/ipc/types').AiStreamEvent) => void): (() => void) => {
    return () => { /* no-op in mock */ }
  },
```

- [ ] **Step 5.3: Add to `bridgeApi` (lines ~936-938)**

In the `bridgeApi` object, after `aiAgentAsk`:

```typescript
  aiAgentStream: (q: string, h: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    api.aiAgentStream(q, h),
  aiAgentCancel: () => api.aiAgentCancel(),
  onAiStreamEvent: (cb: (e: AiStreamEvent) => void) => api.onAiStreamEvent(cb),
```

- [ ] **Step 5.4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5.5: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(ai): expose aiAgentStream, aiAgentCancel, onAiStreamEvent in preload bridge"
```

---

## Task 6 — Extend `aiChatStore` with streaming state

**Files:**

- Modify: `src/renderer/src/store/aiChatStore.ts`
- Create: `src/renderer/src/__tests__/aiChatStore.test.ts`

- [ ] **Step 6.1: Write the failing tests**

Create `src/renderer/src/__tests__/aiChatStore.test.ts`:

```typescript
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
```

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
npm test -- src/renderer/src/__tests__/aiChatStore.test.ts
```

Expected: FAIL — `startStreaming`, `appendToken`, `addToolStep`, `completeToolStep`, `finalizeStreaming`, `resetStreaming` not defined.

- [ ] **Step 6.3: Rewrite `aiChatStore.ts` with new state**

Replace the entire content of `src/renderer/src/store/aiChatStore.ts`:

```typescript
import { create } from 'zustand'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

export interface ToolStep {
  name: string
  status: 'running' | 'done'
  output?: string
}

interface AiChatStore {
  messages: AiMessage[]
  loading: boolean
  streamingText: string
  toolSteps: ToolStep[]
  addMessage: (msg: AiMessage) => void
  setLoading: (v: boolean) => void
  clear: () => void
  startStreaming: () => void
  appendToken: (text: string) => void
  addToolStep: (name: string) => void
  completeToolStep: (name: string, output: string) => void
  finalizeStreaming: () => void
  resetStreaming: (error: string) => void
}

export const useAiChatStore = create<AiChatStore>((set, get) => ({
  messages: [],
  loading: false,
  streamingText: '',
  toolSteps: [],

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ messages: [], loading: false, streamingText: '', toolSteps: [] }),

  startStreaming: () => set({ streamingText: '', toolSteps: [] }),

  appendToken: (text) => set((s) => ({ streamingText: s.streamingText + text })),

  addToolStep: (name) => set((s) => ({ toolSteps: [...s.toolSteps, { name, status: 'running' }] })),

  completeToolStep: (name, output) =>
    set((s) => ({
      toolSteps: s.toolSteps.map((step) =>
        step.name === name && step.status === 'running' ? { ...step, status: 'done', output } : step
      )
    })),

  finalizeStreaming: () => {
    const { streamingText } = get()
    if (!streamingText) return
    set((s) => ({
      messages: [...s.messages, { role: 'assistant', content: streamingText, ts: Date.now() }],
      streamingText: '',
      toolSteps: []
    }))
  },

  resetStreaming: (error) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          role: 'assistant',
          content: `Error: ${error}\n\nMake sure Ollama is running:\n  ollama serve\n  ollama pull llama3.2:3b`,
          ts: Date.now()
        }
      ],
      streamingText: '',
      toolSteps: []
    }))
}))
```

- [ ] **Step 6.4: Run tests to verify they pass**

```bash
npm test -- src/renderer/src/__tests__/aiChatStore.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 6.5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6.6: Commit**

```bash
git add src/renderer/src/store/aiChatStore.ts src/renderer/src/__tests__/aiChatStore.test.ts
git commit -m "feat(ai): extend aiChatStore with streaming state and actions"
```

---

## Task 7 — Update `AIPanel` with ToolTimeline, StreamingBubble, and Cancel

**Files:**

- Modify: `src/renderer/src/components/ai/AIPanel.tsx`

- [ ] **Step 7.1: Add new imports**

At the top of `src/renderer/src/components/ai/AIPanel.tsx`, add these imports alongside the existing ones:

```typescript
import Accordion from '@mui/material/Accordion'
import AccordionSummary from '@mui/material/AccordionSummary'
import AccordionDetails from '@mui/material/AccordionDetails'
import Chip from '@mui/material/Chip'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import CancelIcon from '@mui/icons-material/Cancel'
import type { ToolStep } from '../../store/aiChatStore'
```

Derive `AiStreamEvent` from the bridge type (avoids fragile relative import paths across the main/renderer boundary):

```typescript
type AiStreamEvent = Parameters<typeof window.sqlSentinel.onAiStreamEvent>[0]
```

Place this type alias at the top of the file, after the imports.

- [ ] **Step 7.2: Rewrite `sendMessage` to use streaming IPC**

Replace the `sendMessage` callback in `AIPanel.tsx` (the entire `useCallback` from lines 44–82) with:

```typescript
const sendMessage = useCallback(async () => {
  const text = input.trim()
  if (!text || loading) return

  setInput('')
  addMessage({ role: 'user', content: text, ts: Date.now() })
  setLoading(true)
  startStreaming()

  const history = useAiChatStore
    .getState()
    .messages.slice(-6)
    .map((m) => ({ role: m.role, content: m.content }))

  const unsubscribe = window.sqlSentinel.onAiStreamEvent((ev: AiStreamEvent) => {
    if (!mountedRef.current) return
    if (ev.type === 'token') {
      appendToken(ev.text)
    } else if (ev.type === 'tool_start') {
      addToolStep(ev.name)
    } else if (ev.type === 'tool_end') {
      completeToolStep(ev.name, ev.output)
    } else if (ev.type === 'done') {
      unsubscribe()
      finalizeStreaming()
      if (mountedRef.current) setLoading(false)
    } else if (ev.type === 'error') {
      unsubscribe()
      if (ev.message === 'Cancelled') {
        finalizeStreaming()
      } else {
        resetStreaming(ev.message)
      }
      if (mountedRef.current) setLoading(false)
    }
  })

  const result = await window.sqlSentinel.aiAgentStream(text, history)
  if (!result.ok) {
    unsubscribe()
    resetStreaming(result.error)
    if (mountedRef.current) setLoading(false)
  }
}, [
  input,
  loading,
  addMessage,
  setLoading,
  startStreaming,
  appendToken,
  addToolStep,
  completeToolStep,
  finalizeStreaming,
  resetStreaming
])
```

- [ ] **Step 7.3: Update store destructuring in `AIPanel`**

Replace the existing store destructuring (line 27):

```typescript
const {
  messages,
  loading,
  addMessage,
  setLoading,
  clear,
  streamingText,
  toolSteps,
  startStreaming,
  appendToken,
  addToolStep,
  completeToolStep,
  finalizeStreaming,
  resetStreaming
} = useAiChatStore()
```

- [ ] **Step 7.4: Add `ToolTimeline` and `StreamingBubble` to the messages area**

In the messages area (inside the scroll box, after `messages.map(...)`), replace the loading spinner with:

```typescript
{/* Tool timeline — shown while agent is calling tools */}
{toolSteps.length > 0 && <ToolTimeline steps={toolSteps} />}

{/* Streaming bubble — shows tokens as they arrive */}
{streamingText && <StreamingBubble text={streamingText} loading={loading} />}

{/* Fallback spinner when loading but no content yet */}
{loading && !streamingText && toolSteps.length === 0 && (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1 }}>
    <CircularProgress size={14} />
    <Typography sx={{ fontSize: tokens.font.sizeSm, color: 'text.secondary', fontStyle: 'italic' }}>
      Agent is starting…
    </Typography>
  </Box>
)}
```

- [ ] **Step 7.5: Replace the Send button with a Cancel/Send toggle**

Replace the `endAdornment` Button in the TextField's `slotProps.input`:

```typescript
endAdornment: loading ? (
  <Button
    onClick={() => window.sqlSentinel.aiAgentCancel()}
    variant="outlined"
    color="error"
    size="small"
    sx={{ ml: 1, flexShrink: 0, alignSelf: 'flex-end', mb: 0.25 }}
    startIcon={<CancelIcon fontSize="small" />}
  >
    Cancel
  </Button>
) : (
  <Button
    onClick={sendMessage}
    disabled={!input.trim()}
    variant="contained"
    size="small"
    sx={{ ml: 1, flexShrink: 0, alignSelf: 'flex-end', mb: 0.25 }}
  >
    Send
  </Button>
)
```

- [ ] **Step 7.6: Add `ToolTimeline` component at the bottom of the file**

After the `MessageBubble` component, add:

```typescript
interface ToolTimelineProps {
  steps: ToolStep[]
}

function ToolTimeline({ steps }: ToolTimelineProps): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {steps.map((step, i) => (
        <Accordion
          key={i}
          disableGutters
          elevation={0}
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: '8px !important',
            '&:before': { display: 'none' },
            bgcolor: 'background.paper'
          }}
        >
          <AccordionSummary
            expandIcon={step.output ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : undefined}
            sx={{ minHeight: 32, py: 0, px: 1.5, '& .MuiAccordionSummary-content': { my: 0.5 } }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {step.status === 'running' ? (
                <CircularProgress size={12} />
              ) : (
                <CheckCircleOutlineIcon sx={{ fontSize: 14, color: 'success.main' }} />
              )}
              <Typography sx={{ fontSize: tokens.font.sizeXs, fontFamily: 'monospace' }}>
                {step.name}
              </Typography>
              <Chip
                label={step.status}
                size="small"
                color={step.status === 'done' ? 'success' : 'default'}
                sx={{ height: 16, fontSize: 10 }}
              />
            </Box>
          </AccordionSummary>
          {step.output && (
            <AccordionDetails sx={{ px: 1.5, pb: 1, pt: 0 }}>
              <ToolOutput output={step.output} />
            </AccordionDetails>
          )}
        </Accordion>
      ))}
    </Box>
  )
}

interface ToolOutputProps {
  output: string
}

function ToolOutput({ output }: ToolOutputProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const truncated = output.length > 500
  const displayed = truncated && !expanded ? output.slice(0, 500) + '…' : output
  return (
    <Box>
      <Typography
        component="pre"
        sx={{
          fontSize: 10,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          m: 0,
          color: 'text.secondary',
          maxHeight: 200,
          overflowY: 'auto'
        }}
      >
        {displayed}
      </Typography>
      {truncated && (
        <Button size="small" onClick={() => setExpanded((v) => !v)} sx={{ mt: 0.5, fontSize: 10, p: 0 }}>
          {expanded ? 'show less' : 'show all'}
        </Button>
      )}
    </Box>
  )
}

interface StreamingBubbleProps {
  text: string
  loading: boolean
}

function StreamingBubble({ text, loading }: StreamingBubbleProps): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
      <Box
        sx={{
          maxWidth: '85%',
          px: 1.5,
          py: 1,
          borderRadius: '12px 12px 12px 2px',
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          boxShadow: tokens.shadow.card
        }}
      >
        <Typography
          component="pre"
          sx={{
            fontSize: tokens.font.sizeSm,
            fontFamily: 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            m: 0,
            color: 'text.primary'
          }}
        >
          {text}
          {loading && (
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: 8,
                height: '1em',
                bgcolor: 'text.primary',
                ml: '2px',
                verticalAlign: 'text-bottom',
                animation: 'blink 1s step-end infinite',
                '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } }
              }}
            />
          )}
        </Typography>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 7.7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. Fix any type errors before proceeding.

- [ ] **Step 7.8: Run all tests**

```bash
npm test
```

Expected: all existing tests + new tests PASS.

- [ ] **Step 7.9: Manual test — happy path**

1. Run `npm run dev`
2. Open the AI panel
3. Ensure Ollama is running: `ollama serve` and `ollama pull llama3.2:3b`
4. Ask: "Which servers have high CPU?"
5. Verify:
   - Tool steps appear one by one with spinner → checkmark
   - Each tool step has an expandable accordion showing raw JSON
   - LLM tokens appear in the streaming bubble as they arrive
   - Blinking cursor visible while generating
   - On completion, bubble becomes a normal message (cursor disappears)

- [ ] **Step 7.10: Manual test — cancel**

1. Send a question
2. While tool steps are running, click "Cancel"
3. Verify:
   - Any tokens already received are preserved as a completed message
   - No error bubble shown (cancel is graceful)
   - Send button returns immediately

- [ ] **Step 7.11: Commit**

```bash
git add src/renderer/src/components/ai/AIPanel.tsx
git commit -m "feat(ai): streaming UI — ToolTimeline, StreamingBubble, Cancel button"
```

---

## Task 8 — Full regression pass

- [ ] **Step 8.1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8.2: Typecheck final**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8.3: Manual smoke test — existing `aiAgentAsk` path still works**

The old `AI_AGENT_ASK` IPC handler is still registered. Verify no regression by checking the handler is still in `knowledge.ipc.ts` and the preload still exposes `aiAgentAsk`.

- [ ] **Step 8.4: Final commit**

```bash
git add -A
git commit -m "feat(ai): streaming agent with tool timeline and cancel — complete"
```
