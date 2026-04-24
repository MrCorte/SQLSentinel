import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid'
import { useHomeDashboard } from './features/home/useHomeDashboard'
import { DashboardCharts } from './features/home/DashboardCharts'
import { tokens } from '../styles/tokens'
import { useAppStore } from '../store/appStore'
import { useGroupsStore } from '../store/groupsStore'
import { getServerDisplayName } from '../types/index'
import type { StoredServer } from '../../../preload/index'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onNavigateToServer: (serverId: string) => void
  onNavigateToDiscovery: () => void
  onOpenAlerts: () => void
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ color }: { color: string }): React.JSX.Element {
  return (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: color,
        display: 'inline-block',
        flexShrink: 0
      }}
    />
  )
}

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
// HomeDashboard — KPI cards + DataGrid (32 px rows, scales to 200+ servers)
// ---------------------------------------------------------------------------

export function HomeDashboard({
  onNavigateToServer,
  onNavigateToDiscovery
}: Props): React.JSX.Element {
  const {
    servers,
    metricsMap,
    summaries,
    alertCountByServer,
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
  const serverAliases = useGroupsStore((s) => s.serverAliases)

  const rows = useMemo(
    () =>
      servers.map((s: StoredServer) => {
        const key = `${s.host ?? s.ip}:${s.port}`
        const snap = metricsMap[key]
        const summary = summaries[key]
        const counts = alertCountByServer[s.id]
        const alertCount = counts ? counts.crit + counts.warn : 0
        const cpu = snap?.instanceInfo?.cpuUsagePercent ?? null
        const memUsed = snap?.instanceInfo?.memoryUsedMb ?? null
        const ramGb = memUsed != null ? (memUsed / 1024).toFixed(1) : null
        const blocking =
          snap?.activeSessions?.filter((se) => se.blockingSessionId > 0).length ?? 0
        const dbOffline = snap?.databases?.filter((d) => d.stateDesc !== 'ONLINE').length ?? 0
        const lastSeen = summary?.collectedAt ? new Date(summary.collectedAt) : null

        let statusColor = tokens.color.dotUnknown
        if (s.unreachable) statusColor = tokens.color.dotOffline
        else if (snap) statusColor = tokens.color.dotOnline

        return {
          id: s.id,
          serverId: s.id,
          statusColor,
          serverName: getServerDisplayName({ ip: s.host ?? s.ip ?? '', port: s.port, alias: serverAliases[s.id] }),
          cpu,
          ramGb,
          blocking,
          dbOffline,
          alertCount,
          lastSeen
        }
      }),
    [servers, metricsMap, summaries, alertCountByServer, serverAliases]
  )

  const columns: GridColDef[] = [
    {
      field: 'statusColor',
      headerName: '',
      width: 28,
      sortable: false,
      renderCell: (params) => <StatusDot color={params.value as string} />
    },
    {
      field: 'serverName',
      headerName: 'Server',
      flex: 2,
      renderCell: (params) => (
        <Typography
          sx={{
            fontSize: tokens.font.sizeSm,
            color: tokens.color.textPrimary,
            fontWeight: tokens.font.weightMedium
          }}
        >
          {params.value as string}
        </Typography>
      )
    },
    {
      field: 'cpu',
      headerName: 'CPU %',
      width: 72,
      type: 'number',
      renderCell: (params) => {
        const v = params.value as number | null
        const color =
          v != null && v > 80
            ? tokens.color.danger
            : v != null && v > 60
              ? tokens.color.warning
              : tokens.color.accent
        return (
          <Typography
            sx={{ fontSize: tokens.font.sizeSm, color, fontVariantNumeric: 'tabular-nums' }}
          >
            {v != null ? `${v}%` : '—'}
          </Typography>
        )
      }
    },
    {
      field: 'ramGb',
      headerName: 'RAM GB',
      width: 80,
      renderCell: (params) => (
        <Typography
          sx={{
            fontSize: tokens.font.sizeSm,
            color: tokens.color.textPrimary,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {params.value != null ? (params.value as string) : '—'}
        </Typography>
      )
    },
    {
      field: 'blocking',
      headerName: 'Blocking',
      width: 80,
      type: 'number',
      renderCell: (params) => {
        const v = params.value as number
        return (
          <Typography
            sx={{
              fontSize: tokens.font.sizeSm,
              color: v > 0 ? tokens.color.danger : tokens.color.textMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {v}
          </Typography>
        )
      }
    },
    {
      field: 'dbOffline',
      headerName: 'DB Offline',
      width: 90,
      type: 'number',
      renderCell: (params) => {
        const v = params.value as number
        return (
          <Typography
            sx={{
              fontSize: tokens.font.sizeSm,
              color: v > 0 ? tokens.color.danger : tokens.color.textMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {v}
          </Typography>
        )
      }
    },
    {
      field: 'alertCount',
      headerName: 'Alerts',
      width: 68,
      type: 'number',
      renderCell: (params) => {
        const v = params.value as number
        return (
          <Typography
            sx={{
              fontSize: tokens.font.sizeSm,
              color: v > 0 ? tokens.color.warning : tokens.color.textMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {v > 0 ? v : '—'}
          </Typography>
        )
      }
    },
    {
      field: 'lastSeen',
      headerName: 'Last seen',
      flex: 1,
      renderCell: (params) => {
        const d = params.value as Date | null
        if (!d)
          return (
            <Typography sx={{ fontSize: tokens.font.sizeSm, color: tokens.color.textMuted }}>
              —
            </Typography>
          )
        const minAgo = Math.floor((Date.now() - d.getTime()) / 60_000)
        const label = minAgo < 2 ? 'just now' : `${minAgo}m ago`
        const color =
          minAgo < 5
            ? tokens.color.success
            : minAgo < 15
              ? tokens.color.textMuted
              : tokens.color.danger
        return (
          <Typography
            sx={{ fontSize: tokens.font.sizeSm, color, fontVariantNumeric: 'tabular-nums' }}
          >
            {label}
          </Typography>
        )
      }
    }
  ]

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

      {/* ---- DataGrid ---- */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowHeight={32}
          columnHeaderHeight={36}
          disableRowSelectionOnClick={false}
          hideFooter={rows.length <= 100}
          onRowClick={(params: GridRowParams) => {
            const serverId = params.row.serverId as string
            setSelectedServerId(serverId)
            onNavigateToServer(serverId)
          }}
          initialState={{ sorting: { sortModel: [{ field: 'serverName', sort: 'asc' }] } }}
          sx={{ height: '100%', border: `1px solid ${tokens.color.bgBorder}` }}
        />
      </Box>
    </Box>
  )
}
