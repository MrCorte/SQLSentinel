import { create } from 'zustand'
import type { StoredServer, ServerAddResult } from '../../../preload/index'
import { useAgStore } from './agStore'
import { createLogger } from '../utils/logger'
import * as ipc from '../api/ipc'

const log = createLogger('servers-store')

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
      log.info('loadServers START')
      const result = await ipc.servers.getAll()
      log.debug('getAll result:', JSON.stringify(result))

      const list: StoredServer[] = Array.isArray(result) ? result : []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalized = list.map((s: any) => {
        const addr: string = s.host ?? s.ip ?? ''
        // Imposta sia host (canonical) che ip (compat con tutto il codice renderer che usa s.ip)
        return { ...s, host: addr, ip: addr }
      })

      log.info('set servers:', normalized.length)
      set({ servers: normalized, initialized: true })
      log.info('loadServers DONE')
    } catch (e) {
      log.error('loadServers ERROR:', e)
      set({ initialized: true })
    }
  },

  addServer: async (params) => {
    try {
      log.debug('addServer — params:', JSON.stringify(params))
      const result = await ipc.servers.add(params)
      log.debug('add IPC result:', JSON.stringify(result))
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
      log.error('addServer error:', e)
      return { success: false, reason: String(e) }
    }
  },

  removeServer: async (id) => {
    try {
      await ipc.servers.remove(id)
      set((state) => ({ servers: state.servers.filter((s) => s.id !== id) }))
    } catch (e) {
      log.error('removeServer error:', e)
    }
  },

  updateServer: async (id, patch) => {
    try {
      await ipc.servers.update(id, patch)
      set((state) => ({
        servers: state.servers.map((s) => (s.id === id ? { ...s, ...patch } : s))
      }))
    } catch (e) {
      log.error('updateServer error:', e)
    }
  }
}))
