import { useState, useMemo, useRef, useCallback } from 'react'
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
import { useGroupsStore } from '../store/groupsStore'
import { useAppStore } from '../store/appStore'
import { computeInventory } from '../utils/inventoryUtils'
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
        bgcolor: tokens.color.bgCard,
        border: `1px solid ${tokens.color.border}`,
        borderTop: `3px solid ${accentColor}`,
        borderRadius: '4px',
        px: 2,
        py: 1.5
      }}
    >
      <Typography
        sx={{ fontSize: 10, color: tokens.color.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', mb: 0.5 }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: tokens.color.textPrimary, lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type InventoryRowType = 'standalone' | 'ag-cluster' | 'ag-replica'

interface InventoryRow {
  id:           string
  type:         InventoryRowType
  depth:        number
  serverLabel:  string
  host:         string
  port:         number
  envId:        string
  envName:      string
  envColor:     string
  hostingType:  ServerHostingType
  version:      string
  unreachable:  boolean
  dbCount:      number
  onlineCount:  number
  offlineCount: number
  totalDataMb:  number
  totalLogMb:   number
  // ag-cluster
  agName?:      string
  agHealthy?:   boolean
  replicaCount?:number
  clusterKey?:  string
  // standalone + ag-replica
  serverId?:    string
  agRole?:      'PRIMARY' | 'SECONDARY'
  uptimeDays?:  number
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
  { key: 'serverLabel',  label: 'SERVER',   width: '22%' },
  { key: 'envName',      label: 'AMBIENTE', width: '11%' },
  { key: 'type',         label: 'TIPO',     width: '10%' },
  { key: 'hostingType',  label: 'HOSTING',  width: '8%'  },
  { key: 'dbCount',      label: 'DB',       width: '6%'  },
  { key: 'onlineCount',  label: 'ONLINE',   width: '7%'  },
  { key: 'offlineCount', label: 'OFFLINE',  width: '7%'  },
  { key: 'totalDataMb',  label: 'DATI',     width: '9%'  },
  { key: 'version',      label: 'VERSIONE', width: '14%' },
  { key: 'unreachable',  label: 'STATO',    width: '6%'  },
]

const GRID_TEMPLATE = COLUMNS.map((c) => c.width).join(' ')

// ---------------------------------------------------------------------------
// Row flattener
// ---------------------------------------------------------------------------

function buildRows(invGroups: GroupInventory[], expandedClusters: Set<string>): InventoryRow[] {
  const rows: InventoryRow[] = []

  for (const group of invGroups) {
    const envId    = group.groupId ?? '__ungrouped__'
    const envName  = group.groupName
    const envColor = group.groupColor

    // ── Standalone ──────────────────────────────────────────────────────
    for (const srv of group.standaloneServers) {
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
        serverId:     srv.serverId,
        uptimeDays:   srv.uptimeDays,
      })
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
  const [refreshing,        setRefreshing]        = useState(false)
  const [lastRefresh,       setLastRefresh]        = useState<Date | null>(null)
  const [search,            setSearch]             = useState('')
  const [filterEnv,         setFilterEnv]          = useState('all')
  const [filterType,        setFilterType]         = useState<'all' | 'standalone' | 'ag-primary' | 'ag-secondary'>('all')
  const [filterState,       setFilterState]        = useState<'all' | 'online' | 'offline'>('all')
  const [filterHost,        setFilterHost]         = useState<'all' | 'on-premise' | 'cloud'>('all')
  const [sortKey,           setSortKey]            = useState<keyof InventoryRow>('envName')
  const [sortDir,           setSortDir]            = useState<'asc' | 'desc'>('asc')
  const [expandedClusters,  setExpandedClusters]   = useState<Set<string>>(new Set())
  const parentRef = useRef<HTMLDivElement>(null)

  // Store subscriptions
  useServersStore((s) => s.servers)
  useMetricsStore((s) => s.metricsMap)
  const envGroups = useGroupsStore((s) => s.groups)

  const inventory = computeInventory()
  const { totals } = inventory

  // ── All cluster keys (for Expand all / Collapse all) ────────────────────
  const allClusterKeys = useMemo(
    () => inventory.groups.flatMap((g) =>
      g.agClusters.map((ag) => `${g.groupId ?? '__ungrouped__'}__${ag.agName}`)
    ),
    [inventory.groups]
  )

  // ── Rows ────────────────────────────────────────────────────────────────
  const allRows = useMemo(
    () => buildRows(inventory.groups, expandedClusters),
    [inventory.groups, expandedClusters]
  )

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase()
    return allRows.filter((row) => {
      // Type filter
      if (filterType !== 'all') {
        if (filterType === 'standalone' && row.type !== 'standalone')                          return false
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
      return true
    })
  }, [allRows, search, filterEnv, filterType, filterState, filterHost])

  // ── Filtered KPI stats (derived from filteredRows, zero extra pass) ────
  const filteredStats = useMemo(() => {
    const standaloneRows = filteredRows.filter((r) => r.type === 'standalone')
    const clusterRows    = filteredRows.filter((r) => r.type === 'ag-cluster')
    const replicaRows    = filteredRows.filter((r) => r.type === 'ag-replica')

    const agServers = clusterRows.length > 0
      ? clusterRows.reduce((sum, r) => sum + (r.replicaCount ?? 1), 0)
      : replicaRows.length

    const servers    = standaloneRows.length + agServers
    const standalone = standaloneRows.length
    const agClusters = clusterRows.length

    // When only replica rows are visible (ag-primary/ag-secondary filter), use those for DB stats
    const dbSourceRows =
      clusterRows.length > 0 || standaloneRows.length > 0
        ? [...standaloneRows, ...clusterRows]
        : replicaRows

    const databases  = dbSourceRows.reduce((sum, r) => sum + r.dbCount, 0)
    const onlineDbs  = dbSourceRows.reduce((sum, r) => sum + r.onlineCount, 0)
    const offlineDbs = dbSourceRows.reduce((sum, r) => sum + r.offlineCount, 0)

    return { servers, standalone, agClusters, agServers, databases, onlineDbs, offlineDbs }
  }, [filteredRows])

  const hasActiveFilters =
    search !== '' || filterEnv !== 'all' || filterType !== 'all' ||
    filterState !== 'all' || filterHost !== 'all'

  // Sort: keep replica rows attached to their parent cluster header
  const sortedRows = useMemo(() => {
    const hasHierarchy = filteredRows.some((r) => r.depth === 0) && filteredRows.some((r) => r.depth === 1)

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
      if (row.type === 'ag-cluster' && row.clusterKey) {
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

  const handleToggleAll = useCallback(() => {
    setExpandedClusters(
      expandedClusters.size === allClusterKeys.length
        ? new Set()
        : new Set(allClusterKeys)
    )
  }, [expandedClusters, allClusterKeys])

  const handleRowClick = useCallback(
    (row: InventoryRow) => {
      if (row.type === 'ag-cluster') {
        toggleCluster(row.clusterKey!)
      } else if (row.serverId) {
        useAppStore.getState().setPendingServerId(row.serverId)
        onNavigateToDashboard()
      }
    },
    [toggleCluster, onNavigateToDashboard]
  )

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    const servers = useServersStore.getState().servers
    await Promise.allSettled(
      servers.map(async (srv) => {
        try {
          const conn = {
            ip: srv.ip ?? srv.host,
            port: srv.port,
            instanceName: srv.instanceName,
            useWindowsAuth: srv.useWindowsAuth,
            username: srv.username,
            password: srv.password
          }
          const result = await window.sqlSentinel.collectMetrics(conn)
          if (result.ok) {
            useMetricsStore.getState().setMetrics(`${srv.ip ?? srv.host}:${srv.port}`, result.data)
          }
        } catch {
          // Server unreachable — skip
        }
      })
    )
    setRefreshing(false)
    setLastRefresh(new Date())
  }, [])

  const handleExportCsv = useCallback(async () => {
    const { serverAliases } = useGroupsStore.getState()
    const { metricsMap }    = useMetricsStore.getState()
    const cfResult          = await window.sqlSentinel.getAllDbCustomFields()
    const dbCustomFields: Record<string, DbCustomFields> = cfResult.ok ? cfResult.data : {}
    const headers = [
      'Ambiente', 'Tipo', 'AG Nome', 'Server', 'Alias', 'Referente', 'Ruolo AG',
      'Database', 'Stato DB', 'Dati (MB)', 'Log (MB)',
      'Ultimo Backup Full', 'Ultimo Backup Log',
      'Versione SQL', 'Uptime Server (giorni)', 'Stato Server', 'Tipo Infrastruttura'
    ]
    const exportRows = buildInventoryCsvRows(inventory, serverAliases, metricsMap, dbCustomFields)
    await window.sqlSentinel.exportInventoryCsv({ headers, rows: exportRows })
  }, [inventory])

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
  }, [])

  return (
    <Box sx={{ height: '100%', overflow: 'auto', bgcolor: tokens.color.bgApp }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto', px: 3, py: 2 }}>

        {/* ── Top bar ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: tokens.color.textPrimary, flex: 1 }}>
            Inventario SQL Server
          </Typography>
          {lastRefresh && (
            <Typography sx={{ fontSize: 12, color: tokens.color.textSecondary }}>
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
          <Box sx={{ textAlign: 'center', py: 8, color: tokens.color.textSecondary }}>
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

              <Button
                size="small" variant="text" color="inherit"
                startIcon={<FilterListIcon />}
                onClick={handleResetFilters}
              >
                Reset
              </Button>

              {allClusterKeys.length > 0 && (
                <Button
                  size="small" variant="text" color="inherit"
                  onClick={handleToggleAll}
                  sx={{ ml: 0 }}
                >
                  {expandedClusters.size > 0 ? 'Comprimi tutti' : 'Espandi tutti'}
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
                  bgcolor: '#f3f2f1',
                  borderBottom: '2px solid #e0e0e0',
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
                        sx={{ color: active ? tokens.color.primary : tokens.color.textSecondary }}
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
                      // Indent replica rows only when hierarchical view (filterType === 'all')
                      const isHierarchical = filterType === 'all'
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
                            borderBottom: '1px solid #f0f0f0',
                            bgcolor:
                              row.type === 'ag-cluster' ? '#f6f4fb' :
                              row.type === 'ag-replica' ? '#fafafa'  :
                              row.unreachable           ? '#fde7e9'  : 'white',
                            '&:hover': {
                              bgcolor:
                                row.type === 'ag-cluster' ? '#ede8f5' :
                                row.unreachable           ? '#fad4d4' : '#f3f2f1'
                            },
                          }}
                        >
                          {/* ── SERVER ── */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                            {/* Expand / collapse toggle for cluster */}
                            {row.type === 'ag-cluster' && (
                              expandedClusters.has(row.clusterKey!)
                                ? <ExpandMoreIcon fontSize="small" sx={{ color: tokens.color.textSecondary, flexShrink: 0 }} />
                                : <ChevronRightIcon fontSize="small" sx={{ color: tokens.color.textSecondary, flexShrink: 0 }} />
                            )}
                            {/* Cluster icon */}
                            {row.type === 'ag-cluster' && (
                              <AccountTreeIcon fontSize="small" sx={{ color: '#8764b8', flexShrink: 0 }} />
                            )}
                            {/* Role star / circle for replicas */}
                            {row.type === 'ag-replica' && (
                              <Typography sx={{ flexShrink: 0, color: row.agRole === 'PRIMARY' ? '#107c10' : tokens.color.textSecondary, fontSize: 12 }}>
                                {row.agRole === 'PRIMARY' ? '★' : '○'}
                              </Typography>
                            )}

                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={row.type === 'ag-cluster' ? 700 : 500} noWrap>
                                {row.serverLabel}
                              </Typography>
                              {row.type === 'ag-cluster' ? (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {row.replicaCount} repliche · Primary: {row.host || '—'}
                                </Typography>
                              ) : (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {row.host}:{row.port}
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
                            {row.type === 'standalone'   ? 'Standalone'   :
                             row.type === 'ag-cluster'   ? 'AG Cluster'   :
                             row.agRole === 'PRIMARY'    ? 'AG Primary'   : 'AG Secondary'}
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
