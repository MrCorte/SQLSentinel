import { create } from 'zustand'
import type { StoredServer, ServerAddResult } from '../../../preload/index'
import { useAgStore } from './agStore'

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
    try {
      console.log('[serversStore] loadServers START')
      const result = await window.sqlSentinel.servers.getAll()
      console.log('[serversStore] getAll result:', JSON.stringify(result))

      const list: StoredServer[] = Array.isArray(result) ? result : []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalized = list.map((s: any) => {
        const addr: string = s.host ?? s.ip ?? ''
        // Set both host (canonical) and ip (compat with all renderer code that uses s.ip)
        return { ...s, host: addr, ip: addr }
      })

      console.log('[serversStore] set servers:', normalized.length)
      set({ servers: normalized, initialized: true })
      console.log('[serversStore] loadServers DONE')
    } catch (e) {
      console.error('[serversStore] loadServers ERROR:', e)
      set({ initialized: true })
    }
  },

  addServer: async (params) => {
    try {
      console.log('[serversStore] addServer — params:', JSON.stringify(params))
      const result = await window.sqlSentinel.servers.add(params)
      console.log('[serversStore] add IPC result:', JSON.stringify(result))
      // result is flat { success, reason?, server? }
      if (result?.success !== false) {
        const raw = result?.server ?? (params as StoredServer)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addr: string = (raw as any).host ?? (raw as any).ip ?? ''
        const addedServer: StoredServer = { ...raw, host: addr, ip: addr }
        set((state) => ({ servers: [...state.servers, addedServer] }))
        // AG detection in background — non-blocking
        if (addedServer.id) {
          useAgStore.getState().detectAgsForServer(addedServer.id, {
            ip: addedServer.ip ?? addedServer.host,
            port: addedServer.port,
            instanceName: addedServer.instanceName,
            useWindowsAuth: addedServer.useWindowsAuth,
            username: addedServer.username,
            password: addedServer.password
          })
        }
        return { success: true, server: addedServer }
      }
      return result ?? { success: false }
    } catch (e) {
      console.error('[serversStore] addServer error:', e)
      return { success: false, reason: String(e) }
    }
  },

  removeServer: async (id) => {
    try {
      await window.sqlSentinel.servers.remove(id)
      set((state) => ({ servers: state.servers.filter((s) => s.id !== id) }))
    } catch (e) {
      console.error('[serversStore] removeServer error:', e)
    }
  },

  updateServer: async (id, patch) => {
    try {
      await window.sqlSentinel.servers.update(id, patch)
      set((state) => ({
        servers: state.servers.map((s) => (s.id === id ? { ...s, ...patch } : s))
      }))
    } catch (e) {
      console.error('[serversStore] updateServer error:', e)
    }
  }
}))
