# AI Assistant — Streaming & Tool Timeline

**Date:** 2026-04-22  
**Branch:** feature/ai-assistant  
**Status:** Approved

## Problem

The AI DBA Assistant currently calls `agent.invoke()` and blocks for up to 60 seconds with only a spinner. The user has no visibility into what the agent is doing or how far along it is.

## Goal

- Show each LangGraph tool call as it happens, with its name and collapsible output
- Stream the final LLM response token by token
- Add a Cancel button to abort mid-flight
- Gracefully finalize partial messages if the Electron app closes during a stream

## Out of scope

- Markdown rendering in message bubbles
- Persistent chat history across app restarts (Zustand in-memory is sufficient)
- Model selection UI

---

## Architecture

### Data flow

```
langGraphStream() [main]
  agent.stream({ streamMode: ['messages', 'updates'] })
    ├─ tool_start  → webContents.send('ai:streamEvent', { type: 'tool_start', name })
    ├─ tool_end    → webContents.send('ai:streamEvent', { type: 'tool_end', name, output })
    ├─ token       → webContents.send('ai:streamEvent', { type: 'token', text })
    ├─ done        → webContents.send('ai:streamEvent', { type: 'done' })
    └─ error       → webContents.send('ai:streamEvent', { type: 'error', message })

IPC invoke  'ai:agentStream'  → starts stream, returns void immediately
IPC invoke  'ai:agentCancel'  → aborts active AbortController
IPC push    'ai:streamEvent'  → renderer listener receives incremental events
```

### Event types

```typescript
type AiStreamEvent =
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end';   name: string; output: string }
  | { type: 'token';      text: string }
  | { type: 'done' }
  | { type: 'error';      message: string }
```

---

## Files changed

### `src/main/ai/langGraphAgent.ts`

New export:

```typescript
export async function langGraphStream(
  question: string,
  history: AgentHistory[],
  onEvent: (event: AiStreamEvent) => void
): Promise<void>
```

- Replaces `langGraphAsk()` (kept for backward compatibility until fully migrated)
- Uses `agent.stream({ messages }, { streamMode: ['messages', 'updates'], signal })`
- LangGraph event mapping:
  - `updates` chunk with `tools` key → `tool_start` + `tool_end`
  - `messages` chunk with `AIMessageChunk` → `token`
  - Stream end → `done`
  - Exception → `error`
- Active `AbortController` stored in module-level variable, replaced on each call

### `src/main/ipc/types.ts`

Add to `IpcChannel` enum:
```typescript
AI_AGENT_STREAM = 'ai:agentStream',
AI_AGENT_CANCEL = 'ai:agentCancel',
AI_STREAM_EVENT  = 'ai:streamEvent',
```

Add `AiStreamEvent` type export.

### `src/main/ipc/handlers/knowledge.ipc.ts`

- `AI_AGENT_STREAM` handler: calls `langGraphStream()`, uses `event.sender` to push `AI_STREAM_EVENT` via `webContents.send()`. Guards every send with `if (!event.sender.isDestroyed())`.
- `AI_AGENT_CANCEL` handler: calls `abortActiveStream()` from `langGraphAgent.ts`.

### `src/main/index.ts`

```typescript
app.on('before-quit', () => abortActiveStream())
```

Ensures a stream in progress sends a final `{ type: 'error', message: 'App closing' }` event so the renderer can finalize the partial message.

### `src/preload/index.ts`

Add to `window.sqlSentinel`:

```typescript
aiAgentStream: (question: string, history: AgentHistory[]) => Promise<IpcResult<void>>
aiAgentCancel: () => Promise<void>
onAiStreamEvent: (cb: (event: AiStreamEvent) => void) => () => void  // returns unsubscribe fn
```

`onAiStreamEvent` wraps `ipcRenderer.on / ipcRenderer.removeListener`.

### `src/renderer/src/store/aiChatStore.ts`

New state fields:

```typescript
streamingText: string        // accumulates tokens during active stream
toolSteps: ToolStep[]        // tool calls for current request

interface ToolStep {
  name: string
  status: 'running' | 'done'
  output?: string            // populated on tool_end
}
```

New actions:

```typescript
appendToken: (text: string) => void
addToolStep: (name: string) => void
completeToolStep: (name: string, output: string) => void
startStreaming: () => void      // clears streamingText + toolSteps before each new request
finalizeStreaming: () => void   // on 'done' or graceful cancel: moves streamingText into messages[], clears toolSteps
resetStreaming: (error: string) => void  // on unrecoverable error: discards streamingText, adds error bubble
```

### `src/renderer/src/components/ai/AIPanel.tsx`

**Behavior changes:**
- `sendMessage()` calls `startStreaming()`, then `aiAgentStream()` (invoke), then subscribes to `onAiStreamEvent()`
- Unsubscribe function returned by `onAiStreamEvent` is called in cleanup and on cancel
- Cancel button replaces Send during loading
- On `done`: calls `finalizeStreaming()`
- On `error` from cancel or app-quit: calls `finalizeStreaming()` (partial text preserved)
- On `error` from Ollama/timeout: calls `resetStreaming(message)` (error bubble shown)

**New sub-components (same file):**

`ToolTimeline` — renders `toolSteps[]` as a vertical list:
- Each step: status icon (spinner / checkmark) + tool name
- MUI `Accordion` (collapsed by default) shows raw `output` truncated to 500 chars with "show all" toggle

`StreamingBubble` — assistant bubble that renders `streamingText` with a blinking cursor while `loading === true`. Reuses `MessageBubble` styling.

**Cancel button:**
- Shown only when `loading === true`
- Calls `window.sqlSentinel.aiAgentCancel()`
- On `{ type: 'error' }` received after cancel: calls `finalizeStreaming()` (preserves partial text)

---

## Error handling

| Scenario | Behavior |
|---|---|
| Ollama not running | `error` event → error message bubble, partial text preserved |
| Cancelled by user | `error` event with "Cancelled" → `finalizeStreaming()`, partial text shown |
| Tool throws internally | Caught in `langGraphStream`, emits `error` event |
| `webContents` destroyed mid-stream | `isDestroyed()` guard on every `send()` |
| App closes during stream | `before-quit` aborts controller → `error` event → `finalizeStreaming()` |
| No tokens received within 60s | `AbortSignal.timeout(60_000)` unchanged, triggers `error` event |

---

## Non-goals / constraints

- `langGraphAsk()` is **not** removed — left in place until all callers are migrated
- Tool output displayed as raw text (no formatting)
- No change to the 6-message history window
- `numPredict: 512` unchanged (separate concern)
- No new npm dependencies — LangGraph streaming API is already available in `@langchain/langgraph`
