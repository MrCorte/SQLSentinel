import { useState, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useGroupsStore } from '../../../store/groupsStore'
import { useAgStore } from '../../../store/agStore'
import type { AgGroupState } from '../../../store/agStore'
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

    // Costruisce gli item (cluster AG + macchine + server) per un sottoinsieme
    // di server. Usato sia per i gruppi che per UNGROUPED: prima questa logica
    // viveva solo nel loop dei gruppi, quindi i membri AG finiti in UNGROUPED
    // (es. una replica aggiunta senza assegnare un gruppo) non formavano mai un
    // cluster — apparivano come server sciolti.
    const buildSubtree = (subset: StoredServer[]): SidebarItem[] => {
      const out: SidebarItem[] = []

      // Membro AG = agName valorizzato (più robusto di agGroupId: il worker
      // propaga agName ai SECONDARY prima che la self-detection confermi il group_id).
      const isAgMember = (s: StoredServer): boolean => {
        const k = s.agName?.trim().toLowerCase()
        return k != null && k !== ''
      }

      // I cluster AG si derivano dagli agName PERSISTITI, non da agStore.agGroups
      // (stato runtime, vuoto al boot finché un detect non gira): altrimenti dopo
      // un riavvio i membri AG sparivano dalla sidebar. agGroups, quando presente,
      // arricchisce l'entry con health/primary aggiornati; altrimenti fallback.
      const agNames = new Map<string, string>() // key → display name originale
      for (const s of subset) {
        const name = s.agName?.trim()
        if (name) agNames.set(name.toLowerCase(), name)
      }
      const agClusters = [...agNames.entries()].map(([agKey, displayName]) => {
        const live = Object.values(agGroups).find((ag) => ag.ag_name.trim().toLowerCase() === agKey)
        if (live) return live
        const members = subset.filter((s) => s.agName?.trim().toLowerCase() === agKey)
        const primary = members.find((s) => s.agRole === 'PRIMARY')
        const synthetic: AgGroupState = {
          id: primary?.agGroupId ?? members[0]?.agGroupId ?? agKey,
          ag_name: displayName,
          health: 'PARTIALLY_HEALTHY',
          primary_replica: primary?.machineName ?? primary?.host ?? '',
          serverIds: members.map((s) => s.id)
        }
        return synthetic
      })

      const agServers = subset.filter(isAgMember)
      const standaloneServers = subset.filter((s) => !isAgMember(s))

      for (const ag of agClusters) {
        const agKey = ag.ag_name.trim().toLowerCase()
        const isExpanded = expandedAGs.includes(ag.ag_name)
        out.push({ kind: 'ag', agName: ag.ag_name, agInfo: ag, isExpanded })
        if (isExpanded) {
          for (const s of agServers.filter((s) => s.agName?.trim().toLowerCase() === agKey)) {
            out.push({ kind: 'server', server: s, inAgGroup: true, inMachineGroup: false })
          }
        }
      }

      // Standalone raggruppati per machineName (fallback: host)
      const machineMap = new Map<string, StoredServer[]>()
      for (const s of standaloneServers) {
        const key = s.machineName ?? s.ip ?? s.host
        if (!machineMap.has(key)) machineMap.set(key, [])
        machineMap.get(key)!.push(s)
      }
      for (const [machineName, machineServers] of machineMap) {
        if (machineServers.length >= 2) {
          const isExpanded = expandedMachines.includes(machineName)
          out.push({ kind: 'machine', machineName, instanceCount: machineServers.length, isExpanded })
          if (isExpanded) {
            for (const s of machineServers) {
              out.push({ kind: 'server', server: s, inAgGroup: false, inMachineGroup: true })
            }
          }
        } else {
          for (const s of machineServers) {
            out.push({ kind: 'server', server: s, inAgGroup: false, inMachineGroup: false })
          }
        }
      }
      return out
    }

    const items: SidebarItem[] = []
    for (const group of sortedGroups) {
      const groupServers = serversByGroupId.get(group.id) ?? []
      const onlineCount = groupServers.filter((s) => !s.unreachable).length

      items.push({ kind: 'group', group, onlineCount })

      if (!group.collapsed) {
        items.push(...buildSubtree(groupServers))
      }
    }

    if (ungrouped.length > 0) {
      items.push({ kind: 'ungrouped-header' })
      // Stesso trattamento dei gruppi: i membri AG ungrouped formano un cluster.
      items.push(...buildSubtree(ungrouped))
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
