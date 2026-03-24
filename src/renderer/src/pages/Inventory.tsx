import { useState, useMemo, useRef, useCallback } from 'react'
import { alpha } from '@mui/material/styles'
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Tooltip,
  Chip,
  TextField,
  Select,
  MenuItem,
  Paper,
  InputAdornment
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import DownloadIcon from '@mui/icons-material/Download'
import SearchIcon from '@mui/icons-material/Search'
import FilterListIcon from '@mui/icons-material/FilterList'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useServersStore } from '../store/serversStore'
import { useMetricsStore } from '../store/metricsStore'
import { useRefreshAllServers } from '../hooks/useRefreshAllServers'
import { useGroupsStore } from '../store/groupsStore'
import { useAppStore } from '../store/appStore'
import { computeInventory, getSqlServerVersion } from '../utils/inventoryUtils'
import { buildInventoryCsvRows } from '../utils/csvExportUtils'
import type { GroupInventory } from '../types/index'
import type { DbCustomFields } from '../../../preload/index'
import type { ServerHostingType } from '../constants/hosting'
import { HOSTING_BADGE } from '../constants/hosting'
import { tokens } from '../styles/tokens'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string
  value: string
  accentColor: string
}

function KpiCard({ label, value, accentColor }: KpiCardProps): React.JSX.Element {
  return (
    <Box
      sx={{
        flex: '1 1 0',
        minWidth: 100,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderTop: `3px solid ${accentColor}`,
        borderRadius: '4px',
        px: 2,
        py: 1.5
      }}
    >
      <Typography
        sx={{ fontSize: 10, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.5px', mb: 0.5 }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'text.primary', lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type InventoryRowType = 'standalone' | 'ag-cluster' | 'ag-replica' | 'machine-header'

interface InventoryRow {
  id:            string
  type:          InventoryRowType
  depth:         number
  serverLabel:   string
  host:          string
  port:          number
  envId:         string
  envName:       string
  envColor:      string
  hostingType:   ServerHostingType
  version:       string
  unreachable:   boolean
  dbCount:       number
  onlineCount:   number
  offlineCount:  number
  totalDataMb:   number
  totalLogMb:    number
  machineName?:  string
  instanceName?: string
  // ag-cluster + machine-header
  agName?:       string
  agHealthy?:    boolean
  replicaCount?: number
  instanceCount?: number
  clusterKey?:   string
  // standalone + ag-replica
  serverId?:     string
  agRole?:       'PRIMARY' | 'SECONDARY'
  uptimeDays?:   number
  logicalCpus?:  number
  physicalCpus?: number
  notes?:        string
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface ColDef {
  key: keyof InventoryRow
  label: string
  width: string
}

const COLUMNS: ColDef[] = [
  { key: 'serverLabel',  label: 'SERVER',   width: '17%' },
  { key: 'envName',      label: 'AMBIENTE', width: '8%'  },
  { key: 'type',         label: 'TIPO',     width: '8%'  },
  { key: 'machineName',  label: 'MACCHINA', width: '8%'  },
  { key: 'hostingType',  label: 'HOSTING',  width: '6%'  },
  { key: 'dbCount',      label: 'DB',       width: '4%'  },
  { key: 'onlineCount',  label: 'ONLINE',   width: '5%'  },
  { key: 'offlineCount', label: 'OFFLINE',  width: '5%'  },
  { key: 'totalDataMb',  label: 'DATI',     width: '7%'  },
  { key: 'version',      label: 'VERSIONE', width: '9%'  },
  { key: 'logicalCpus',  label: 'CPU',      width: '5%'  },
  { key: 'unreachable',  label: 'STATO',    width: '6%'  },
  { key: 'notes',        label: 'NOTE',     width: '12%' },
]

const GRID_TEMPLATE = COLUMNS.map((c) => c.width).join(' ')

// ---------------------------------------------------------------------------
// Row flattener
// ---------------------------------------------------------------------------

function buildRows(invGroups: GroupInventory[], expandedClusters: Set<string>, expandedMachines: Set<string>): InventoryRow[] {
  const rows: InventoryRow[] = []

  for (const group of invGroups) {
    const envId    = group.groupId ?? '__ungrouped__'
    const envName  = group.groupName
    const envColor = group.groupColor

    // ── Standalone — group by machineName if 2+ instances on same machine ──
    const machineMap = new Map<string, typeof group.standaloneServers>()
    for (const srv of group.standaloneServers) {
      const key = srv.machineName ?? srv.ip
      if (!machineMap.has(key)) machineMap.set(key, [])
      machineMap.get(key)!.push(srv)
    }
    for (const [machineName, instances] of machineMap) {
      if (instances.length >= 2) {
        const machineKey = `${envId}__machine__${machineName}`
        const isExpanded = expandedMachines.has(machineKey)
        // Machine header row: aggregate stats from all instances
        rows.push({
          id:            machineKey,
          type:          'machine-header',
          depth:         0,
          serverLabel:   machineName,
          host:          machineName,
          port:          1433,
          envId, envName, envColor,
          hostingType:   (instances[0]?.hostingType ?? 'on-premise') as ServerHostingType,
          version:       instances[0]?.version ?? '—',
          unreachable:   instances.every((s) => s.unreachable),
          dbCount:       instances.reduce((s, x) => s + x.dbCount, 0),
          onlineCount:   instances.reduce((s, x) => s + x.onlineCount, 0),
          offlineCount:  instances.reduce((s, x) => s + x.offlineCount, 0),
          totalDataMb:   instances.reduce((s, x) => s + x.totalDataMb, 0),
          totalLogMb:    instances.reduce((s, x) => s + x.totalLogMb, 0),
          machineName,
          instanceCount: instances.length,
          clusterKey:    machineKey,
          logicalCpus:   instances.reduce((s, x) => s + (x.logicalCpus ?? 0), 0) || undefined,
          physicalCpus:  instances.reduce((s, x) => s + (x.physicalCpus ?? 0), 0) || undefined,
        })
        // Instance rows (depth=1) — only when expanded
        if (isExpanded) {
          for (const srv of instances) {
            const instanceLabel = srv.instanceName ? `\\${srv.instanceName}` : '(default)'
            rows.push({
              id:            `${machineKey}__${srv.serverId}`,
              type:          'standalone',
              depth:         1,
              serverLabel:   instanceLabel,
              host:          srv.ip,
              port:          srv.port,
              envId, envName, envColor,
              hostingType:   (srv.hostingType ?? 'on-premise') as ServerHostingType,
              version:       srv.version,
              unreachable:   srv.unreachable,
              dbCount:       srv.dbCount,
              onlineCount:   srv.onlineCount,
              offlineCount:  srv.offlineCount,
              totalDataMb:   srv.totalDataMb,
              totalLogMb:    srv.totalLogMb,
              machineName,
              instanceName:  srv.instanceName,
              serverId:      srv.serverId,
              uptimeDays:    srv.uptimeDays,
              clusterKey:    machineKey,
              logicalCpus:   srv.logicalCpus,
              physicalCpus:  srv.physicalCpus,
              notes:         srv.notes,
            })
          }
        }
      } else {
        // Single instance on this machine — render normally
        const srv = instances[0]
        rows.push({
          id:           srv.serverId,
          type:         'standalone',
          depth:        0,
          serverLabel:  srv.displayName,
          host:         srv.ip,
          port:         srv.port,
          envId, envName, envColor,
          hostingType:  (srv.hostingType ?? 'on-premise') as ServerHostingType,
          version:      srv.version,
          unreachable:  srv.unreachable,
          dbCount:      srv.dbCount,
          onlineCount:  srv.onlineCount,
          offlineCount: srv.offlineCount,
          totalDataMb:  srv.totalDataMb,
          totalLogMb:   srv.totalLogMb,
          machineName,
          instanceName: srv.instanceName,
          serverId:     srv.serverId,
          uptimeDays:   srv.uptimeDays,
          logicalCpus:  srv.logicalCpus,
          physicalCpus: srv.physicalCpus,
          notes:        srv.notes,
        })
      }
    }

    // ── AG clusters ─────────────────────────────────────────────────────
    for (const ag of group.agClusters) {
      const clusterKey = `${envId}__${ag.agName}`
      const primary    = ag.replicas.find((r) => r.agRole === 'PRIMARY')
      const isExpanded = expandedClusters.has(clusterKey)

      // Cluster header row
      rows.push({
        id:           clusterKey,
        type:         'ag-cluster',
        depth:        0,
        serverLabel:  ag.agName,
        host:         primary?.ip ?? '',
        port:         primary?.port ?? 1433,
        envId, envName, envColor,
        hostingType:  (primary?.hostingType ?? 'on-premise') as ServerHostingType,
        version:      primary?.version ?? '',
        unreachable:  ag.replicas.every((r) => r.unreachable),
        agName:       ag.agName,
        agHealthy:    ag.health === 'HEALTHY',
        replicaCount: ag.replicas.length,
        clusterKey,
        dbCount:      primary?.dbCount      ?? ag.dbCount,
        onlineCount:  primary?.onlineCount  ?? ag.onlineCount,
        offlineCount: primary?.offlineCount ?? ag.offlineCount,
        totalDataMb:  primary?.totalDataMb  ?? ag.totalDataMb,
        totalLogMb:   primary?.totalLogMb   ?? ag.totalLogMb,
        logicalCpus:  primary?.logicalCpus,
        physicalCpus: primary?.physicalCpus,
      })

      // Replica child rows — only when expanded
      if (isExpanded) {
        for (const srv of ag.replicas) {
          rows.push({
            id:           `${clusterKey}__${srv.serverId}`,
            type:         'ag-replica',
            depth:        1,
            serverLabel:  srv.displayName,
            host:         srv.ip,
            port:         srv.port,
            envId, envName, envColor,
            hostingType:  (srv.hostingType ?? 'on-premise') as ServerHostingType,
            version:      srv.version,
            unreachable:  srv.unreachable,
            dbCount:      srv.dbCount,
            onlineCount:  srv.onlineCount,
            offlineCount: srv.offlineCount,
            totalDataMb:  srv.agRole === 'PRIMARY' ? srv.totalDataMb : 0,
            totalLogMb:   srv.agRole === 'PRIMARY' ? srv.totalLogMb  : 0,
            serverId:     srv.serverId,
            agRole:       (srv.agRole === 'PRIMARY' || srv.agRole === 'SECONDARY')
                            ? srv.agRole
                            : 'SECONDARY',
            uptimeDays:   srv.uptimeDays,
            clusterKey,
            logicalCpus:  srv.logicalCpus,
            physicalCpus: srv.physicalCpus,
            notes:        srv.notes,
          })
        }
      }
    }
  }

  return rows
}

// ---------------------------------------------------------------------------
// Inventory (main export)
// ---------------------------------------------------------------------------

interface InventoryProps {
  onNavigateToDashboard: () => void
}

export function Inventory({ onNavigateToDashboard }: InventoryProps): React.JSX.Element {
  const { refreshing, lastRefresh, handleRefresh } = useRefreshAllServers()
  const [search,            setSearch]             = useState('')
  const [filterEnv,         setFilterEnv]          = useState('all')
  const [filterType,        setFilterType]         = useState<'all' | 'standalone' | 'ag-primary' | 'ag-secondary'>('all')
  const [filterState,       setFilterState]        = useState<'all' | 'online' | 'offline'>('all')
  const [filterHost,        setFilterHost]         = useState<'all' | 'on-premise' | 'cloud'>('all')
  const [filterAlias,       setFilterAlias]        = useState('all')
  const [filterReferente,   setFilterReferente]    = useState('all')
  const [filterVersion,     setFilterVersion]      = useState('all')
  const [sortKey,           setSortKey]            = useState<keyof InventoryRow>('envName')
  const [sortDir,           setSortDir]            = useState<'asc' | 'desc'>('asc')
  const [expandedClusters,  setExpandedClusters]   = useState<Set<string>>(new Set())
  const [expandedMachines,  setExpandedMachines]   = useState<Set<string>>(new Set())
  const parentRef = useRef<HTMLDivElement>(null)

  // Store subscriptions
  useServersStore((s) => s.servers)
  const metricsMap    = useMetricsStore((s) => s.metricsMap)
  const envGroups     = useGroupsStore((s) => s.groups)
  const serverAliases = useGroupsStore((s) => s.serverAliases)

  const inventory = computeInventory()
  const { totals } = inventory

  // ── All cluster keys (for Expand all / Collapse all) ────────────────────
  const allClusterKeys = useMemo(
    () => inventory.groups.flatMap((g) =>
      g.agClusters.map((ag) => `${g.groupId ?? '__ungrouped__'}__${ag.agName}`)
    ),
    [inventory.groups]
  )

  const allMachineKeys = useMemo(
    () => {
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
    },
    [inventory.groups]
  )

  // ── Alias / Referente dropdown options (from full unfiltered data) ──────
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

  // ── Rows ────────────────────────────────────────────────────────────────
  // When filtering by AG role / alias / referente, all clusters and machines
  // must be expanded so leaf rows are present in allRows.
  const needsFullExpand = filterAlias !== 'all' || filterReferente !== 'all'

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
    const q = search.toLowerCase()
    return allRows.filter((row) => {
      // Type filter
      if (filterType !== 'all') {
        if (filterType === 'standalone' && row.type !== 'standalone' && row.type !== 'machine-header') return false
        if (filterType === 'ag-primary'   && !(row.type === 'ag-replica' && row.agRole === 'PRIMARY'))   return false
        if (filterType === 'ag-secondary' && !(row.type === 'ag-replica' && row.agRole === 'SECONDARY')) return false
      }
      // Search
      if (q) {
        const lbl = row.serverLabel.toLowerCase()
        const h   = row.host.toLowerCase()
        const ag  = (row.agName ?? '').toLowerCase()
        if (!lbl.includes(q) && !h.includes(q) && !ag.includes(q)) return false
      }
      if (filterEnv   !== 'all' && row.envId      !== filterEnv)  return false
      if (filterState === 'online'  &&  row.unreachable)           return false
      if (filterState === 'offline' && !row.unreachable)           return false
      if (filterHost  !== 'all' && row.hostingType !== filterHost) return false
      // Alias filter — only meaningful on leaf rows; headers excluded
      if (filterAlias !== 'all') {
        if (row.type !== 'standalone' && row.type !== 'ag-replica') return false
        const key = `${row.host}:${row.port}`
        if (serverAliases[key] !== filterAlias) return false
      }
      // Referente filter — leaf rows only; matches if any DB of this server has the referente
      if (filterReferente !== 'all') {
        if (row.type !== 'standalone' && row.type !== 'ag-replica') return false
        const key = `${row.host}:${row.port}`
        const dbs = metricsMap[key]?.databases ?? []
        if (!dbs.some((db) => db.referente === filterReferente)) return false
      }
      // Version filter — applied to every row; headers carry the primary/first-instance version
      if (filterVersion !== 'all' && getSqlServerVersion(row.version) !== filterVersion) return false
      return true
    })
  }, [allRows, search, filterEnv, filterType, filterState, filterHost, filterAlias, filterReferente, filterVersion, serverAliases, metricsMap])

  // ── Filtered KPI stats (derived from filteredRows, zero extra pass) ────
  const filteredStats = useMemo(() => {
    // depth=0 standalone rows only (excludes depth=1 instances under machine-header)
    const standaloneRows = filteredRows.filter((r) => r.type === 'standalone' && r.depth === 0)
    const machineRows    = filteredRows.filter((r) => r.type === 'machine-header')
    const clusterRows    = filteredRows.filter((r) => r.type === 'ag-cluster')
    const replicaRows    = filteredRows.filter((r) => r.type === 'ag-replica')

    // Machine-grouped instances counted from the header's instanceCount
    const machineInstances = machineRows.reduce((s, r) => s + (r.instanceCount ?? 0), 0)

    const agServers = clusterRows.length > 0
      ? clusterRows.reduce((sum, r) => sum + (r.replicaCount ?? 1), 0)
      : replicaRows.length

    const servers    = standaloneRows.length + machineInstances + agServers
    const standalone = standaloneRows.length + machineInstances
    const agClusters = clusterRows.length

    // When only replica rows are visible (ag-primary/ag-secondary filter), use those for DB stats
    // Machine-header rows already aggregate DB stats from their instances
    const dbSourceRows =
      clusterRows.length > 0 || standaloneRows.length > 0 || machineRows.length > 0
        ? [...standaloneRows, ...machineRows, ...clusterRows]
        : replicaRows

    const databases  = dbSourceRows.reduce((sum, r) => sum + r.dbCount, 0)
    const onlineDbs  = dbSourceRows.reduce((sum, r) => sum + r.onlineCount, 0)
    const offlineDbs = dbSourceRows.reduce((sum, r) => sum + r.offlineCount, 0)

    return { servers, standalone, agClusters, agServers, databases, onlineDbs, offlineDbs }
  }, [filteredRows])

  const hasActiveFilters =
    search !== '' || filterEnv !== 'all' || filterType !== 'all' ||
    filterState !== 'all' || filterHost !== 'all' ||
    filterAlias !== 'all' || filterReferente !== 'all' || filterVersion !== 'all'

  // Sort: keep replica rows attached to their parent cluster header
  const sortedRows = useMemo(() => {
    // Only treat as hierarchical when there are actual parent header rows visible.
    // This prevents orphaned depth=1 rows from being silently dropped when
    // alias/referente filters show leaf rows without their parent headers.
    const hasHierarchy =
      filteredRows.some((r) => r.depth === 1) &&
      filteredRows.some((r) => r.depth === 0 && (r.type === 'ag-cluster' || r.type === 'machine-header'))

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

  // ── Virtualizer ─────────────────────────────────────────────────────────
  const rowVirtualizer = useVirtualizer({
    count:            sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize:     () => 48,
    overscan:         10,
  })

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
    const totalExpanded   = expandedClusters.size + expandedMachines.size
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
    const { serverAliases } = useGroupsStore.getState()
    const { metricsMap }    = useMetricsStore.getState()
    const cfResult          = await window.sqlSentinel.getAllDbCustomFields()
    const dbCustomFields: Record<string, DbCustomFields> = cfResult.ok ? cfResult.data : {}

    // When filters are active, restrict export to servers visible in the filtered table.
    // We use a fully-expanded row set so collapsed AG/machine children are always included.
    let allowedServerIds: Set<string> | undefined
    if (hasActiveFilters) {
      const fullyExpanded = buildRows(
        inventory.groups,
        new Set(allClusterKeys),
        new Set(allMachineKeys)
      )
      const q = search.toLowerCase()
      const matched = fullyExpanded.filter((row) => {
        if (row.type !== 'standalone' && row.type !== 'ag-replica') return false
        if (filterType !== 'all') {
          if (filterType === 'standalone' && row.type !== 'standalone') return false
          if (filterType === 'ag-primary'   && !(row.type === 'ag-replica' && row.agRole === 'PRIMARY'))   return false
          if (filterType === 'ag-secondary' && !(row.type === 'ag-replica' && row.agRole === 'SECONDARY')) return false
        }
        if (q && !row.serverLabel.toLowerCase().includes(q) && !row.host.toLowerCase().includes(q) && !(row.agName ?? '').toLowerCase().includes(q)) return false
        if (filterEnv   !== 'all' && row.envId      !== filterEnv)  return false
        if (filterState === 'online'  &&  row.unreachable)           return false
        if (filterState === 'offline' && !row.unreachable)           return false
        if (filterHost  !== 'all' && row.hostingType !== filterHost) return false
        if (filterAlias !== 'all' && serverAliases[`${row.host}:${row.port}`] !== filterAlias) return false
        if (filterReferente !== 'all') {
          const dbs = metricsMap[`${row.host}:${row.port}`]?.databases ?? []
          if (!dbs.some((db) => db.referente === filterReferente)) return false
        }
        if (filterVersion !== 'all' && getSqlServerVersion(row.version) !== filterVersion) return false
        return true
      })
      allowedServerIds = new Set(matched.map((r) => r.serverId!))
    }

    const headers = [
      'Ambiente', 'Tipo', 'AG Nome', 'Server', 'Alias', 'Referente', 'Ruolo AG',
      'Database', 'Stato DB', 'Dati (MB)', 'Log (MB)',
      'Ultimo Backup Full', 'Ultimo Backup Log',
      'Versione SQL', 'Uptime Server (giorni)', 'Stato Server', 'Tipo Infrastruttura',
      'CPU Logici', 'CPU Fisici', 'Note'
    ]
    const exportRows = buildInventoryCsvRows(inventory, serverAliases, metricsMap, dbCustomFields, allowedServerIds)
    await window.sqlSentinel.exportInventoryCsv({ headers, rows: exportRows })
  }, [inventory, hasActiveFilters, search, filterEnv, filterType, filterState, filterHost, filterAlias, filterReferente, filterVersion, allClusterKeys, allMachineKeys])

  const handleSort = useCallback((key: keyof InventoryRow) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const handleResetFilters = useCallback(() => {
    setSearch('')
    setFilterEnv('all')
    setFilterType('all')
    setFilterState('all')
    setFilterHost('all')
    setFilterAlias('all')
    setFilterReferente('all')
    setFilterVersion('all')
  }, [])

  return (
    <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto', px: 3, py: 2 }}>

        {/* ── Top bar ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary', flex: 1 }}>
            Inventario SQL Server
          </Typography>
          {lastRefresh && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Aggiornato: {lastRefresh.toLocaleTimeString('it-IT')}
            </Typography>
          )}
          <Tooltip title="Esporta CSV">
            <span>
              <Button
                size="small" variant="outlined" startIcon={<DownloadIcon />}
                onClick={handleExportCsv} disabled={inventory.groups.length === 0}
                sx={{ fontSize: 12 }}
              >
                Esporta CSV
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Aggiorna metriche da tutti i server">
            <span>
              <Button
                size="small" variant="contained"
                startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />}
                onClick={handleRefresh} disabled={refreshing}
                sx={{ fontSize: 12, bgcolor: tokens.color.primary }}
              >
                {refreshing ? 'Aggiornamento…' : 'Aggiorna'}
              </Button>
            </span>
          </Tooltip>
        </Box>

        {/* ── KPI cards ── */}
        <Box sx={{ display: 'flex', gap: 1.5, mb: hasActiveFilters ? 1 : 3, flexWrap: 'wrap' }}>
          <KpiCard label="Server"     value={String(filteredStats.servers)}    accentColor="#0078d4" />
          <KpiCard label="Standalone" value={String(filteredStats.standalone)} accentColor="#0078d4" />
          <KpiCard
            label="AG Cluster"
            value={filteredStats.agClusters > 0 ? `${filteredStats.agClusters} (${filteredStats.agServers} nodi)` : '0'}
            accentColor="#8764b8"
          />
          <KpiCard label="Database" value={String(filteredStats.databases)}  accentColor="#0078d4" />
          <KpiCard label="Online"   value={String(filteredStats.onlineDbs)}  accentColor="#107c10" />
          <KpiCard
            label="Offline" value={String(filteredStats.offlineDbs)}
            accentColor={filteredStats.offlineDbs > 0 ? '#a4262c' : '#107c10'}
          />
        </Box>

        {/* ── Filter indicator ── */}
        {hasActiveFilters && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Risultati filtrati: {filteredStats.servers} di {totals.servers} server
          </Typography>
        )}

        {/* ── Empty placeholder ── */}
        {inventory.groups.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
            <Typography sx={{ fontSize: 14 }}>
              Nessun server monitorato. Aggiungi server dalla sezione Discovery.
            </Typography>
          </Box>
        )}

        {/* ── Filter bar + table ── */}
        {inventory.groups.length > 0 && (
          <>
            {/* Filter bar */}
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                placeholder="Cerca server o alias..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  )
                }}
                sx={{ minWidth: 220 }}
              />

              <Select size="small" value={filterEnv}
                onChange={(e) => setFilterEnv(e.target.value)} sx={{ minWidth: 160 }}>
                <MenuItem value="all">Tutti gli ambienti</MenuItem>
                {envGroups.map((g) => (
                  <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
                ))}
              </Select>

              <Select size="small" value={filterType}
                onChange={(e) => setFilterType(e.target.value as typeof filterType)} sx={{ minWidth: 150 }}>
                <MenuItem value="all">Tutti i tipi</MenuItem>
                <MenuItem value="standalone">Standalone</MenuItem>
                <MenuItem value="ag-primary">AG Primary</MenuItem>
                <MenuItem value="ag-secondary">AG Secondary</MenuItem>
              </Select>

              <Select size="small" value={filterState}
                onChange={(e) => setFilterState(e.target.value as typeof filterState)} sx={{ minWidth: 130 }}>
                <MenuItem value="all">Tutti gli stati</MenuItem>
                <MenuItem value="online">Online</MenuItem>
                <MenuItem value="offline">Offline</MenuItem>
              </Select>

              <Select size="small" value={filterHost}
                onChange={(e) => setFilterHost(e.target.value as typeof filterHost)} sx={{ minWidth: 130 }}>
                <MenuItem value="all">Tutti</MenuItem>
                <MenuItem value="on-premise">On-Premise</MenuItem>
                <MenuItem value="cloud">Cloud</MenuItem>
              </Select>

              {aliasOptions.length > 0 && (
                <Select size="small" value={filterAlias}
                  onChange={(e) => setFilterAlias(e.target.value)} sx={{ minWidth: 150 }}>
                  <MenuItem value="all">Tutti gli alias</MenuItem>
                  {aliasOptions.map((a) => (
                    <MenuItem key={a} value={a}>{a}</MenuItem>
                  ))}
                </Select>
              )}

              {referenteOptions.length > 0 && (
                <Select size="small" value={filterReferente}
                  onChange={(e) => setFilterReferente(e.target.value)} sx={{ minWidth: 160 }}>
                  <MenuItem value="all">Tutti i referenti</MenuItem>
                  {referenteOptions.map((r) => (
                    <MenuItem key={r} value={r}>{r}</MenuItem>
                  ))}
                </Select>
              )}

              {versionOptions.length > 0 && (
                <Select size="small" value={filterVersion}
                  onChange={(e) => setFilterVersion(e.target.value)} sx={{ minWidth: 165 }}>
                  <MenuItem value="all">Tutte le versioni</MenuItem>
                  {versionOptions.map((v) => (
                    <MenuItem key={v} value={v}>{v}</MenuItem>
                  ))}
                </Select>
              )}

              <Button
                size="small" variant="text" color="inherit"
                startIcon={<FilterListIcon />}
                onClick={handleResetFilters}
              >
                Reset
              </Button>

              {(allClusterKeys.length > 0 || allMachineKeys.length > 0) && (
                <Button
                  size="small" variant="text" color="inherit"
                  onClick={handleToggleAll}
                  sx={{ ml: 0 }}
                >
                  {expandedClusters.size > 0 || expandedMachines.size > 0 ? 'Comprimi tutti' : 'Espandi tutti'}
                </Button>
              )}

              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                {sortedRows.filter((r) => r.depth === 0).length} server
              </Typography>
            </Box>

            {/* Virtualised table */}
            <Paper sx={{ overflow: 'hidden' }}>
              {/* Sticky column headers */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: GRID_TEMPLATE,
                  px: 2, py: 1,
                  bgcolor: 'background.default',
                  borderBottom: (theme) => `2px solid ${theme.palette.divider}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}
              >
                {COLUMNS.map((col) => {
                  const active = sortKey === col.key
                  return (
                    <Box
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.25, cursor: 'pointer', userSelect: 'none' }}
                    >
                      <Typography
                        variant="caption" fontWeight={700}
                        sx={{ color: active ? tokens.color.primary : 'text.secondary' }}
                      >
                        {col.label}
                      </Typography>
                      {active && (
                        <Typography variant="caption" sx={{ color: tokens.color.primary, fontSize: 10 }}>
                          {sortDir === 'asc' ? '▲' : '▼'}
                        </Typography>
                      )}
                    </Box>
                  )
                })}
              </Box>

              {/* Scroll container */}
              <Box
                ref={parentRef}
                sx={{ height: 'calc(100vh - 360px)', overflowY: 'auto', position: 'relative' }}
              >
                {sortedRows.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                    Nessun server corrisponde ai filtri selezionati
                  </Box>
                ) : (
                  <Box sx={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                    {rowVirtualizer.getVirtualItems().map((vRow) => {
                      const row = sortedRows[vRow.index]
                      // Indent depth-1 rows only when their parent header is visible
                      const isHierarchical = filterType === 'all' && filterAlias === 'all' && filterReferente === 'all' && filterVersion === 'all'
                      const pl = row.depth === 1 && isHierarchical ? 4 : 2

                      return (
                        <Box
                          key={row.id}
                          onClick={() => handleRowClick(row)}
                          sx={{
                            position: 'absolute',
                            top: vRow.start,
                            height: vRow.size,
                            width: '100%',
                            display: 'grid',
                            gridTemplateColumns: GRID_TEMPLATE,
                            alignItems: 'center',
                            px: 2,
                            pl,
                            cursor: 'pointer',
                            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                            bgcolor: (theme) =>
                              theme.palette.mode === 'dark'
                                ? row.type === 'machine-header' ? alpha(theme.palette.info.main, 0.12)
                                  : row.type === 'ag-cluster'   ? alpha('#8b5cf6', 0.12)
                                  : row.type === 'ag-replica'   ? alpha('#ffffff', 0.03)
                                  : row.unreachable             ? alpha(theme.palette.error.main, 0.2)
                                  : theme.palette.background.paper
                                : row.type === 'machine-header' ? '#edf2f7'
                                : row.type === 'ag-cluster'     ? '#f6f4fb'
                                : row.type === 'ag-replica'     ? '#fafafa'
                                : row.unreachable               ? '#fde7e9'
                                : theme.palette.background.paper,
                            '&:hover': {
                              bgcolor: (theme) =>
                                theme.palette.mode === 'dark'
                                  ? row.type === 'machine-header' ? alpha(theme.palette.info.main, 0.22)
                                    : row.type === 'ag-cluster'   ? alpha('#8b5cf6', 0.22)
                                    : row.unreachable             ? alpha(theme.palette.error.main, 0.3)
                                    : theme.palette.action.hover
                                  : row.type === 'machine-header' ? '#dce7f0'
                                  : row.type === 'ag-cluster'     ? '#ede8f5'
                                  : row.unreachable               ? '#fad4d4'
                                  : theme.palette.action.hover,
                            },
                          }}
                        >
                          {/* ── SERVER ── */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                            {/* Expand / collapse toggle for ag-cluster */}
                            {row.type === 'ag-cluster' && (
                              expandedClusters.has(row.clusterKey!)
                                ? <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                                : <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                            )}
                            {/* Expand / collapse toggle for machine-header */}
                            {row.type === 'machine-header' && (
                              expandedMachines.has(row.clusterKey!)
                                ? <ExpandMoreIcon fontSize="small" sx={{ color: '#4a6fa5', flexShrink: 0 }} />
                                : <ChevronRightIcon fontSize="small" sx={{ color: '#4a6fa5', flexShrink: 0 }} />
                            )}
                            {/* Cluster icon */}
                            {row.type === 'ag-cluster' && (
                              <AccountTreeIcon fontSize="small" sx={{ color: '#8764b8', flexShrink: 0 }} />
                            )}
                            {/* Machine icon */}
                            {row.type === 'machine-header' && (
                              <Typography sx={{ fontSize: 14, flexShrink: 0 }}>🖥</Typography>
                            )}
                            {/* Role star / circle for replicas */}
                            {row.type === 'ag-replica' && (
                              <Typography sx={{ flexShrink: 0, color: row.agRole === 'PRIMARY' ? '#107c10' : 'text.secondary', fontSize: 12 }}>
                                {row.agRole === 'PRIMARY' ? '★' : '○'}
                              </Typography>
                            )}

                            <Box sx={{ minWidth: 0 }}>
                              <Typography
                                variant="body2"
                                fontWeight={row.type === 'ag-cluster' || row.type === 'machine-header' ? 700 : 500}
                                noWrap
                                sx={row.type === 'machine-header' ? { color: '#2d5a8a' } : undefined}
                              >
                                {row.serverLabel}
                              </Typography>
                              {row.type === 'ag-cluster' ? (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {row.replicaCount} repliche · Primary: {row.host || '—'}
                                </Typography>
                              ) : row.type === 'machine-header' ? (
                                <Typography variant="caption" sx={{ color: '#4a6fa5' }} noWrap>
                                  {row.instanceCount} istanze
                                </Typography>
                              ) : (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {row.port !== 1433 ? `${row.host}:${row.port}` : row.host}
                                </Typography>
                              )}
                            </Box>
                          </Box>

                          {/* ── AMBIENTE ── */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: row.envColor, flexShrink: 0 }} />
                            <Typography variant="caption" noWrap>{row.envName}</Typography>
                          </Box>

                          {/* ── TIPO ── */}
                          <Typography variant="caption">
                            {row.type === 'machine-header' ? 'Multi-istanza' :
                             row.type === 'standalone'     ? 'Standalone'    :
                             row.type === 'ag-cluster'     ? 'AG Cluster'    :
                             row.agRole === 'PRIMARY'      ? 'AG Primary'    : 'AG Secondary'}
                          </Typography>

                          {/* ── MACCHINA ── */}
                          <Typography
                            variant="caption" color="text.secondary"
                            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {row.machineName || '—'}
                          </Typography>

                          {/* ── HOSTING ── */}
                          <Chip
                            label={HOSTING_BADGE[row.hostingType].label}
                            size="small"
                            sx={{
                              height: 18, fontSize: 9, fontWeight: 700, borderRadius: '3px',
                              bgcolor: HOSTING_BADGE[row.hostingType].color,
                              color: '#fff', width: 'fit-content'
                            }}
                          />

                          {/* ── DB ── */}
                          <Typography variant="body2">
                            {row.dbCount > 0 ? row.dbCount : '—'}
                          </Typography>

                          {/* ── ONLINE ── */}
                          <Typography variant="body2" color="success.main">
                            {row.dbCount > 0 ? row.onlineCount : '—'}
                          </Typography>

                          {/* ── OFFLINE ── */}
                          {row.offlineCount > 0 ? (
                            <Chip
                              label={row.offlineCount} size="small"
                              sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: '#a4262c', color: '#fff', borderRadius: '3px', width: 'fit-content' }}
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              {row.dbCount > 0 ? '0' : '—'}
                            </Typography>
                          )}

                          {/* ── DATI ── */}
                          <Typography variant="body2">
                            {row.type === 'ag-replica' && row.agRole === 'SECONDARY'
                              ? <em style={{ color: '#aaa' }}>replica</em>
                              : row.totalDataMb > 0 ? formatMb(row.totalDataMb) : '—'}
                          </Typography>

                          {/* ── VERSIONE ── */}
                          <Typography
                            variant="caption" color="text.secondary"
                            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {row.version || '—'}
                          </Typography>

                          {/* ── CPU ── */}
                          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                            {row.logicalCpus
                              ? row.physicalCpus
                                ? `${row.physicalCpus}C / ${row.logicalCpus}T`
                                : `${row.logicalCpus} vCPU`
                              : '—'}
                          </Typography>

                          {/* ── STATO ── */}
                          {row.type === 'ag-cluster' ? (
                            <Chip
                              label={row.agHealthy ? 'HEALTHY' : 'DEGRADED'}
                              size="small"
                              sx={{
                                height: 20, fontSize: 10, fontWeight: 700, borderRadius: '3px',
                                bgcolor: row.agHealthy ? '#107c10' : '#a4262c',
                                color: '#fff', width: 'fit-content'
                              }}
                            />
                          ) : row.type === 'machine-header' ? (
                            <Chip
                              label={row.unreachable ? 'OFFLINE' : 'OK'}
                              size="small"
                              sx={{
                                height: 20, fontSize: 10, fontWeight: 700, borderRadius: '3px',
                                bgcolor: row.unreachable ? '#a4262c' : '#4a6fa5',
                                color: '#fff', width: 'fit-content'
                              }}
                            />
                          ) : (
                            <Chip
                              label={row.unreachable ? 'OFFLINE' : 'ONLINE'}
                              size="small"
                              sx={{
                                height: 20, fontSize: 10, fontWeight: 700, borderRadius: '3px',
                                bgcolor: row.unreachable ? '#a4262c' : '#107c10',
                                color: '#fff', width: 'fit-content'
                              }}
                            />
                          )}

                          {/* ── NOTE ── */}
                          {row.notes ? (
                            <Tooltip title={row.notes} placement="top">
                              <Typography
                                variant="body2"
                                sx={{
                                  color: 'text.secondary',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  cursor: 'help'
                                }}
                              >
                                {row.notes}
                              </Typography>
                            </Tooltip>
                          ) : (
                            <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                )}
              </Box>
            </Paper>
          </>
        )}
      </Box>
    </Box>
  )
}
