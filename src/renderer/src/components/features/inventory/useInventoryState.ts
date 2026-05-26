import { useState, useMemo, useCallback, useEffect } from 'react'
import { useServersStore } from '../../../store/serversStore'
import { useMetricsStore } from '../../../store/metricsStore'
import { useThrottledMetricsMap } from '../../../hooks/useThrottledMetrics'
import { useRefreshAllServers } from '../../../hooks/useRefreshAllServers'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { useGroupsStore } from '../../../store/groupsStore'
import { useAppStore } from '../../../store/appStore'
import { computeInventory, getSqlServerVersion } from '../../../utils/inventoryUtils'
import {
  buildInventoryCsvRows,
  buildDbViewCsvRows,
  DB_VIEW_CSV_HEADERS
} from '../../../utils/csvExportUtils'
import type { DbAssetCsvInput } from '../../../utils/csvExportUtils'
import { getAllDbCustomFields, exportInventoryCsv } from '../../../api/ipc'
import type { DbCustomFields } from '../../../../../preload/index'
import type { ServerHostingType } from '../../../constants/hosting'
import { buildRows, buildDbViewRows } from './inventoryRowBuilders'
import type { InventoryRow } from './inventoryTypes'

function loadStoredKeySet(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? new Set(parsed.filter((s) => typeof s === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function persistKeySet(key: string, value: Set<string>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(Array.from(value)))
  } catch {
    // quota / unavailable — non-fatal
  }
}

export type FilterType = 'all' | 'standalone' | 'ag-primary' | 'ag-secondary'
export type FilterState = 'all' | 'online' | 'offline'
export type FilterHost = 'all' | 'on-premise' | 'cloud'
export type FilterDbRecovery = 'all' | 'FULL' | 'SIMPLE' | 'BULK_LOGGED'
export type FilterDbTde = 'all' | 'encrypted' | 'not-encrypted'

export interface FilteredStats {
  servers: number
  standalone: number
  agClusters: number
  agServers: number
  databases: number
  onlineDbs: number
  offlineDbs: number
}

export interface DbViewStats {
  total: number
  online: number
  offline: number
  fullRecovery: number
  tdeActive: number
  noBackup: number
  oldCompat: number
}

export function useInventoryState(onNavigateToDashboard: () => void) {
  const { refreshing, lastRefresh, handleRefresh } = useRefreshAllServers()

  // ── Server View filters ──────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [filterEnv, setFilterEnv] = useState('all')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterState, setFilterState] = useState<FilterState>('all')
  const [filterHost, setFilterHost] = useState<FilterHost>('all')
  const [filterAlias, setFilterAlias] = useState('all')
  const [filterReferente, setFilterReferente] = useState('all')
  const [filterVersion, setFilterVersion] = useState('all')
  const [sortKey, setSortKey] = useState<keyof InventoryRow>('envName')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // Persist expansion state across tab navigation. sessionStorage is the right
  // scope: it survives clicks elsewhere but not an app restart, where the
  // user's mental model probably resets too.
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(
    () => loadStoredKeySet('sqlsentinel:inventory:expandedClusters')
  )
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(
    () => loadStoredKeySet('sqlsentinel:inventory:expandedMachines')
  )
  useEffect(() => {
    persistKeySet('sqlsentinel:inventory:expandedClusters', expandedClusters)
  }, [expandedClusters])
  useEffect(() => {
    persistKeySet('sqlsentinel:inventory:expandedMachines', expandedMachines)
  }, [expandedMachines])

  // ── DB View state ────────────────────────────────────────────────────────
  const [dbView, setDbView] = useState<boolean>(
    () => sessionStorage.getItem('sqlsentinel:inventory:dbView') === 'true'
  )
  useEffect(() => {
    sessionStorage.setItem('sqlsentinel:inventory:dbView', String(dbView))
  }, [dbView])
  const [expandedDbServers, setExpandedDbServers] = useState<Set<string>>(
    () => loadStoredKeySet('sqlsentinel:inventory:expandedDbServers')
  )
  useEffect(() => {
    persistKeySet('sqlsentinel:inventory:expandedDbServers', expandedDbServers)
  }, [expandedDbServers])
  const [dbSearch, setDbSearch] = useState('')
  const [filterDbRecovery, setFilterDbRecovery] = useState<FilterDbRecovery>('all')
  const [filterDbTde, setFilterDbTde] = useState<FilterDbTde>('all')
  const [filterDbCompat, setFilterDbCompat] = useState('all')
  const [filterDbOffline, setFilterDbOffline] = useState(false)
  const [filterDbNoBackup, setFilterDbNoBackup] = useState(false)

  const [filterDbName, setFilterDbName] = useState('')

  // Debounce search to avoid recomputing filteredRows on every keystroke
  const debouncedSearch = useDebouncedValue(search, 300)
  const debouncedFilterDbName = useDebouncedValue(filterDbName, 300)

  // Store subscriptions
  const servers = useServersStore((s) => s.servers)
  const envGroups = useGroupsStore((s) => s.groups)
  const serverAliases = useGroupsStore((s) => s.serverAliases)

  // Throttled metrics snapshot — max 1 re-render/s to handle 200+ servers
  const metricsMap = useThrottledMetricsMap()

  const inventory = useMemo(() => computeInventory(), [servers, envGroups, serverAliases, metricsMap])
  const { totals } = inventory

  // ── Cluster / machine key collections ───────────────────────────────────
  const allClusterKeys = useMemo(
    () =>
      inventory.groups.flatMap((g) =>
        g.agClusters.map((ag) => `${g.groupId ?? '__ungrouped__'}__${ag.agName}`)
      ),
    [inventory.groups]
  )

  const allMachineKeys = useMemo(() => {
    const keys: string[] = []
    for (const g of inventory.groups) {
      const envId = g.groupId ?? '__ungrouped__'
      const machineMap = new Map<string, number>()
      for (const srv of g.standaloneServers) {
        const key = srv.machineName ?? srv.ip
        machineMap.set(key, (machineMap.get(key) ?? 0) + 1)
      }
      for (const [machineName, count] of machineMap) {
        if (count >= 2) keys.push(`${envId}__machine__${machineName}`)
      }
    }
    return keys
  }, [inventory.groups])

  // ── Dropdown options ─────────────────────────────────────────────────────
  const aliasOptions = useMemo(
    () => [...new Set(Object.values(serverAliases).filter(Boolean))].sort(),
    [serverAliases]
  )

  const referenteOptions = useMemo(() => {
    const refs: string[] = []
    for (const m of Object.values(metricsMap)) {
      for (const db of m.databases ?? []) {
        if (db.referente) refs.push(db.referente)
      }
    }
    return [...new Set(refs)].sort()
  }, [metricsMap])

  const versionOptions = useMemo(() => {
    const versions = new Set<string>()
    for (const g of inventory.groups) {
      for (const ag of g.agClusters) {
        for (const r of ag.replicas) {
          const v = getSqlServerVersion(r.version)
          if (v) versions.add(v)
        }
      }
      for (const srv of g.standaloneServers) {
        const v = getSqlServerVersion(srv.version)
        if (v) versions.add(v)
      }
    }
    return [...versions].sort()
  }, [inventory.groups])

  // ── DB View memos ────────────────────────────────────────────────────────
  const allServerKeys = useMemo(() => {
    const keys: string[] = []
    for (const g of inventory.groups) {
      for (const srv of g.standaloneServers) keys.push(`${srv.ip}:${srv.port}`)
      for (const ag of g.agClusters) for (const r of ag.replicas) keys.push(`${r.ip}:${r.port}`)
    }
    return keys
  }, [inventory.groups])

  const allDbViewRowsExpanded = useMemo(
    () => buildDbViewRows(inventory, metricsMap, new Set(allServerKeys)),
    [inventory, metricsMap, allServerKeys]
  )

  const allDbRows = useMemo(
    () =>
      allDbViewRowsExpanded.filter((r): r is typeof r & { type: 'db-row' } => r.type === 'db-row'),
    [allDbViewRowsExpanded]
  )

  const compatLevelOptions = useMemo(() => {
    const levels = new Set<number>()
    for (const r of allDbRows) if (r.compatibilityLevel) levels.add(r.compatibilityLevel)
    return [...levels].sort((a, b) => b - a)
  }, [allDbRows])

  const hasActiveDbFilters =
    dbSearch !== '' ||
    filterDbRecovery !== 'all' ||
    filterDbTde !== 'all' ||
    filterDbCompat !== 'all' ||
    filterDbOffline ||
    filterDbNoBackup

  const filteredDbRows = useMemo(() => {
    if (!hasActiveDbFilters) return allDbRows
    const q = dbSearch.toLowerCase()
    const now = Date.now()
    return allDbRows.filter((r) => {
      if (q && !r.dbName?.toLowerCase().includes(q) && !r.serverLabel.toLowerCase().includes(q))
        return false
      if (filterDbRecovery !== 'all' && r.recoveryModel !== filterDbRecovery) return false
      if (filterDbTde === 'encrypted' && !r.isEncrypted) return false
      if (filterDbTde === 'not-encrypted' && r.isEncrypted) return false
      if (filterDbCompat !== 'all' && String(r.compatibilityLevel) !== filterDbCompat) return false
      if (filterDbOffline && r.stateDesc === 'ONLINE') return false
      if (filterDbNoBackup) {
        const noBackup =
          !r.lastFullBackup || now - new Date(r.lastFullBackup).getTime() > 86_400_000
        if (!noBackup) return false
      }
      return true
    })
  }, [
    allDbRows,
    dbSearch,
    filterDbRecovery,
    filterDbTde,
    filterDbCompat,
    filterDbOffline,
    filterDbNoBackup,
    hasActiveDbFilters
  ])

  const serversWithMatchingDbs = useMemo(() => {
    const set = new Set<string>()
    filteredDbRows.forEach((r) => set.add(r.serverKey))
    return set
  }, [filteredDbRows])

  const displayDbViewRows = useMemo(() => {
    const matchingIds = new Set(filteredDbRows.map((r) => r.id))
    const rows: typeof allDbViewRowsExpanded = []
    for (const row of allDbViewRowsExpanded) {
      if (row.type === 'server-header') {
        if (hasActiveDbFilters && !serversWithMatchingDbs.has(row.serverKey)) continue
        rows.push(row)
      } else if (row.type === 'db-row' && expandedDbServers.has(row.serverKey)) {
        if (!hasActiveDbFilters || matchingIds.has(row.id)) rows.push(row)
      }
    }
    return rows
  }, [
    allDbViewRowsExpanded,
    filteredDbRows,
    serversWithMatchingDbs,
    expandedDbServers,
    hasActiveDbFilters
  ])

  const dbViewStats = useMemo(() => {
    const rows = filteredDbRows
    const now = Date.now()
    return {
      total: rows.length,
      online: rows.filter((r) => r.stateDesc === 'ONLINE').length,
      offline: rows.filter((r) => r.stateDesc !== 'ONLINE').length,
      fullRecovery: rows.filter((r) => r.recoveryModel === 'FULL').length,
      tdeActive: rows.filter((r) => r.isEncrypted).length,
      noBackup: rows.filter(
        (r) => !r.lastFullBackup || now - new Date(r.lastFullBackup).getTime() > 86_400_000
      ).length,
      oldCompat: rows.filter((r) => (r.compatibilityLevel ?? 999) < 130).length
    }
  }, [filteredDbRows])

  // ── Server View rows ─────────────────────────────────────────────────────
  const needsFullExpand = filterAlias !== 'all' || filterReferente !== 'all' || debouncedFilterDbName !== ''

  const effectiveExpanded = useMemo(() => {
    if (filterType === 'ag-primary' || filterType === 'ag-secondary' || needsFullExpand) {
      return new Set(allClusterKeys)
    }
    return expandedClusters
  }, [filterType, needsFullExpand, allClusterKeys, expandedClusters])

  const effectiveExpandedMachines = useMemo(() => {
    if (filterType === 'standalone' || needsFullExpand) return new Set(allMachineKeys)
    return expandedMachines
  }, [filterType, needsFullExpand, allMachineKeys, expandedMachines])

  const allRows = useMemo(
    () => buildRows(inventory.groups, effectiveExpanded, effectiveExpandedMachines),
    [inventory.groups, effectiveExpanded, effectiveExpandedMachines]
  )

  const filteredRows = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return allRows.filter((row) => {
      if (filterType !== 'all') {
        if (
          filterType === 'standalone' &&
          row.type !== 'standalone' &&
          row.type !== 'machine-header'
        )
          return false
        if (filterType === 'ag-primary' && !(row.type === 'ag-replica' && row.agRole === 'PRIMARY'))
          return false
        if (
          filterType === 'ag-secondary' &&
          !(row.type === 'ag-replica' && row.agRole === 'SECONDARY')
        )
          return false
      }
      if (q) {
        const lbl = row.serverLabel.toLowerCase()
        const h = row.host.toLowerCase()
        const ag = (row.agName ?? '').toLowerCase()
        if (!lbl.includes(q) && !h.includes(q) && !ag.includes(q)) return false
      }
      if (filterEnv !== 'all' && row.envId !== filterEnv) return false
      if (filterState === 'online' && row.unreachable) return false
      if (filterState === 'offline' && !row.unreachable) return false
      if (filterHost !== 'all' && row.hostingType !== (filterHost as ServerHostingType))
        return false
      if (filterAlias !== 'all') {
        if (row.type !== 'standalone' && row.type !== 'ag-replica') return false
        if (serverAliases[row.serverId ?? ''] !== filterAlias) return false
      }
      if (filterReferente !== 'all') {
        if (row.type !== 'standalone' && row.type !== 'ag-replica') return false
        const key = `${row.host}:${row.port}`
        const dbs = metricsMap[key]?.databases ?? []
        if (!dbs.some((db) => db.referente === filterReferente)) return false
      }
      if (debouncedFilterDbName !== '') {
        if (row.type !== 'standalone' && row.type !== 'ag-replica') return false
        const key = `${row.host}:${row.port}`
        const dbs = metricsMap[key]?.databases ?? []
        const q = debouncedFilterDbName.toLowerCase()
        if (!dbs.some((db) => db.name?.toLowerCase().includes(q))) return false
      }
      if (filterVersion !== 'all' && getSqlServerVersion(row.version) !== filterVersion)
        return false
      return true
    })
  }, [
    allRows,
    debouncedSearch,
    filterEnv,
    filterType,
    filterState,
    filterHost,
    filterAlias,
    filterReferente,
    filterVersion,
    debouncedFilterDbName,
    serverAliases,
    metricsMap
  ])

  const filteredStats = useMemo(() => {
    const standaloneRows = filteredRows.filter((r) => r.type === 'standalone' && r.depth === 0)
    const machineRows = filteredRows.filter((r) => r.type === 'machine-header')
    const clusterRows = filteredRows.filter((r) => r.type === 'ag-cluster')
    const replicaRows = filteredRows.filter((r) => r.type === 'ag-replica')

    const machineInstances = machineRows.reduce((s, r) => s + (r.instanceCount ?? 0), 0)

    const agServers =
      clusterRows.length > 0
        ? clusterRows.reduce((sum, r) => sum + (r.replicaCount ?? 1), 0)
        : replicaRows.length

    const servers = standaloneRows.length + machineInstances + agServers
    const standalone = standaloneRows.length + machineInstances
    const agClusters = clusterRows.length

    const dbSourceRows =
      clusterRows.length > 0 || standaloneRows.length > 0 || machineRows.length > 0
        ? [...standaloneRows, ...machineRows, ...clusterRows]
        : replicaRows

    const databases = dbSourceRows.reduce((sum, r) => sum + r.dbCount, 0)
    const onlineDbs = dbSourceRows.reduce((sum, r) => sum + r.onlineCount, 0)
    const offlineDbs = dbSourceRows.reduce((sum, r) => sum + r.offlineCount, 0)

    return { servers, standalone, agClusters, agServers, databases, onlineDbs, offlineDbs }
  }, [filteredRows])

  const hasActiveFilters =
    search !== '' ||
    filterDbName !== '' ||
    filterEnv !== 'all' ||
    filterType !== 'all' ||
    filterState !== 'all' ||
    filterHost !== 'all' ||
    filterAlias !== 'all' ||
    filterReferente !== 'all' ||
    filterVersion !== 'all'

  const sortedRows = useMemo(() => {
    const hasHierarchy =
      filteredRows.some((r) => r.depth === 1) &&
      filteredRows.some(
        (r) => r.depth === 0 && (r.type === 'ag-cluster' || r.type === 'machine-header')
      )

    const compareFn = (a: InventoryRow, b: InventoryRow): number => {
      const va = a[sortKey] ?? ''
      const vb = b[sortKey] ?? ''
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    }

    if (!hasHierarchy) return [...filteredRows].sort(compareFn)

    const topLevel: InventoryRow[] = []
    const childrenMap = new Map<string, InventoryRow[]>()

    for (const row of filteredRows) {
      if (row.depth === 0) {
        topLevel.push(row)
      } else if (row.clusterKey) {
        const arr = childrenMap.get(row.clusterKey) ?? []
        arr.push(row)
        childrenMap.set(row.clusterKey, arr)
      }
    }

    topLevel.sort(compareFn)

    const result: InventoryRow[] = []
    for (const row of topLevel) {
      result.push(row)
      if ((row.type === 'ag-cluster' || row.type === 'machine-header') && row.clusterKey) {
        result.push(...(childrenMap.get(row.clusterKey) ?? []))
      }
    }
    return result
  }, [filteredRows, sortKey, sortDir])

  // ── Handlers ────────────────────────────────────────────────────────────
  const toggleCluster = useCallback((clusterKey: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev)
      next.has(clusterKey) ? next.delete(clusterKey) : next.add(clusterKey)
      return next
    })
  }, [])

  const toggleMachine = useCallback((machineKey: string) => {
    setExpandedMachines((prev) => {
      const next = new Set(prev)
      next.has(machineKey) ? next.delete(machineKey) : next.add(machineKey)
      return next
    })
  }, [])

  const handleToggleAll = useCallback(() => {
    const totalExpandable = allClusterKeys.length + allMachineKeys.length
    const totalExpanded = expandedClusters.size + expandedMachines.size
    if (totalExpanded === totalExpandable) {
      setExpandedClusters(new Set())
      setExpandedMachines(new Set())
    } else {
      setExpandedClusters(new Set(allClusterKeys))
      setExpandedMachines(new Set(allMachineKeys))
    }
  }, [expandedClusters, expandedMachines, allClusterKeys, allMachineKeys])

  const handleRowClick = useCallback(
    (row: InventoryRow) => {
      if (row.type === 'ag-cluster') {
        toggleCluster(row.clusterKey!)
      } else if (row.type === 'machine-header') {
        toggleMachine(row.clusterKey!)
      } else if (row.serverId) {
        useAppStore.getState().setPendingServerId(row.serverId)
        onNavigateToDashboard()
      }
    },
    [toggleCluster, toggleMachine, onNavigateToDashboard]
  )

  const handleExportCsv = useCallback(async () => {
    if (dbView) {
      const exportRows = buildDbViewCsvRows(
        filteredDbRows.map(
          (r): DbAssetCsvInput => ({
            envName: r.envName,
            serverLabel: r.serverLabel,
            serverVersion: r.serverVersion,
            dbName: r.dbName ?? '',
            alias: r.alias,
            referente: r.referente,
            stateDesc: r.stateDesc,
            recoveryModel: r.recoveryModel,
            compatibilityLevel: r.compatibilityLevel,
            isEncrypted: r.isEncrypted,
            isReadOnly: r.isReadOnly,
            sizeMb: r.sizeMb,
            logSizeMb: r.logSizeMb,
            lastFullBackup: r.lastFullBackup,
            lastLogBackup: r.lastLogBackup,
            owner: r.owner,
            createDate: r.createDate
          })
        )
      )
      await exportInventoryCsv({ headers: DB_VIEW_CSV_HEADERS, rows: exportRows })
      return
    }

    const { serverAliases: aliases } = useGroupsStore.getState()
    const { metricsMap: mm } = useMetricsStore.getState()
    const cfResult = await getAllDbCustomFields()
    const dbCustomFields: Record<string, DbCustomFields> = cfResult.ok ? cfResult.data : {}

    let allowedServerIds: Set<string> | undefined
    if (hasActiveFilters) {
      const fullyExpanded = buildRows(
        inventory.groups,
        new Set(allClusterKeys),
        new Set(allMachineKeys)
      )
      // Use debounced values so the export and the visible rows stay aligned
      // (filteredRows uses debouncedSearch / debouncedFilterDbName).
      const q = debouncedSearch.toLowerCase()
      const dbq = debouncedFilterDbName.toLowerCase()
      const matched = fullyExpanded.filter((row) => {
        if (row.type !== 'standalone' && row.type !== 'ag-replica') return false
        if (filterType !== 'all') {
          if (filterType === 'standalone' && row.type !== 'standalone') return false
          if (
            filterType === 'ag-primary' &&
            !(row.type === 'ag-replica' && row.agRole === 'PRIMARY')
          )
            return false
          if (
            filterType === 'ag-secondary' &&
            !(row.type === 'ag-replica' && row.agRole === 'SECONDARY')
          )
            return false
        }
        if (
          q &&
          !row.serverLabel.toLowerCase().includes(q) &&
          !row.host.toLowerCase().includes(q) &&
          !(row.agName ?? '').toLowerCase().includes(q)
        )
          return false
        if (filterEnv !== 'all' && row.envId !== filterEnv) return false
        if (filterState === 'online' && row.unreachable) return false
        if (filterState === 'offline' && !row.unreachable) return false
        if (filterHost !== 'all' && row.hostingType !== (filterHost as ServerHostingType))
          return false
        if (filterAlias !== 'all' && aliases[row.serverId ?? ''] !== filterAlias) return false
        if (filterReferente !== 'all') {
          const dbs = mm[`${row.host}:${row.port}`]?.databases ?? []
          if (!dbs.some((db) => db.referente === filterReferente)) return false
        }
        if (dbq !== '') {
          const dbs = mm[`${row.host}:${row.port}`]?.databases ?? []
          if (!dbs.some((db) => db.name?.toLowerCase().includes(dbq))) return false
        }
        if (filterVersion !== 'all' && getSqlServerVersion(row.version) !== filterVersion)
          return false
        return true
      })
      allowedServerIds = new Set(matched.map((r) => r.serverId!))
    }

    const headers = [
      'Environment',
      'Type',
      'AG Name',
      'Server',
      'Alias',
      'Contact',
      'AG Role',
      'Database',
      'DB Status',
      'Data (MB)',
      'Log (MB)',
      'Last Full Backup',
      'Last Log Backup',
      'SQL Version',
      'Server Uptime (days)',
      'Server Status',
      'Infrastructure Type',
      'Logical CPUs',
      'Physical CPUs',
      'Notes'
    ]
    const exportRows = buildInventoryCsvRows(
      inventory,
      aliases,
      mm,
      dbCustomFields,
      allowedServerIds
    )
    await exportInventoryCsv({ headers, rows: exportRows })
  }, [
    dbView,
    filteredDbRows,
    inventory,
    hasActiveFilters,
    debouncedSearch,
    debouncedFilterDbName,
    filterEnv,
    filterType,
    filterState,
    filterHost,
    filterAlias,
    filterReferente,
    filterVersion,
    allClusterKeys,
    allMachineKeys
  ])

  const handleSort = useCallback(
    (key: keyof InventoryRow) => {
      if (key === sortKey) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir('asc')
      }
    },
    [sortKey]
  )

  const handleResetFilters = useCallback(() => {
    setSearch('')
    setFilterDbName('')
    setFilterEnv('all')
    setFilterType('all')
    setFilterState('all')
    setFilterHost('all')
    setFilterAlias('all')
    setFilterReferente('all')
    setFilterVersion('all')
  }, [])

  const toggleDbServer = useCallback((serverKey: string) => {
    setExpandedDbServers((prev) => {
      const next = new Set(prev)
      next.has(serverKey) ? next.delete(serverKey) : next.add(serverKey)
      return next
    })
  }, [])

  const handleResetDbFilters = useCallback(() => {
    setDbSearch('')
    setFilterDbRecovery('all')
    setFilterDbTde('all')
    setFilterDbCompat('all')
    setFilterDbOffline(false)
    setFilterDbNoBackup(false)
  }, [])

  const handleDbToggleAll = useCallback(() => {
    if (expandedDbServers.size === allServerKeys.length) {
      setExpandedDbServers(new Set())
    } else {
      setExpandedDbServers(new Set(allServerKeys))
    }
  }, [expandedDbServers.size, allServerKeys])

  return {
    // refresh
    refreshing,
    lastRefresh,
    handleRefresh,
    // view toggle
    dbView,
    setDbView,
    // inventory data
    inventory,
    totals,
    // server view filters
    search,
    setSearch,
    filterDbName,
    setFilterDbName,
    filterEnv,
    setFilterEnv,
    filterType,
    setFilterType,
    filterState,
    setFilterState,
    filterHost,
    setFilterHost,
    filterAlias,
    setFilterAlias,
    filterReferente,
    setFilterReferente,
    filterVersion,
    setFilterVersion,
    sortKey,
    sortDir,
    // expand/collapse
    expandedClusters,
    expandedMachines,
    allClusterKeys,
    allMachineKeys,
    // computed rows
    sortedRows,
    filteredStats,
    hasActiveFilters,
    // DB view filters
    dbSearch,
    setDbSearch,
    filterDbRecovery,
    setFilterDbRecovery,
    filterDbTde,
    setFilterDbTde,
    filterDbCompat,
    setFilterDbCompat,
    filterDbOffline,
    setFilterDbOffline,
    filterDbNoBackup,
    setFilterDbNoBackup,
    compatLevelOptions,
    hasActiveDbFilters,
    // DB view rows
    displayDbViewRows,
    filteredDbRows,
    allDbRows,
    allDbViewRowsExpanded,
    expandedDbServers,
    dbViewStats,
    // aliases (for display in server table)
    serverAliases,
    // dropdown options
    envGroups,
    aliasOptions,
    referenteOptions,
    versionOptions,
    // handlers
    handleRowClick,
    handleToggleAll,
    handleSort,
    handleResetFilters,
    handleExportCsv,
    toggleDbServer,
    handleResetDbFilters,
    handleDbToggleAll
  }
}
