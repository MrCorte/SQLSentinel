import { useState, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useGroupsStore } from '../../../store/groupsStore'
import { useAgStore } from '../../../store/agStore'
import type { StoredServer } from '../../../../../preload/index'
import type { SidebarItem } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function serverLabel(s: StoredServer): string {
  return `${s.ip ?? s.host}:${s.port}`
}

// ---------------------------------------------------------------------------
// useSidebarTree
// ---------------------------------------------------------------------------

export interface SidebarTreeResult {
  // Data
  flatItems: SidebarItem[]
  sortedGroups: ReturnType<typeof useGroupsStore.getState>['groups']
  serverAliases: Record<string, string>
  searchText: string

  // Context-menu state
  ctxMenu: { mouseX: number; mouseY: number; server: StoredServer } | null
  moveMenuOpen: boolean

  // Actions — tree
  setSearchText: (v: string) => void
  toggleCollapse: (groupId: string) => void
  toggleAgCollapse: (agName: string) => void
  toggleMachineCollapse: (machineName: string) => void

  // Actions — context menu
  handleContextMenu: (e: React.MouseEvent, server: StoredServer) => void
  handleAgContextMenu: (e: React.MouseEvent, agName: string) => void
  handleCloseCtx: () => void
  setMoveMenuOpen: (open: boolean) => void
  handleMoveToGroup: (groupId: string | undefined) => void

  // Actions — alias
  setServerAlias: (key: string, alias: string) => void
}

export function useSidebarTree(servers: StoredServer[]): SidebarTreeResult {
  const {
    groups,
    serverGroups,
    serverAliases,
    expandedAGs,
    expandedMachines,
    toggleCollapse,
    toggleAgCollapse,
    toggleMachineCollapse,
    setServerGroup,
    setServerAlias
  } = useGroupsStore(
    useShallow((s) => ({
      groups: s.groups,
      serverGroups: s.serverGroups,
      serverAliases: s.serverAliases,
      expandedAGs: s.expandedAGs,
      expandedMachines: s.expandedMachines,
      toggleCollapse: s.toggleCollapse,
      toggleAgCollapse: s.toggleAgCollapse,
      toggleMachineCollapse: s.toggleMachineCollapse,
      setServerGroup: s.setServerGroup,
      setServerAlias: s.setServerAlias
    }))
  )
  const agGroups = useAgStore((s) => s.agGroups)

  const [searchText, setSearchText] = useState('')

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{
    mouseX: number
    mouseY: number
    server: StoredServer
  } | null>(null)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.order - b.order), [groups])

  // Search: filter + priority sort (startsWith before includes)
  const filteredServers = useMemo(
    () =>
      searchText
        ? servers
            .filter((s) => {
              const label = serverAliases[s.id] || serverLabel(s)
              return label.toLowerCase().includes(searchText.toLowerCase())
            })
            .sort((a, b) => {
              const la = (serverAliases[a.id] || serverLabel(a)).toLowerCase()
              const lb = (serverAliases[b.id] || serverLabel(b)).toLowerCase()
              const q = searchText.toLowerCase()
              const aStarts = la.startsWith(q)
              const bStarts = lb.startsWith(q)
              if (aStarts && !bStarts) return -1
              if (!aStarts && bStarts) return 1
              return 0
            })
        : [],
    [servers, searchText, serverAliases]
  )

  // Group assignment map
  const { serversByGroupId, ungrouped } = useMemo(() => {
    const byGroup = new Map<string, StoredServer[]>()
    for (const s of servers) {
      const gid = serverGroups[serverLabel(s)]
      if (gid) {
        if (!byGroup.has(gid)) byGroup.set(gid, [])
        byGroup.get(gid)!.push(s)
      }
    }
    return {
      serversByGroupId: byGroup,
      ungrouped: servers.filter((s) => !serverGroups[serverLabel(s)])
    }
  }, [servers, serverGroups])

  // ---------------------------------------------------------------------------
  // Flat item list for virtualization
  // ---------------------------------------------------------------------------

  const flatItems = useMemo((): SidebarItem[] => {
    if (searchText) {
      if (filteredServers.length === 0) return [{ kind: 'no-results' }]
      return filteredServers.map((s) => ({ kind: 'search-server', server: s }))
    }

    const items: SidebarItem[] = []
    for (const group of sortedGroups) {
      const groupServers = serversByGroupId.get(group.id) ?? []
      const onlineCount = groupServers.filter((s) => !s.unreachable).length

      items.push({ kind: 'group', group, onlineCount })

      if (!group.collapsed) {
        // A server is considered an AG member if agName is set (case-insensitive, trimmed).
        // This is more robust than agGroupId alone: the worker propagates agName to
        // SECONDARY replicas even before agGroupId is confirmed via self-detection.
        const isAgMember = (s: StoredServer): boolean => {
          const k = s.agName?.trim().toLowerCase()
          return k != null && k !== ''
        }

        // An AG is "active" in this group if any server in this group belongs to it.
        const agGroupsInThisGroup = Object.values(agGroups).filter((ag) => {
          const agKey = ag.ag_name.trim().toLowerCase()
          return groupServers.some((s) => s.agName?.trim().toLowerCase() === agKey)
        })

        const agServersInGroup = groupServers.filter(isAgMember)
        const standaloneServers = groupServers.filter((s) => !isAgMember(s))

        for (const ag of agGroupsInThisGroup) {
          const agKey = ag.ag_name.trim().toLowerCase()
          const isExpanded = expandedAGs.includes(ag.ag_name)
          items.push({ kind: 'ag', agName: ag.ag_name, agInfo: ag, isExpanded })
          if (isExpanded) {
            const agServers = agServersInGroup.filter(
              (s) => s.agName?.trim().toLowerCase() === agKey
            )
            for (const s of agServers) {
              items.push({ kind: 'server', server: s, inAgGroup: true, inMachineGroup: false })
            }
          }
        }

        // Group standalone servers by machineName (fallback: host)
        const machineMap = new Map<string, StoredServer[]>()
        for (const s of standaloneServers) {
          const key = s.machineName ?? s.ip ?? s.host
          if (!machineMap.has(key)) machineMap.set(key, [])
          machineMap.get(key)!.push(s)
        }
        for (const [machineName, machineServers] of machineMap) {
          if (machineServers.length >= 2) {
            const isExpanded = expandedMachines.includes(machineName)
            items.push({
              kind: 'machine',
              machineName,
              instanceCount: machineServers.length,
              isExpanded
            })
            if (isExpanded) {
              for (const s of machineServers) {
                items.push({ kind: 'server', server: s, inAgGroup: false, inMachineGroup: true })
              }
            }
          } else {
            for (const s of machineServers) {
              items.push({ kind: 'server', server: s, inAgGroup: false, inMachineGroup: false })
            }
          }
        }
      }
    }

    if (ungrouped.length > 0) {
      items.push({ kind: 'ungrouped-header' })
      const ungroupedMachineMap = new Map<string, StoredServer[]>()
      for (const s of ungrouped) {
        const key = s.machineName ?? s.ip ?? s.host
        if (!ungroupedMachineMap.has(key)) ungroupedMachineMap.set(key, [])
        ungroupedMachineMap.get(key)!.push(s)
      }
      for (const [machineName, machineServers] of ungroupedMachineMap) {
        if (machineServers.length >= 2) {
          const isExpanded = expandedMachines.includes(machineName)
          items.push({
            kind: 'machine',
            machineName,
            instanceCount: machineServers.length,
            isExpanded
          })
          if (isExpanded) {
            for (const s of machineServers) {
              items.push({ kind: 'server', server: s, inAgGroup: false, inMachineGroup: true })
            }
          }
        } else {
          for (const s of machineServers) {
            items.push({ kind: 'server', server: s, inAgGroup: false, inMachineGroup: false })
          }
        }
      }
    }

    return items
  }, [
    searchText,
    filteredServers,
    sortedGroups,
    serversByGroupId,
    agGroups,
    ungrouped,
    expandedAGs,
    expandedMachines
  ])

  // ---------------------------------------------------------------------------
  // Context-menu callbacks
  // ---------------------------------------------------------------------------

  const handleContextMenu = useCallback((e: React.MouseEvent, server: StoredServer): void => {
    setCtxMenu({ mouseX: e.clientX, mouseY: e.clientY, server })
    setMoveMenuOpen(false)
  }, [])

  const handleAgContextMenu = useCallback(
    (e: React.MouseEvent, agName: string): void => {
      const representative = servers.find(
        (s) => s.agName?.trim().toLowerCase() === agName.trim().toLowerCase()
      )
      if (!representative) return
      setCtxMenu({ mouseX: e.clientX, mouseY: e.clientY, server: representative })
      setMoveMenuOpen(false)
    },
    [servers]
  )

  const handleCloseCtx = useCallback((): void => {
    setCtxMenu(null)
    setMoveMenuOpen(false)
  }, [])

  const handleMoveToGroup = useCallback(
    (groupId: string | undefined): void => {
      if (!ctxMenu) return
      const agName = ctxMenu.server.agName?.trim().toLowerCase()
      if (agName) {
        // Move every server in the same AG cluster together
        const clusterMembers = servers.filter((s) => s.agName?.trim().toLowerCase() === agName)
        for (const s of clusterMembers) {
          setServerGroup(serverLabel(s), groupId)
        }
      } else {
        setServerGroup(serverLabel(ctxMenu.server), groupId)
      }
      setCtxMenu(null)
      setMoveMenuOpen(false)
    },
    [ctxMenu, servers, setServerGroup]
  )

  return {
    flatItems,
    sortedGroups,
    serverAliases,
    searchText,
    ctxMenu,
    moveMenuOpen,
    setSearchText,
    toggleCollapse,
    toggleAgCollapse,
    toggleMachineCollapse,
    handleContextMenu,
    handleAgContextMenu,
    handleCloseCtx,
    setMoveMenuOpen,
    handleMoveToGroup,
    setServerAlias
  }
}
