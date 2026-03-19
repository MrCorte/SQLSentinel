import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ServerGroup } from '../types/index'

// Stable IDs so the default groups survive a page reload without duplicating
const DEFAULT_GROUPS: ServerGroup[] = [
  { id: 'default-prod', name: 'Produzione', color: '#a4262c', collapsed: false, order: 0 },
  { id: 'default-coll', name: 'Collaudo', color: '#d83b01', collapsed: false, order: 1 },
  { id: 'default-dev', name: 'Sviluppo', color: '#107c10', collapsed: false, order: 2 }
]

interface GroupsState {
  groups: ServerGroup[]
  serverGroups: Record<string, string> // serverId (ip:port) → groupId
  serverAliases: Record<string, string> // serverId → display alias
  expandedAGs: string[] // ag_names that are expanded (empty = all collapsed)
  addGroup: (name: string, color: string) => void
  removeGroup: (id: string) => void
  renameGroup: (id: string, name: string) => void
  toggleCollapse: (id: string) => void
  reorderGroups: (newOrder: ServerGroup[]) => void
  setServerGroup: (serverId: string, groupId: string | undefined) => void
  setServerAlias: (serverId: string, alias: string) => void
  toggleAgCollapse: (agName: string) => void
}

export const useGroupsStore = create<GroupsState>()(
  persist(
    (set) => ({
      groups: DEFAULT_GROUPS,
      serverGroups: {},
      serverAliases: {},
      expandedAGs: [],

      addGroup: (name, color) =>
        set((state) => ({
          groups: [
            ...state.groups,
            {
              id: crypto.randomUUID(),
              name,
              color,
              collapsed: false,
              order: state.groups.length
            }
          ]
        })),

      removeGroup: (id) =>
        set((state) => {
          const newServerGroups = { ...state.serverGroups }
          for (const [sid, gid] of Object.entries(newServerGroups)) {
            if (gid === id) delete newServerGroups[sid]
          }
          return {
            groups: state.groups.filter((g) => g.id !== id),
            serverGroups: newServerGroups
          }
        }),

      renameGroup: (id, name) =>
        set((state) => ({
          groups: state.groups.map((g) => (g.id === id ? { ...g, name } : g))
        })),

      toggleCollapse: (id) =>
        set((state) => ({
          groups: state.groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g))
        })),

      reorderGroups: (newOrder) =>
        set(() => ({
          groups: newOrder.map((g, i) => ({ ...g, order: i }))
        })),

      setServerGroup: (serverId, groupId) =>
        set((state) => {
          const next = { ...state.serverGroups }
          if (groupId === undefined) {
            delete next[serverId]
          } else {
            next[serverId] = groupId
          }
          return { serverGroups: next }
        }),

      setServerAlias: (serverId, alias) =>
        set((state) => {
          const next = { ...state.serverAliases }
          if (alias.trim()) {
            next[serverId] = alias.trim()
          } else {
            delete next[serverId]
          }
          return { serverAliases: next }
        }),

      toggleAgCollapse: (agName) =>
        set((state) => {
          const isExpanded = state.expandedAGs.includes(agName)
          return {
            expandedAGs: isExpanded
              ? state.expandedAGs.filter((n) => n !== agName)
              : [...state.expandedAGs, agName]
          }
        })
    }),
    { name: 'sql-sentinel-groups' }
  )
)
