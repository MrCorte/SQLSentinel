import { Box, Typography, Button, CircularProgress, Tooltip as MuiTooltip } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { tokens } from '../styles/tokens'
import { useHomeDashboard, formatTime } from './features/home/useHomeDashboard'
import { KpiCard } from './features/home/KpiCard'
import { ServerTable } from './features/home/ServerTable'
import { StatusDonutChart } from './features/home/StatusDonutChart'
import { CpuBarChart } from './features/home/CpuBarChart'
import { AlertsFeed } from './features/home/AlertsFeed'
import { OfflineDbsTable } from './features/home/OfflineDbsTable'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onNavigateToServer: (serverId: string) => void
  onNavigateToDiscovery: () => void
  onOpenAlerts: () => void
}

// ---------------------------------------------------------------------------
// HomeDashboard — shell component (layout + composition only)
// ---------------------------------------------------------------------------

export function HomeDashboard({
  onNavigateToServer,
  onNavigateToDiscovery,
  onOpenAlerts
}: Props): React.JSX.Element {
  const {
    servers,
    lastUpdate,
    metricsMap,
    summaries,
    serverAliases,
    now,
    onlineCount,
    offlineCount,
    unreachableCount,
    totalDbs,
    activeAlerts,
    criticalCount,
    warningCount,
    firstOffline,
    donutFinal,
    cpuData,
    hasCpuData,
    cpuChartHeight,
    recentAlerts,
    offlineDbs,
    alertCountByServer,
    groupByServerKey,
    agGroupCount,
    refreshing,
    handleRefresh,
    handleNavigate
  } = useHomeDashboard(onNavigateToServer)

  // ---- Empty state ----
  if (servers.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 2
        }}
      >
        <Typography variant="h6" sx={{ color: 'text.secondary' }}>
          No monitored servers
        </Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: tokens.font.sizeMd }}>
          Go to Discovery to add your SQL Server instances
        </Typography>
        <Button variant="outlined" onClick={onNavigateToDiscovery}>
          → Go to Discovery
        </Button>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', p: 2, height: '100%', overflow: 'auto', gap: 2, boxSizing: 'border-box' }}>
      {/* ---- Row 1: Header ---- */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: tokens.font.sizeLg, fontWeight: tokens.font.weightBold, color: 'text.primary' }}>
          Home Dashboard
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: tokens.font.sizeSm, color: 'text.secondary' }}>
            Updated: {lastUpdate ? formatTime(lastUpdate) : '—'}
          </Typography>
          <MuiTooltip title="Refresh metrics from all servers">
            <span>
              <Button
                size="small"
                variant="contained"
                startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />}
                onClick={handleRefresh}
                disabled={refreshing}
                sx={{ fontSize: tokens.font.sizeSm, bgcolor: tokens.color.primary }}
              >
                {refreshing ? 'Refreshing…' : 'Refresh metrics'}
              </Button>
            </span>
          </MuiTooltip>
        </Box>
      </Box>

      {/* ---- Row 2: KPI Cards ---- */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <KpiCard label="TOTAL SERVERS" value={servers.length} borderColor="#0078d4" />
        <KpiCard label="ONLINE" value={onlineCount} borderColor="#107c10" />
        <KpiCard
          label="OFFLINE"
          value={offlineCount}
          borderColor={offlineCount > 0 ? '#a4262c' : '#107c10'}
          onClick={firstOffline ? () => onNavigateToServer(firstOffline.id) : undefined}
        />
        <KpiCard label="DATABASE" value={totalDbs} borderColor="#0078d4" />
        <KpiCard
          label="ALERTS"
          value={activeAlerts.length}
          borderColor={criticalCount > 0 ? '#a4262c' : warningCount > 0 ? '#d83b01' : '#107c10'}
          onClick={onOpenAlerts}
        />
        <KpiCard label="AG CLUSTER" value={agGroupCount} borderColor="#8764b8" />
      </Box>

      {/* ---- Row 3: Charts ---- */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <StatusDonutChart
          totalServers={servers.length}
          donutFinal={donutFinal}
          onlineCount={onlineCount}
          offlineCount={offlineCount}
          unreachableCount={unreachableCount}
        />
        <CpuBarChart cpuData={cpuData} hasCpuData={hasCpuData} cpuChartHeight={cpuChartHeight} />
      </Box>

      {/* ---- Row 4: Server table + Alerts feed ---- */}
      <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
        <ServerTable
          servers={servers}
          metricsMap={metricsMap}
          summaries={summaries}
          alertCountByServer={alertCountByServer}
          groupByServerKey={groupByServerKey}
          serverAliases={serverAliases}
          now={now}
          onNavigate={handleNavigate}
        />
        <AlertsFeed
          recentAlerts={recentAlerts}
          servers={servers}
          serverAliases={serverAliases}
          onOpenAlerts={onOpenAlerts}
          onNavigateToServer={onNavigateToServer}
        />
      </Box>

      {/* ---- Row 5: Offline databases ---- */}
      {offlineDbs.length > 0 && (
        <OfflineDbsTable offlineDbs={offlineDbs} onNavigateToServer={onNavigateToServer} />
      )}
    </Box>
  )
}
