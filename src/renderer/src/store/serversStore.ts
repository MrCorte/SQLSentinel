import { create } from 'zustand'
import type { StoredServer, ServerAddResult } from '../../../preload/index'
import { useAgStore } from './agStore'
import { useMetricsStore } from './metricsStore'
import { useAlertsStore } from './alertsStore'
import { useGroupsStore } from './groupsStore'
import { notify } from './notifyStore'
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
        // Set both host (canonical) and ip (compat with all renderer code that uses s.ip)
        return { ...s, host: addr, ip: addr }
      })

      log.info('set servers:', normalized.length)
      set({ servers: normalized, initialized: true })
      log.info('loadServers DONE')
    } catch (e) {
      log.error('loadServers ERROR:', e)
      notify.error('Could not load the server list. Open the logs for details.', 'Load failed')
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
        // AG detection in background — non-blocking.
        // We pass the current server list and updateServer callback so agStore
        // can write AG metadata back without importing serversStore itself.
        if (addedServer.id) {
          const allServers = useServersStore.getState().servers
          useAgStore.getState().detectAgsForServer(
            addedServer.id,
            {
              ip: addedServer.ip ?? addedServer.host,
              port: addedServer.port,
              instanceName: addedServer.instanceName,
              useWindowsAuth: addedServer.useWindowsAuth,
              username: addedServer.username,
              password: addedServer.password
            },
            allServers,
            useServersStore.getState().updateServer
          )
        }
        return { success: true, server: addedServer }
      }
      return result ?? { success: false }
    } catch (e) {
      log.error('addServer error:', e)
      notify.error(e instanceof Error ? e.message : String(e), 'Add server failed')
      return { success: false, reason: String(e) }
    }
  },

  removeServer: async (id) => {
    try {
      const server = useServersStore.getState().servers.find((s) => s.id === id)
      await ipc.servers.remove(id)
      set((state) => ({ servers: state.servers.filter((s) => s.id !== id) }))
      if (server) {
        const metricsKey = `${server.host ?? server.ip}:${server.port}`
        useMetricsStore.getState().deleteServerData(metricsKey)
        useAlertsStore.getState().deleteServerAlerts(metricsKey)
      }
      // Drop AG group memberships and persisted alias/group assignment for the
      // removed server. Without this, agStore retains a dead serverId entry
      // (sidebar shows phantom AG members) and groupsStore leaks the alias.
      useAgStore.getState().removeServer(id)
      useGroupsStore.getState().removeServer(id)
    } catch (e) {
      log.error('removeServer error:', e)
      notify.error(e instanceof Error ? e.message : String(e), 'Remove failed')
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
      notify.error(e instanceof Error ? e.message : String(e), 'Update failed')
    }
  }
}))
