import { create } from 'zustand'
import type { StoredServer, ServerAddResult, UpdateServerRequest } from '../../../preload/index'

interface ServersStore {
  servers: StoredServer[]
  initialized: boolean
  loadServers: () => Promise<void>
  addServer: (params: Omit<StoredServer, 'id' | 'addedAt'>) => Promise<ServerAddResult>
  removeServer: (id: string) => Promise<void>
  updateServer: (id: string, patch: Partial<StoredServer>) => Promise<void>
}

export const useServersStore = create<ServersStore>((set) => ({
  servers: [],
  initialized: false,

  loadServers: async () => {
    const result = await window.sqlSentinel.servers.getAll()
    if (result.ok) set({ servers: result.data, initialized: true })
  },

  addServer: async (params) => {
    const result = await window.sqlSentinel.servers.add(params)
    if (result.ok && result.data.success && result.data.server) {
      set((state) => ({ servers: [...state.servers, result.data.server!] }))
    }
    return result.ok ? result.data : { success: false, reason: result.error }
  },

  removeServer: async (id) => {
    await window.sqlSentinel.servers.remove(id)
    set((state) => ({ servers: state.servers.filter((s) => s.id !== id) }))
  },

  updateServer: async (id, patch) => {
    const req: UpdateServerRequest = { id, patch }
    await window.sqlSentinel.servers.update(req)
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, ...patch } : s))
    }))
  }
}))
