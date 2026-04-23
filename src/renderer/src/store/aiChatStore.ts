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
      messages: [...s.messages, { role: 'assistant', content, ts: Date.now() }],
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
