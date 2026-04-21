import { useMemo, useState, useEffect, useCallback, memo } from 'react'
import { Box, Typography, Button, CircularProgress, Tooltip as MuiTooltip } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts'
import { useServersStore } from '../store/serversStore'
import { useMetricsStore } from '../store/metricsStore'
import { useGroupsStore } from '../store/groupsStore'
import { useAgStore } from '../store/agStore'
import { useAlertsStore } from '../store/alertsStore'
import { useRefreshAllServers } from '../hooks/useRefreshAllServers'
import { tokens } from '../styles/tokens'
import type { StoredServer, Alert, ServerMetrics } from '../../../preload/index'
import type { ServerSummary } from '../store/metricsStore'
import type { ServerGroup } from '../types/index'
import { HOSTING_BADGE } from '../constants/hosting'
import { useNow } from '../hooks/useNow'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dataAge(collectedAt: Date | string | undefined, now: number): { label: string; color: string } {
  if (!collectedAt) return { label: '—', color: 'rgba(128,128,128,0.4)' }
  const minAgo = Math.floor((now - new Date(collectedAt).getTime()) / 60_000)
  if (minAgo < 2)  return { label: 'just now',            color: '#107c10' }
  if (minAgo < 10) return { label: `${minAgo} min ago`, color: 'rgba(128,128,128,0.7)' }
  if (minAgo < 30) return { label: `${minAgo} min ago`, color: '#d83b01' }
  return                  { label: `${minAgo} min ago`, color: '#a4262c' }
}

// ---------------------------------------------------------------------------
// ServerRow — memoized table row
// Re-renders only when its own server data changes (Immer structural sharing).
// ---------------------------------------------------------------------------

interface ServerRowProps {
  s: StoredServer
  m: ServerMetrics | undefined
  summary: ServerSummary | undefined
  alertCount: { crit: number; warn: number } | undefined
  group: ServerGroup | undefined
  serverAlias: string | undefined
  now: number
  onNavigate: (id: string) => void
}

const ServerRow = memo(function ServerRow({
  s,
  m,
  summary,
  alertCount,
  group,
  serverAlias,
  now,
  onNavigate
}: ServerRowProps): React.JSX.Element {
  const key = `${s.host ?? s.ip}:${s.port}`
  const name = serverAlias || s.host || s.ip || key
  const cpu = m?.instanceInfo?.cpuUsagePercent
  const memPct = m
    ? Math.round((m.instanceInfo.memoryUsedMb / m.instanceInfo.memoryTargetMb) * 100)
    : null
  const dbCount = summary?.dbCount ?? null
  const age = dataAge(summary?.collectedAt, now)
  const critSrv = alertCount?.crit ?? 0
  const warnSrv = alertCount?.warn ?? 0
  const tipo = s.agGroupId
    ? s.agRole === 'PRIMARY'
      ? 'AG PRI'
      : s.agRole === 'SECONDARY'
        ? 'AG SEC'
        : 'AG RES'
    : 'Standalone'
  const uptime = m?.instanceInfo?.uptimeDays
  const rowBg = s.unreachable ? '#fde7e9' : 'transparent'

  return (
    <tr
      onClick={() => onNavigate(s.id)}
      style={{ backgroundColor: rowBg, cursor: 'pointer', transition: 'background-color 100ms' }}
      onMouseEnter={(e) => {
        if (!s.unreachable)
          (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'rgba(128,128,128,0.08)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = rowBg
      }}
    >
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          fontWeight: tokens.font.weightSemibold,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        <MuiTooltip title={name} placement="top" arrow>
          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        </MuiTooltip>
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          opacity: 0.7,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {group ? (
          <MuiTooltip title={group.name} placement="top" arrow>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: group.color }}>●</span> {group.name}
            </span>
          </MuiTooltip>
        ) : (
          '—'
        )}
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          whiteSpace: 'nowrap'
        }}
      >
        {(() => {
          const hBadge = HOSTING_BADGE[s.hostingType ?? 'on-premise']
          return (
            <span
              style={{
                display: 'inline-block',
                backgroundColor: hBadge.color,
                color: '#fff',
                fontWeight: tokens.font.weightBold,
                fontSize: 10,
                borderRadius: 3,
                padding: '1px 5px'
              }}
            >
              {hBadge.label}
            </span>
          )
        })()}
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          opacity: 0.7,
          whiteSpace: 'nowrap'
        }}
      >
        {tipo}
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          color:
            cpu === undefined
              ? 'rgba(128,128,128,0.5)'
              : cpu >= 80
                ? '#a4262c'
                : cpu >= 60
                  ? '#d83b01'
                  : undefined,
          fontWeight: cpu !== undefined && cpu >= 60 ? tokens.font.weightBold : tokens.font.weightRegular,
          whiteSpace: 'nowrap'
        }}
      >
        {cpu !== undefined ? `${Math.round(cpu * 10) / 10}%` : '—'}
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          color:
            memPct === null
              ? 'rgba(128,128,128,0.5)'
              : memPct >= 90
                ? '#a4262c'
                : undefined,
          whiteSpace: 'nowrap'
        }}
      >
        {memPct !== null ? `${memPct}%` : '—'}
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          whiteSpace: 'nowrap'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span>{dbCount !== null ? dbCount : '—'}</span>
          <span style={{ fontSize: 10, color: age.color, lineHeight: 1.2 }}>{age.label}</span>
        </div>
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center', minWidth: 0 }}>
          {critSrv > 0 && (
            <span
              style={{
                color: '#fff',
                background: '#a4262c',
                borderRadius: 3,
                padding: '1px 5px',
                fontSize: 10,
                fontWeight: tokens.font.weightBold,
                whiteSpace: 'nowrap'
              }}
            >
              {critSrv} CRIT
            </span>
          )}
          {warnSrv > 0 && (
            <span
              style={{
                color: '#fff',
                background: '#d83b01',
                borderRadius: 3,
                padding: '1px 5px',
                fontSize: 10,
                fontWeight: tokens.font.weightBold,
                whiteSpace: 'nowrap'
              }}
            >
              {warnSrv} WARN
            </span>
          )}
          {critSrv === 0 && warnSrv === 0 && (
            <span style={{ opacity: 0.4 }}>—</span>
          )}
        </div>
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          overflow: 'hidden'
        }}
      >
        {s.unreachable ? (
          <span
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#a4262c',
              fontWeight: tokens.font.weightBold,
              fontSize: tokens.font.sizeXs
            }}
          >
            ● OFFLINE
          </span>
        ) : m ? (
          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#107c10', fontWeight: tokens.font.weightBold, fontSize: tokens.font.sizeXs }}>
            ● ONLINE
          </span>
        ) : (
          <span
            style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.4, fontSize: tokens.font.sizeXs }}
          >
            ● UNKNOWN
          </span>
        )}
      </td>
      <td
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid rgba(128,128,128,0.2)',
          opacity: 0.7,
          whiteSpace: 'nowrap'
        }}
      >
        {uptime !== undefined ? `${uptime}d` : '—'}
      </td>
    </tr>
  )
})

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onNavigateToServer: (serverId: string) => void
  onNavigateToDiscovery: () => void
  onOpenAlerts: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serverKey(s: StoredServer): string {
  return `${s.host ?? s.ip}:${s.port}`
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatTimeShort(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// KpiCard
// ---------------------------------------------------------------------------

const KpiCard = memo(function KpiCard({
  label,
  value,
  borderColor,
  onClick
}: {
  label: string
  value: number | string
  borderColor: string
  onClick?: () => void
}): React.JSX.Element {
  return (
    <Box
      onClick={onClick}
      sx={{
        flex: '1 1 110px',
        minWidth: 100,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: `${tokens.radius.md}px`,
        p: 1.5,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: tokens.shadow.card,
        transition: 'all 0.18s ease',
        backgroundImage: `linear-gradient(135deg, transparent 55%, ${borderColor}0f 100%)`,
        '&:hover': onClick
          ? { boxShadow: tokens.shadow.cardHover, transform: 'translateY(-2px)' }
          : { boxShadow: tokens.shadow.elevated }
      }}
    >
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: tokens.font.weightBold,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          mb: 0.5
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{ fontSize: 28, fontWeight: tokens.font.weightBold, color: borderColor, lineHeight: 1 }}
      >
        {value}
      </Typography>
    </Box>
  )
})

// ---------------------------------------------------------------------------
// HomeDashboard
// ---------------------------------------------------------------------------

export function HomeDashboard({
  onNavigateToServer,
  onNavigateToDiscovery,
  onOpenAlerts
}: Props): React.JSX.Element {
  const servers = useServersStore((s) => s.servers)
  const lastUpdate = useMetricsStore((s) => s.lastUpdate)

  // Throttle: with 200+ servers every single received update re-triggers dashboard useMemo.
  // We cap at max 1 re-render/s — data in the ref is always kept current by applyDelta.
  const [metricsMap, setMetricsMap] = useState(() => useMetricsStore.getState().metricsMap)
  const [summaries, setSummaries] = useState(() => useMetricsStore.getState().summaries)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useMetricsStore.subscribe(() => {
      if (timer) return
      timer = setTimeout(() => {
        setMetricsMap(useMetricsStore.getState().metricsMap)
        setSummaries(useMetricsStore.getState().summaries)
        timer = null
      }, 1000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])
  const now = useNow()
  const { groups, serverGroups, serverAliases } = useGroupsStore()
  const { agGroups } = useAgStore()
  const alerts = useAlertsStore((s) => s.alerts)
  const { refreshing, handleRefresh } = useRefreshAllServers()

  // Pre-compute O(1) lookup maps so ServerRow doesn't run O(N) filter/find per render
  const alertCountByServer = useMemo(() => {
    const map: Record<string, { crit: number; warn: number }> = {}
    alerts.forEach((a) => {
      if (a.acknowledgedAt !== null) return
      if (!map[a.serverId]) map[a.serverId] = { crit: 0, warn: 0 }
      if (a.severity === 'CRITICAL') map[a.serverId].crit++
      else map[a.serverId].warn++
    })
    return map
  }, [alerts])

  const agGroupByServerId = useMemo(() => {
    const map: Record<string, ServerGroup | undefined> = {}
    servers.forEach((s) => {
      const key = serverKey(s)
      const groupId = serverGroups[key]
      map[key] = groupId ? groups.find((g) => g.id === groupId) : undefined
    })
    return map
  }, [servers, serverGroups, groups])

  const handleNavigate = useCallback((id: string) => onNavigateToServer(id), [onNavigateToServer])

  // ---- Derived metrics (memoized) — must be before any early return ----
  const {
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
    offlineDbs
  } = useMemo(() => {
    const onlineCount = servers.filter((s) => !s.unreachable && metricsMap[serverKey(s)]).length
    const offlineCount = servers.filter((s) => s.unreachable).length
    const unreachableCount = servers.filter((s) => !s.unreachable && !metricsMap[serverKey(s)]).length
    const totalDbs = Object.values(summaries).reduce((acc, s) => acc + s.dbCount, 0)
    const activeAlerts: Alert[] = alerts.filter((a) => a.acknowledgedAt === null)
    const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length
    const warningCount = activeAlerts.filter((a) => a.severity === 'WARNING').length
    const firstOffline = servers.find((s) => s.unreachable)

    const donutData = [
      { name: 'Online', value: onlineCount, fill: '#107c10' },
      { name: 'Offline', value: offlineCount, fill: '#a4262c' },
      { name: 'Unreachable', value: unreachableCount, fill: '#d83b01' }
    ].filter((d) => d.value > 0)
    const donutFinal =
      donutData.length > 0 ? donutData : [{ name: 'None', value: 1, fill: '#e0e0e0' }]

    const cpuData = servers.map((s) => {
      const m = metricsMap[serverKey(s)]
      const cpu = m?.instanceInfo?.cpuUsagePercent ?? 0
      const hasData = !!m
      return {
        name: serverAliases[serverKey(s)] || s.host || s.ip || serverKey(s),
        cpu: hasData ? Math.round(cpu * 10) / 10 : 0,
        fill: cpu < 60 ? '#107c10' : cpu < 80 ? '#d83b01' : '#a4262c',
        hasData
      }
    })

    const hasCpuData = cpuData.some((d) => d.hasData)
    const cpuChartHeight = Math.max(180, servers.length * 40)

    const recentAlerts = [...activeAlerts]
      .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
      .slice(0, 10)

    const offlineDbs = servers.flatMap((s) => {
      const key = serverKey(s)
      const m = metricsMap[key]
      if (!m) return []
      const serverName = serverAliases[key] || s.host || s.ip || key
      return m.databases
        .filter((d) => d.stateDesc !== 'ONLINE')
        .map((d) => ({ name: d.name, serverName, serverId: key, serverRecordId: s.id, stateDesc: d.stateDesc, offlineSince: d.offlineSince }))
    })

    return {
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
      offlineDbs
    }
  }, [servers, metricsMap, summaries, alerts, serverAliases])

  // ---- Empty state — after all hooks ----
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
          Go to Discovery to add your SQL Servers
        </Typography>
        <Button variant="outlined" onClick={onNavigateToDiscovery}>
          → Go to Discovery
        </Button>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        p: 2,
        height: '100%',
        overflow: 'auto',
        gap: 2,
        boxSizing: 'border-box'
      }}
    >
      {/* ---- Row 1: Header ---- */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography
          sx={{
            fontSize: tokens.font.sizeLg,
            fontWeight: tokens.font.weightBold,
            color: 'text.primary'
          }}
        >
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
          onClick={
            firstOffline
              ? () => onNavigateToServer(firstOffline.id)
              : undefined
          }
        />
        <KpiCard label="DATABASE" value={totalDbs} borderColor="#0078d4" />
        <KpiCard
          label="ALERTS"
          value={activeAlerts.length}
          borderColor={
            criticalCount > 0 ? '#a4262c' : warningCount > 0 ? '#d83b01' : '#107c10'
          }
          onClick={onOpenAlerts}
        />
        <KpiCard
          label="AG CLUSTER"
          value={Object.keys(agGroups).length}
          borderColor="#8764b8"
        />
      </Box>

      {/* ---- Row 3: Charts ---- */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {/* Donut chart */}
        <Box
          sx={{
            flex: '0 0 260px',
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderTop: `3px solid ${tokens.color.primary}`,
            borderRadius: `${tokens.radius.md}px`,
            boxShadow: tokens.shadow.elevated,
            p: 1.5
          }}
        >
          <Typography
            sx={{
              fontSize: tokens.font.sizeXs,
              fontWeight: tokens.font.weightBold,
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              mb: 1
            }}
          >
            Server status
          </Typography>
          <Box sx={{ position: 'relative', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutFinal}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {donutFinal.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: tokens.font.sizeSm,
                    border: '1px solid rgba(128,128,128,0.3)',
                    borderRadius: tokens.radius.sm
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center text overlay */}
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none'
              }}
            >
              <Typography
                sx={{ fontSize: 28, fontWeight: tokens.font.weightBold, color: 'text.primary', lineHeight: 1 }}
              >
                {servers.length}
              </Typography>
              <Typography
                sx={{
                  fontSize: 10,
                  fontWeight: tokens.font.weightBold,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em'
                }}
              >
                SERVER
              </Typography>
            </Box>
          </Box>
          {/* Legend */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
            {[
              { label: 'Online', color: '#107c10', value: onlineCount },
              { label: 'Offline', color: '#a4262c', value: offlineCount },
              { label: 'Unreachable', color: '#d83b01', value: unreachableCount }
            ].map((item) => (
              <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: item.color,
                    flexShrink: 0,
                    boxShadow: item.label === 'Online'
                      ? tokens.shadow.dotGlowSuccess
                      : item.label === 'Unreachable'
                        ? tokens.shadow.dotGlowWarning
                        : tokens.shadow.dotGlowError,
                  }}
                />
                <Typography
                  sx={{ fontSize: tokens.font.sizeXs, color: 'text.secondary', flex: 1 }}
                >
                  {item.label}
                </Typography>
                <Typography sx={{ fontSize: tokens.font.sizeXs, fontWeight: tokens.font.weightBold, color: 'text.primary' }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>

        {/* CPU bar chart */}
        <Box
          sx={{
            flex: 1,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderTop: `3px solid ${tokens.color.chartCpu}`,
            borderRadius: `${tokens.radius.md}px`,
            boxShadow: tokens.shadow.elevated,
            p: 1.5,
            minWidth: 200,
            overflow: 'hidden'
          }}
        >
          <Typography
            sx={{
              fontSize: tokens.font.sizeXs,
              fontWeight: tokens.font.weightBold,
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              mb: 1
            }}
          >
            CPU % per server
          </Typography>
          {!hasCpuData ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 180
              }}
            >
              <Typography sx={{ fontSize: tokens.font.sizeBase, color: 'text.secondary' }}>
                No metrics available
              </Typography>
            </Box>
          ) : (
            <ResponsiveContainer width="100%" height={cpuChartHeight}>
              <BarChart
                layout="vertical"
                data={cpuData}
                margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid horizontal={false} stroke={tokens.color.chartGrid} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: tokens.font.sizeXs, fill: '#94a3b8' }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fontSize: tokens.font.sizeXs, fill: '#94a3b8' }}
                />
                <Tooltip
                  formatter={(value) => [`${value}%`, 'CPU']}
                  contentStyle={{
                    fontSize: tokens.font.sizeSm,
                    border: '1px solid rgba(128,128,128,0.3)',
                    borderRadius: tokens.radius.sm
                  }}
                />
                <Bar dataKey="cpu" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                  {cpuData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Box>
      </Box>

      {/* ---- Row 4: Server table + Alerts feed ---- */}
      <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
        {/* Server table */}
        <Box
          sx={{
            flex: 1,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: `${tokens.radius.md}px`,
            boxShadow: tokens.shadow.elevated,
            overflow: 'auto',
            minWidth: 0
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: tokens.font.sizeSm,
              tableLayout: 'fixed'
            }}
          >
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '7%' }} />
            </colgroup>
            <thead>
              <tr
                style={{
                  position: 'sticky',
                  top: 0,
                  backgroundColor: 'transparent',
                  zIndex: 1
                }}
              >
                {[
                  'SERVER',
                  'ENVIRONMENT',
                  'INFRASTRUCTURE',
                  'TYPE',
                  'CPU%',
                  'MEM%',
                  'DB',
                  'ALERTS',
                  'STATUS',
                  'UPTIME'
                ].map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: '6px 8px',
                      textAlign: 'left',
                      fontWeight: tokens.font.weightBold,
                      fontSize: tokens.font.sizeXs,
                      color: 'inherit',
                      opacity: 0.6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: '1px solid rgba(128,128,128,0.2)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => {
                const key = serverKey(s)
                return (
                  <ServerRow
                    key={s.id}
                    s={s}
                    m={metricsMap[key]}
                    summary={summaries[key]}
                    alertCount={alertCountByServer[key]}
                    group={agGroupByServerId[key]}
                    serverAlias={serverAliases[key]}
                    now={now}
                    onNavigate={handleNavigate}
                  />
                )
              })}
            </tbody>
          </table>
        </Box>

        {/* Alerts feed */}
        <Box
          sx={{
            width: 300,
            flexShrink: 0,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: `${tokens.radius.md}px`,
            boxShadow: tokens.shadow.elevated,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 1.5,
              py: 1,
              borderBottom: '1px solid',
              borderBottomColor: 'divider',
              flexShrink: 0,
              backgroundImage: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'linear-gradient(135deg, rgba(164,38,44,0.08) 0%, transparent 100%)'
                  : 'linear-gradient(135deg, rgba(164,38,44,0.05) 0%, transparent 100%)',
            }}
          >
            <Typography
              sx={{
                fontSize: tokens.font.sizeXs,
                fontWeight: tokens.font.weightBold,
                color: 'text.secondary',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              Recent alerts
            </Typography>
            <Box
              onClick={onOpenAlerts}
              sx={{
                fontSize: tokens.font.sizeXs,
                color: tokens.color.primary,
                cursor: 'pointer',
                '&:hover': { textDecoration: 'underline' }
              }}
            >
              All →
            </Box>
          </Box>

          {/* Alert list */}
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {recentAlerts.length === 0 ? (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  p: 2
                }}
              >
                <Typography sx={{ fontSize: tokens.font.sizeBase, color: 'text.secondary' }}>
                  No active alerts
                </Typography>
              </Box>
            ) : (
              recentAlerts.map((alert: Alert) => {
                const srvForAlert = servers.find((sv) => serverKey(sv) === alert.serverId)
                const alertSrvName = srvForAlert
                  ? serverAliases[alert.serverId] ||
                    srvForAlert.host ||
                    srvForAlert.ip ||
                    alert.serverId
                  : alert.serverId
                const alertBorderColor =
                  alert.severity === 'CRITICAL' ? '#a4262c' : '#d83b01'

                return (
                  <Box
                    key={alert.id}
                    onClick={() => {
                      if (srvForAlert) onNavigateToServer(srvForAlert.id)
                    }}
                    sx={{
                      borderLeft: `4px solid ${alertBorderColor}`,
                      px: 1.5,
                      py: 0.75,
                      borderBottom: '1px solid',
                      borderBottomColor: 'divider',
                      cursor: srvForAlert ? 'pointer' : 'default',
                      transition: 'background-color 0.12s ease',
                      backgroundImage: `linear-gradient(90deg, ${alertBorderColor}0a 0%, transparent 40%)`,
                      '&:hover': srvForAlert ? { bgcolor: 'action.hover' } : undefined
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        mb: 0.25
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: 10,
                          color: 'text.secondary',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {formatTimeShort(new Date(alert.detectedAt))}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: tokens.font.sizeXs,
                          fontWeight: tokens.font.weightSemibold,
                          color: 'text.primary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 160,
                          ml: 0.5
                        }}
                      >
                        {alertSrvName}
                      </Typography>
                    </Box>
                    <Typography
                      sx={{
                        fontSize: tokens.font.sizeXs,
                        color: 'text.secondary',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {alert.message}
                    </Typography>
                  </Box>
                )
              })
            )}
          </Box>
        </Box>
      </Box>

      {/* ---- Row 5: Offline databases ---- */}
      {offlineDbs.length > 0 && (
        <Box
          sx={{
            mx: 0,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderLeft: '4px solid #a4262c',
            borderRadius: `${tokens.radius.md}px`,
            boxShadow: tokens.shadow.elevated,
            overflow: 'hidden',
            flexShrink: 0
          }}
        >
          {/* Header */}
          <Box
            sx={{
              px: 2,
              py: 1,
              borderBottom: '1px solid',
              borderBottomColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              backgroundImage: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'linear-gradient(135deg, rgba(164,38,44,0.10) 0%, transparent 100%)'
                  : 'linear-gradient(135deg, rgba(164,38,44,0.06) 0%, transparent 100%)'
            }}
          >
            <Typography
              sx={{
                fontSize: tokens.font.sizeXs,
                fontWeight: tokens.font.weightBold,
                color: '#a4262c',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              Databases not online
            </Typography>
            <Box
              sx={{
                ml: 0.5,
                px: 0.75,
                py: 0.1,
                bgcolor: '#a4262c',
                color: '#fff',
                borderRadius: 1,
                fontSize: 10,
                fontWeight: tokens.font.weightBold,
                lineHeight: 1.6
              }}
            >
              {offlineDbs.length}
            </Box>
          </Box>

          {/* Table */}
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: tokens.font.sizeSm,
              tableLayout: 'fixed'
            }}
          >
            <thead>
              <tr>
                {['DATABASE', 'SERVER', 'STATUS', 'OFFLINE SINCE'].map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: '5px 10px',
                      textAlign: 'left',
                      fontWeight: tokens.font.weightBold,
                      fontSize: tokens.font.sizeXs,
                      opacity: 0.6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: '1px solid rgba(128,128,128,0.2)',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offlineDbs.map((db, i) => (
                <tr
                  key={`${db.serverId}/${db.name}`}
                  onClick={() => onNavigateToServer(db.serverRecordId)}
                  style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(164,38,44,0.03)', cursor: 'pointer' }}
                >
                  <td
                    style={{
                      padding: '5px 10px',
                      borderBottom: '1px solid rgba(128,128,128,0.1)',
                      fontWeight: tokens.font.weightSemibold,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {db.name}
                  </td>
                  <td
                    style={{
                      padding: '5px 10px',
                      borderBottom: '1px solid rgba(128,128,128,0.1)',
                      opacity: 0.75,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {db.serverName}
                  </td>
                  <td
                    style={{
                      padding: '5px 10px',
                      borderBottom: '1px solid rgba(128,128,128,0.1)',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: tokens.font.weightBold,
                        background: db.stateDesc === 'OFFLINE' ? '#a4262c' : '#d83b01',
                        color: '#fff'
                      }}
                    >
                      {db.stateDesc}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '5px 10px',
                      borderBottom: '1px solid rgba(128,128,128,0.1)',
                      whiteSpace: 'nowrap',
                      color: db.offlineSince ? 'inherit' : 'rgba(128,128,128,0.5)',
                      fontSize: tokens.font.sizeSm
                    }}
                  >
                    {db.offlineSince
                      ? new Date(db.offlineSince).toLocaleString('en-US', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : 'before last restart'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Box>
  )
}
