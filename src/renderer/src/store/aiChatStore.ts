import { create } from 'zustand'
import type { IncidentAction } from '../../../preload/index'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

export interface ToolStep {
  name: string
  status: 'running' | 'done'
  output?: string
}

const SAFE_AI_ERROR_PATTERNS = [
  /network/i,
  /timeout/i,
  /connection refused/i,
  /cancelled/i,
  /model not found/i,
  /context length/i,
  /rate limit/i,
  /overloaded/i
]

function sanitizeAiError(raw: string): string {
  if (SAFE_AI_ERROR_PATTERNS.some((p) => p.test(raw))) return `Error: ${raw}`
  return 'Error: AI provider error. Check your provider settings and try again.'
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

interface AiChatStore {
  messages: AiMessage[]
  loading: boolean
  streamingText: string
  toolSteps: ToolStep[]
  /** AI-proposed remediation actions awaiting (or past) user approval. */
  proposedActions: IncidentAction[]
  /** Per-message feedback rating (1 = thumbs up, -1 = thumbs down). Volatile. */
  feedbackByMessageId: Record<string, 1 | -1>
  addMessage: (msg: Omit<AiMessage, 'id'> & { id?: string }) => void
  setLoading: (v: boolean) => void
  clear: () => void
  startStreaming: () => void
  appendToken: (text: string) => void
  addToolStep: (name: string) => void
  completeToolStep: (name: string, output: string) => void
  finalizeStreaming: () => void
  resetStreaming: (error: string) => void
  setFeedback: (id: string, rating: 1 | -1) => void
  /** Insert or replace a proposed action by id (proposal + status updates). */
  upsertProposedAction: (action: IncidentAction) => void
}

export const useAiChatStore = create<AiChatStore>((set, get) => ({
  messages: [],
  loading: false,
  streamingText: '',
  toolSteps: [],
  proposedActions: [],
  feedbackByMessageId: {},

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, { id: msg.id ?? newId(), ...msg }] })),
  setLoading: (loading) => set({ loading }),
  clear: () =>
    set({
      messages: [],
      loading: false,
      streamingText: '',
      toolSteps: [],
      proposedActions: [],
      feedbackByMessageId: {}
    }),

  startStreaming: () => set({ streamingText: '', toolSteps: [] }),

  appendToken: (text) => set((s) => ({ streamingText: s.streamingText + text })),

  addToolStep: (name) =>
    set((s) => ({ toolSteps: [...s.toolSteps, { name, status: 'running' }] })),

  completeToolStep: (name, output) =>
    set((s) => ({
      toolSteps: s.toolSteps.map((step) =>
        step.name === name && step.status === 'running' ? { ...step, status: 'done', output } : step
      )
    })),

  finalizeStreaming: () => {
    const { streamingText, toolSteps } = get()
    const content = streamingText || (toolSteps.length > 0 ? '*(no text response)*' : '')
    if (!content) return
    set((s) => ({
      messages: [...s.messages, { id: newId(), role: 'assistant', content, ts: Date.now() }],
      streamingText: '',
      toolSteps: []
    }))
  },

  resetStreaming: (error) => {
    // Sanitize before rendering: raw provider errors may contain API keys,
    // connection strings, or internal stack traces from the main process.
    const safe = sanitizeAiError(error)
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: newId(),
          role: 'assistant',
          content: `${safe}\n\nMake sure Ollama is running:\n  ollama serve\n  ollama pull gemma4:e4b`,
          ts: Date.now()
        }
      ],
      streamingText: '',
      toolSteps: []
    }))
  },

  setFeedback: (id, rating) =>
    set((s) => ({ feedbackByMessageId: { ...s.feedbackByMessageId, [id]: rating } })),

  upsertProposedAction: (action) =>
    set((s) => {
      const idx = s.proposedActions.findIndex((a) => a.id === action.id)
      if (idx === -1) return { proposedActions: [...s.proposedActions, action] }
      const next = s.proposedActions.slice()
      next[idx] = action
      return { proposedActions: next }
    })
}))
