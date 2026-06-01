import { useCallback, useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { useHomeDashboard } from './useHomeDashboard'
import { DashboardCharts } from './DashboardCharts'
import { ServerTable } from './ServerTable'
import { tokens } from '../../../styles/tokens'
import { useAppStore } from '../../../store/appStore'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onNavigateToServer: (serverId: string) => void
  onNavigateToAg: (agName: string) => void
  onNavigateToDiscovery: () => void
}

// ---------------------------------------------------------------------------
// KpiCard
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  color
}: {
  label: string
  value: number
  color: string
}): React.JSX.Element {
  return (
    <Box
      sx={{
        bgcolor: tokens.color.bgSurface,
        border: `1px solid ${tokens.color.bgBorder}`,
        borderRadius: tokens.radius.sm,
        px: 2,
        py: 1.5,
        minWidth: 100,
        flex: 1
      }}
    >
      <Typography
        sx={{
          fontSize: tokens.font.sizeXs,
          fontWeight: tokens.font.weightMedium,
          color: tokens.color.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          mb: 0.5
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 28,
          fontWeight: tokens.font.weightBold,
          color,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// HomeDashboard — KPI cards + virtualised ServerTable (200+ servers)
// ---------------------------------------------------------------------------

export function HomeDashboard({
  onNavigateToServer,
  onNavigateToAg,
  onNavigateToDiscovery
}: Props): React.JSX.Element {
  const {
    servers,
    metricsMap,
    summaries,
    alertCountByServer,
    groupByServerKey,
    serverAliases,
    now,
    onlineCount,
    offlineCount,
    unreachableCount,
    criticalCount,
    warningCount,
    donutFinal,
    cpuData,
    hasCpuData
  } = useHomeDashboard(onNavigateToServer)

  const setSelectedServerId = useAppStore((s) => s.setSelectedServerId)

  // Count Always On groups shown in the table (AGs with 2+ replicas), keyed by
  // agName the same way ServerTable clusters them.
  const agGroupCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of servers) {
      const k = s.agName?.trim().toLowerCase()
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    let n = 0
    counts.forEach((c) => {
      if (c >= 2) n++
    })
    return n
  }, [servers])

  const handleNavigate = useCallback(
    (serverId: string) => {
      setSelectedServerId(serverId)
      onNavigateToServer(serverId)
    },
    [setSelectedServerId, onNavigateToServer]
  )

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
        <Typography sx={{ color: tokens.color.textMuted, fontSize: tokens.font.sizeLg }}>
          No monitored servers
        </Typography>
        <Typography
          onClick={onNavigateToDiscovery}
          sx={{
            color: tokens.color.accent,
            fontSize: tokens.font.sizeSm,
            cursor: 'pointer',
            '&:hover': { textDecoration: 'underline' }
          }}
        >
          → Go to Discovery to add servers
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2, gap: 2 }}>
      {/* ---- KPI Cards ---- */}
      <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
        <KpiCard label="Total" value={servers.length} color={tokens.color.textPrimary} />
        <KpiCard
          label="Critical"
          value={criticalCount}
          color={criticalCount > 0 ? tokens.color.danger : tokens.color.textMuted}
        />
        <KpiCard
          label="Warning"
          value={warningCount}
          color={warningCount > 0 ? tokens.color.warning : tokens.color.textMuted}
        />
        <KpiCard
          label="Offline"
          value={offlineCount}
          color={offlineCount > 0 ? tokens.color.danger : tokens.color.textMuted}
        />
        <KpiCard label="Online" value={onlineCount} color={tokens.color.success} />
        {agGroupCount > 0 && (
          <KpiCard label="Always On" value={agGroupCount} color={tokens.color.accent} />
        )}
      </Box>

      {/* ---- Charts ---- */}
      <DashboardCharts
        totalServers={servers.length}
        donutFinal={donutFinal}
        onlineCount={onlineCount}
        offlineCount={offlineCount}
        unreachableCount={unreachableCount}
        cpuData={cpuData}
        hasCpuData={hasCpuData}
      />

      {/* ---- Server list — virtualised, renders only visible rows ---- */}
      <ServerTable
        servers={servers}
        metricsMap={metricsMap}
        summaries={summaries}
        alertCountByServer={alertCountByServer}
        groupByServerKey={groupByServerKey}
        serverAliases={serverAliases}
        now={now}
        onNavigate={handleNavigate}
        onNavigateToAg={onNavigateToAg}
      />
    </Box>
  )
}
