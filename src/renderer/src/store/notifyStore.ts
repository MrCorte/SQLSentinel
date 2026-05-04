import { create } from 'zustand'

export type NotifySeverity = 'success' | 'info' | 'warning' | 'error'

export interface NotifyEntry {
  id: number
  severity: NotifySeverity
  message: string
  /** Optional title shown above the message in bold */
  title?: string
  /** Auto-hide duration in ms; null disables auto-hide */
  autoHideMs: number | null
}

interface NotifyState {
  entries: NotifyEntry[]
  push: (entry: Omit<NotifyEntry, 'id'>) => number
  dismiss: (id: number) => void
  clear: () => void
}

let _seq = 0

export const useNotifyStore = create<NotifyState>((set) => ({
  entries: [],
  push: (entry) => {
    const id = ++_seq
    set((s) => ({ entries: [...s.entries, { id, ...entry }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  clear: () => set({ entries: [] })
}))

// Convenience helpers — call from anywhere (stores, hooks, components).
export const notify = {
  success: (message: string, title?: string): number =>
    useNotifyStore.getState().push({ severity: 'success', message, title, autoHideMs: 4000 }),
  info: (message: string, title?: string): number =>
    useNotifyStore.getState().push({ severity: 'info', message, title, autoHideMs: 5000 }),
  warning: (message: string, title?: string): number =>
    useNotifyStore.getState().push({ severity: 'warning', message, title, autoHideMs: 7000 }),
  error: (message: string, title?: string): number =>
    useNotifyStore.getState().push({ severity: 'error', message, title, autoHideMs: 10000 })
}
