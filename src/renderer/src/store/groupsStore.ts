import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StoredServer } from '../../../preload/index'
import type { ServerGroup } from '../types/index'

// Stable IDs so the default groups survive a page reload without duplicating
const DEFAULT_GROUPS: ServerGroup[] = [
  { id: 'default-prod', name: 'Produzione', color: '#a4262c', collapsed: false, order: 0 },
  { id: 'default-coll', name: 'Collaudo', color: '#d83b01', collapsed: false, order: 1 },
  { id: 'default-dev', name: 'Sviluppo', color: '#107c10', collapsed: false, order: 2 }
]

// ---------------------------------------------------------------------------
// Migration helper — convert legacy "ip:port" keys to server UUID id
// ---------------------------------------------------------------------------

/** Returns true if a key looks like a legacy "host:port" string rather than a UUID. */
function looksLikeIpPort(key: string): boolean {
  return (
    /^.+:\d+$/.test(key) &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  )
}

/**
 * One-time migration: remap any serverAliases keys that look like "ip:port"
 * to the corresponding server UUID. Called after serversStore has loaded.
 *
 * Best-effort: if a server cannot be matched by host+port, the old key is
 * preserved so no alias is silently lost. Keys already in UUID format are skipped.
 */
export function migrateAliasKeys(servers: StoredServer[]): void {
  const { serverAliases } = useGroupsStore.getState()
  const legacyEntries = Object.entries(serverAliases).filter(([k]) => looksLikeIpPort(k))
  if (legacyEntries.length === 0) return

  const next: Record<string, string> = { ...serverAliases }
  for (const [key, alias] of legacyEntries) {
    const colonIdx = key.lastIndexOf(':')
    const host = key.slice(0, colonIdx)
    const port = parseInt(key.slice(colonIdx + 1), 10)
    const match = servers.find((s) => (s.host === host || s.ip === host) && s.port === port)
    if (match) {
      next[match.id] = alias
      delete next[key]
    }
    // If no match found, leave the old key in place (conservative / no data loss)
  }
  useGroupsStore.setState({ serverAliases: next })
}

/**
 * One-time migration: remap any serverGroups keys that look like "ip:port"
 * to the corresponding server UUID. Mirrors migrateAliasKeys for the group-assignment map.
 */
export function migrateServerGroupKeys(servers: StoredServer[]): void {
  const { serverGroups } = useGroupsStore.getState()
  const legacyEntries = Object.entries(serverGroups).filter(([k]) => looksLikeIpPort(k))
  if (legacyEntries.length === 0) return

  const next: Record<string, string> = { ...serverGroups }
  for (const [key, groupId] of legacyEntries) {
    const colonIdx = key.lastIndexOf(':')
    const host = key.slice(0, colonIdx)
    const port = parseInt(key.slice(colonIdx + 1), 10)
    const match = servers.find((s) => (s.host === host || s.ip === host) && s.port === port)
    if (match) {
      next[match.id] = groupId
      delete next[key]
    }
  }
  useGroupsStore.setState({ serverGroups: next })
}

interface GroupsState {
  groups: ServerGroup[]
  serverGroups: Record<string, string> // server UUID → groupId
  serverAliases: Record<string, string> // server.id (UUID) → display alias
  expandedAGs: string[] // ag_names that are expanded (empty = all collapsed)
  expandedMachines: string[] // machine names that are expanded in sidebar (empty = all collapsed)
  addGroup: (name: string, color: string) => void
  removeGroup: (id: string) => void
  renameGroup: (id: string, name: string) => void
  toggleCollapse: (id: string) => void
  reorderGroups: (newOrder: ServerGroup[]) => void
  setServerGroup: (serverId: string, groupId: string | undefined) => void
  setServerAlias: (serverId: string, alias: string) => void
  /** Drop alias + group assignment for a server that was deleted */
  removeServer: (serverId: string) => void
  toggleAgCollapse: (agName: string) => void
  toggleMachineCollapse: (machineName: string) => void
}

export const useGroupsStore = create<GroupsState>()(
  persist(
    (set) => ({
      groups: DEFAULT_GROUPS,
      serverGroups: {},
      serverAliases: {},
      expandedAGs: [],
      expandedMachines: [],

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

      removeServer: (serverId) =>
        set((state) => {
          const aliases = { ...state.serverAliases }
          const groups = { ...state.serverGroups }
          delete aliases[serverId]
          delete groups[serverId]
          return { serverAliases: aliases, serverGroups: groups }
        }),

      toggleAgCollapse: (agName) =>
        set((state) => {
          const isExpanded = state.expandedAGs.includes(agName)
          return {
            expandedAGs: isExpanded
              ? state.expandedAGs.filter((n) => n !== agName)
              : [...state.expandedAGs, agName]
          }
        }),

      toggleMachineCollapse: (machineName) =>
        set((state) => {
          const isExpanded = state.expandedMachines.includes(machineName)
          return {
            expandedMachines: isExpanded
              ? state.expandedMachines.filter((n) => n !== machineName)
              : [...state.expandedMachines, machineName]
          }
        })
    }),
    { name: 'sql-sentinel-groups' }
  )
)
