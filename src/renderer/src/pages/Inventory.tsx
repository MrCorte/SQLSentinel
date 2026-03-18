import { useState, useCallback } from 'react'
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import DownloadIcon from '@mui/icons-material/Download'
import { useServersStore } from '../store/serversStore'
import { useMetricsStore } from '../store/metricsStore'
import { useGroupsStore } from '../store/groupsStore'
import { useAppStore } from '../store/appStore'
import { computeInventory } from '../utils/inventoryUtils'
import { buildInventoryCsvRows } from '../utils/csvExportUtils'
import type { GroupInventory, AgClusterSummary, ServerSummary } from '../types/index'
import type { DbCustomFields } from '../../../preload/index'
import { tokens } from '../styles/tokens'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

function agHealthColor(health: AgClusterSummary['health']): string {
  if (health === 'HEALTHY') return '#107c10'
  if (health === 'PARTIALLY_HEALTHY') return '#d83b01'
  return '#a4262c'
}

function agHealthLabel(health: AgClusterSummary['health']): string {
  if (health === 'HEALTHY') return '● HEALTHY'
  if (health === 'PARTIALLY_HEALTHY') return '◐ PARTIAL'
  return '○ UNHEALTHY'
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
      <Typography sx={{ fontSize: 10, color: tokens.color.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: tokens.color.textPrimary, lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Sub-section header
// ---------------------------------------------------------------------------

function SubSectionHeader({ label, accent }: { label: string; accent: string }): React.JSX.Element {
  return (
    <Box
      sx={{
        bgcolor: '#f3f2f1',
        borderLeft: `3px solid ${accent}`,
        px: 1.5,
        py: 0.75,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: '#323130'
      }}
    >
      {label}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: ServerSummary['agRole'] }): React.JSX.Element {
  if (!role) return <></>
  const styles: Record<string, { bg: string; color: string }> = {
    PRIMARY:   { bg: '#dff6dd', color: '#107c10' },
    SECONDARY: { bg: '#f3f2f1', color: '#605e5c' },
    RESOLVING: { bg: '#fed9cc', color: '#d83b01' }
  }
  const s = styles[role] ?? styles.RESOLVING
  return (
    <Box
      component="span"
      sx={{
        fontSize: 10,
        fontWeight: 700,
        bgcolor: s.bg,
        color: s.color,
        px: 0.75,
        py: 0.25,
        borderRadius: '3px',
        ml: 0.5
      }}
    >
      {role}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Standalone table
// ---------------------------------------------------------------------------

function StandaloneTable({
  servers,
  onRowClick
}: {
  servers: ServerSummary[]
  onRowClick: (srv: ServerSummary) => void
}): React.JSX.Element {
  if (servers.length === 0) {
    return (
      <Box sx={{ px: 2, py: 1.5, color: tokens.color.textSecondary, fontSize: 13 }}>
        Nessun server standalone in questo ambiente
      </Box>
    )
  }
  return (
    <Table size="small">
      <TableHead>
        <TableRow sx={{ '& th': { fontSize: 11, fontWeight: 600, color: tokens.color.textSecondary, py: 0.75 } }}>
          <TableCell>Server</TableCell>
          <TableCell align="right">DB</TableCell>
          <TableCell align="right">Online</TableCell>
          <TableCell align="right">Offline</TableCell>
          <TableCell align="right">Dati</TableCell>
          <TableCell align="right">Log</TableCell>
          <TableCell>Versione</TableCell>
          <TableCell align="right">Uptime (g)</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {servers.map((srv) => (
          <TableRow
            key={srv.serverId}
            hover
            onClick={() => onRowClick(srv)}
            sx={{
              cursor: 'pointer',
              opacity: srv.unreachable ? 0.5 : 1,
              '& td': { fontSize: 13, py: 0.75 }
            }}
          >
            <TableCell>
              {srv.unreachable && (
                <Typography component="span" sx={{ color: '#a4262c', mr: 0.5, fontSize: 13 }}>⚠</Typography>
              )}
              {srv.displayName}
            </TableCell>
            <TableCell align="right">{srv.dbCount || '—'}</TableCell>
            <TableCell align="right">{srv.dbCount > 0 ? srv.onlineCount : '—'}</TableCell>
            <TableCell
              align="right"
              sx={
                srv.offlineCount > 0
                  ? { bgcolor: '#fde7e9', color: '#a4262c', fontWeight: 600 }
                  : {}
              }
            >
              {srv.dbCount > 0 ? srv.offlineCount : '—'}
            </TableCell>
            <TableCell align="right">{srv.totalDataMb > 0 ? formatMb(srv.totalDataMb) : '—'}</TableCell>
            <TableCell align="right">{srv.totalLogMb > 0 ? formatMb(srv.totalLogMb) : '—'}</TableCell>
            <TableCell sx={{ fontSize: 12, color: tokens.color.textSecondary }}>{srv.version}</TableCell>
            <TableCell align="right">{srv.uptimeDays > 0 ? srv.uptimeDays : '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ---------------------------------------------------------------------------
// AG cluster block
// ---------------------------------------------------------------------------

function AgClusterBlock({
  cluster,
  onRowClick
}: {
  cluster: AgClusterSummary
  onRowClick: (srv: ServerSummary) => void
}): React.JSX.Element {
  const healthColor = agHealthColor(cluster.health)
  return (
    <Box sx={{ mb: 2 }}>
      {/* AG header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.5,
          py: 1,
          bgcolor: '#1e2a3a',
          borderLeft: `3px solid ${healthColor}`
        }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#a0c4d8', flex: 1 }}>
          🔗 {cluster.agName}
        </Typography>
        <Chip
          label={agHealthLabel(cluster.health)}
          size="small"
          sx={{ bgcolor: `${healthColor}22`, color: healthColor, fontWeight: 700, fontSize: 11, height: 20 }}
        />
        <Typography sx={{ fontSize: 12, color: '#a0a0a0' }}>
          Primary: {cluster.primaryReplica}
        </Typography>
      </Box>

      {/* Replica table */}
      <Table size="small">
        <TableHead>
          <TableRow sx={{ '& th': { fontSize: 11, fontWeight: 600, color: tokens.color.textSecondary, py: 0.75 } }}>
            <TableCell>Server</TableCell>
            <TableCell>Ruolo</TableCell>
            <TableCell align="right">DB</TableCell>
            <TableCell align="right">Online</TableCell>
            <TableCell align="right">Offline</TableCell>
            <TableCell align="right">Dati</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {cluster.replicas.map((srv) => (
            <TableRow
              key={srv.serverId}
              hover
              onClick={() => onRowClick(srv)}
              sx={{
                cursor: 'pointer',
                opacity: srv.unreachable ? 0.5 : 1,
                '& td': { fontSize: 13, py: 0.75 }
              }}
            >
              <TableCell>
                {srv.unreachable && (
                  <Typography component="span" sx={{ color: '#a4262c', mr: 0.5, fontSize: 13 }}>⚠</Typography>
                )}
                {srv.agRole === 'PRIMARY' ? '★ ' : '○ '}
                {srv.displayName}
              </TableCell>
              <TableCell>
                <RoleBadge role={srv.agRole} />
              </TableCell>
              <TableCell align="right">{srv.dbCount || '—'}</TableCell>
              <TableCell align="right">{srv.dbCount > 0 ? srv.onlineCount : '—'}</TableCell>
              <TableCell
                align="right"
                sx={
                  srv.offlineCount > 0
                    ? { bgcolor: '#fde7e9', color: '#a4262c', fontWeight: 600 }
                    : {}
                }
              >
                {srv.dbCount > 0 ? srv.offlineCount : '—'}
              </TableCell>
              <TableCell align="right">
                {srv.agRole === 'SECONDARY' ? (
                  <Typography component="span" sx={{ fontSize: 11, color: tokens.color.textSecondary, fontStyle: 'italic' }}>
                    replica*
                  </Typography>
                ) : srv.totalDataMb > 0 ? formatMb(srv.totalDataMb) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cluster.replicas.some((r) => r.agRole === 'SECONDARY') && (
        <Typography sx={{ fontSize: 11, color: tokens.color.textSecondary, fontStyle: 'italic', px: 1.5, py: 0.5 }}>
          * I database delle repliche SECONDARY non vengono conteggiati per evitare duplicati.
        </Typography>
      )}
      <Typography sx={{ fontSize: 12, color: tokens.color.textSecondary, px: 1.5, pb: 1 }}>
        Totale AG: {cluster.dbCount} DB (conteggio su PRIMARY)
      </Typography>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Group section
// ---------------------------------------------------------------------------

function GroupSection({
  group,
  onRowClick
}: {
  group: GroupInventory
  onRowClick: (srv: ServerSummary) => void
}): React.JSX.Element {
  const totalDbs = group.standaloneDbCount + group.agDbCount
  const totalOnline = group.standaloneOnline + group.agOnline
  const totalOffline = group.standaloneOffline + group.agOffline
  const totalData = group.standaloneDataMb + group.agDataMb
  const totalLog = group.standaloneLogMb + group.agLogMb

  return (
    <Box
      sx={{
        border: `1px solid ${tokens.color.border}`,
        borderLeft: `4px solid ${group.groupColor}`,
        borderRadius: '4px',
        mb: 2,
        overflow: 'hidden'
      }}
    >
      {/* Group header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 1,
          px: 2,
          py: 1.25,
          bgcolor: tokens.color.bgCard,
          borderBottom: `1px solid ${tokens.color.border}`
        }}
      >
        <Box
          component="span"
          sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: group.groupColor, display: 'inline-block', mr: 0.5, flexShrink: 0, mt: 0.25 }}
        />
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: tokens.color.textPrimary, flex: 1 }}>
          {group.groupName}
        </Typography>
        <Typography sx={{ fontSize: 12, color: tokens.color.textSecondary }}>
          {group.standaloneServers.length + group.agClusters.reduce((s, a) => s + a.replicas.length, 0)} server
          {totalDbs > 0 && ` | ${totalDbs} DB | ${totalOnline} online${totalOffline > 0 ? ` | ${totalOffline} offline` : ''}`}
          {totalData > 0 && ` | Dati: ${formatMb(totalData)} | Log: ${formatMb(totalLog)}`}
        </Typography>
      </Box>

      <Box sx={{ px: 2, py: 1.5 }}>
        {/* Standalone sub-section */}
        <Box sx={{ mb: 2 }}>
          <SubSectionHeader label="Standalone" accent="#0078d4" />
          <StandaloneTable servers={group.standaloneServers} onRowClick={onRowClick} />
        </Box>

        {/* Always On sub-section */}
        <Box>
          <SubSectionHeader label="Always On Availability Groups" accent="#8764b8" />
          {group.agClusters.length === 0 ? (
            <Box sx={{ px: 2, py: 1.5, color: tokens.color.textSecondary, fontSize: 13 }}>
              Nessun AG in questo ambiente
            </Box>
          ) : (
            <Box sx={{ pt: 1 }}>
              {group.agClusters.map((ag) => (
                <AgClusterBlock key={ag.agName} cluster={ag} onRowClick={onRowClick} />
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Inventory (main export)
// ---------------------------------------------------------------------------

interface InventoryProps {
  onNavigateToDashboard: () => void
}

export function Inventory({ onNavigateToDashboard }: InventoryProps): React.JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Trigger re-computation by subscribing to stores that change
  useServersStore((s) => s.servers)
  useMetricsStore((s) => s.metricsMap)

  const inventory = computeInventory()
  const { totals } = inventory

  const agTotalNodes = totals.agServers

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
          // Server unreachable — skip silently
        }
      })
    )
    setRefreshing(false)
    setLastRefresh(new Date())
  }, [])

  const handleRowClick = useCallback(
    (srv: ServerSummary) => {
      useAppStore.getState().setPendingServerId(srv.serverId)
      onNavigateToDashboard()
    },
    [onNavigateToDashboard]
  )

  const handleExportCsv = useCallback(async () => {
    const { serverAliases } = useGroupsStore.getState()
    const { metricsMap } = useMetricsStore.getState()

    const cfResult = await window.sqlSentinel.getAllDbCustomFields()
    const dbCustomFields: Record<string, DbCustomFields> = cfResult.ok ? cfResult.data : {}

    const headers = [
      'Ambiente',
      'Tipo',
      'AG Nome',
      'Server',
      'Alias',
      'Referente',
      'Ruolo AG',
      'Database',
      'Stato DB',
      'Dati (MB)',
      'Log (MB)',
      'Ultimo Backup Full',
      'Ultimo Backup Log',
      'Versione SQL',
      'Uptime Server (giorni)',
      'Stato Server'
    ]

    const exportRows = buildInventoryCsvRows(inventory, serverAliases, metricsMap, dbCustomFields)
    await window.sqlSentinel.exportInventoryCsv({ headers, rows: exportRows })
  }, [inventory])

  return (
    <Box sx={{ height: '100%', overflow: 'auto', bgcolor: tokens.color.bgApp }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto', px: 3, py: 2 }}>

        {/* ---- Top bar ---- */}
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
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleExportCsv}
                disabled={inventory.groups.length === 0}
                sx={{ fontSize: 12 }}
              >
                Esporta CSV
              </Button>
            </span>
          </Tooltip>

          <Tooltip title="Aggiorna metriche da tutti i server">
            <span>
              <Button
                size="small"
                variant="contained"
                startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />}
                onClick={handleRefresh}
                disabled={refreshing}
                sx={{ fontSize: 12, bgcolor: tokens.color.primary }}
              >
                {refreshing ? 'Aggiornamento…' : 'Aggiorna'}
              </Button>
            </span>
          </Tooltip>
        </Box>

        {/* ---- KPI cards ---- */}
        <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
          <KpiCard label="Server" value={String(totals.servers)} accentColor="#0078d4" />
          <KpiCard label="Standalone" value={String(totals.standaloneServers)} accentColor="#0078d4" />
          <KpiCard
            label="AG Cluster"
            value={totals.agClusters > 0 ? `${totals.agClusters} (${agTotalNodes} nodi)` : '0'}
            accentColor="#8764b8"
          />
          <KpiCard label="Database" value={String(totals.databases)} accentColor="#0078d4" />
          <KpiCard label="Online" value={String(totals.onlineDbs)} accentColor="#107c10" />
          <KpiCard
            label="Offline"
            value={String(totals.offlineDbs)}
            accentColor={totals.offlineDbs > 0 ? '#a4262c' : '#107c10'}
          />
        </Box>

        {/* ---- No servers placeholder ---- */}
        {inventory.groups.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8, color: tokens.color.textSecondary }}>
            <Typography sx={{ fontSize: 14 }}>
              Nessun server monitorato. Aggiungi server dalla sezione Discovery.
            </Typography>
          </Box>
        )}

        {/* ---- Per-group sections ---- */}
        {inventory.groups.map((g) => (
          <GroupSection
            key={g.groupId ?? '__ungrouped__'}
            group={g}
            onRowClick={handleRowClick}
          />
        ))}
      </Box>
    </Box>
  )
}
