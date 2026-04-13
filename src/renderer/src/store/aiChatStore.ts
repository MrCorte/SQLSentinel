import { create } from 'zustand'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

interface AiChatStore {
  messages: AiMessage[]
  loading: boolean
  addMessage: (msg: AiMessage) => void
  setLoading: (v: boolean) => void
  clear: () => void
}

export const useAiChatStore = create<AiChatStore>((set) => ({
  messages: [],
  loading: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ messages: [], loading: false })
}))
