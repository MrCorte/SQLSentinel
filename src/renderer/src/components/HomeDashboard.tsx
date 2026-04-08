import { useMemo, useState, useEffect, memo } from 'react'
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
import type { StoredServer, Alert } from '../../../preload/index'
import { HOSTING_BADGE } from '../constants/hosting'

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
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatTimeShort(d: Date): string {
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
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
        borderTop: `3px solid ${borderColor}`,
        borderRadius: tokens.radius.sm,
        p: 1.5,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: tokens.shadow.card,
        transition: 'box-shadow 150ms',
        '&:hover': onClick ? { boxShadow: '0 2px 8px rgba(0,0,0,0.12)' } : undefined
      }}
    >
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: 700,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          mb: 0.5
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{ fontSize: 28, fontWeight: 700, color: 'text.primary', lineHeight: 1 }}
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

  // Throttle: con 200+ server ogni singolo update ricevuto riscatena useMemo del dashboard.
  // Limitiamo a max 1 re-render/s — i dati nel ref sono sempre aggiornati da applyDelta.
  const [metricsMap, setMetricsMap] = useState(() => useMetricsStore.getState().metricsMap)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useMetricsStore.subscribe(() => {
      if (timer) return
      timer = setTimeout(() => {
        setMetricsMap(useMetricsStore.getState().metricsMap)
        timer = null
      }, 1000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])
  const { groups, serverGroups, serverAliases } = useGroupsStore()
  const { agGroups } = useAgStore()
  const alerts = useAlertsStore((s) => s.alerts)
  const { refreshing, handleRefresh } = useRefreshAllServers()

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
    recentAlerts
  } = useMemo(() => {
    const onlineCount = servers.filter((s) => !s.unreachable && metricsMap[serverKey(s)]).length
    const offlineCount = servers.filter((s) => s.unreachable).length
    const unreachableCount = servers.filter((s) => !s.unreachable && !metricsMap[serverKey(s)]).length
    const totalDbs = Object.values(metricsMap).reduce((acc, m) => acc + (m.databases?.length ?? 0), 0)
    const activeAlerts: Alert[] = alerts.filter((a) => a.acknowledgedAt === null)
    const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length
    const warningCount = activeAlerts.filter((a) => a.severity === 'WARNING').length
    const firstOffline = servers.find((s) => s.unreachable)

    const donutData = [
      { name: 'Online', value: onlineCount, fill: '#107c10' },
      { name: 'Offline', value: offlineCount, fill: '#a4262c' },
      { name: 'Non raggiungibili', value: unreachableCount, fill: '#d83b01' }
    ].filter((d) => d.value > 0)
    const donutFinal =
      donutData.length > 0 ? donutData : [{ name: 'Nessuno', value: 1, fill: '#e0e0e0' }]

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
      recentAlerts
    }
  }, [servers, metricsMap, alerts, serverAliases])

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
          Nessun server monitorato
        </Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
          Vai alla Discovery per aggiungere i tuoi SQL Server
        </Typography>
        <Button variant="outlined" onClick={onNavigateToDiscovery}>
          → Vai alla Discovery
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
            Aggiornato: {lastUpdate ? formatTime(lastUpdate) : '—'}
          </Typography>
          <MuiTooltip title="Aggiorna metriche da tutti i server">
            <span>
              <Button
                size="small"
                variant="contained"
                startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />}
                onClick={handleRefresh}
                disabled={refreshing}
                sx={{ fontSize: 12, bgcolor: tokens.color.primary }}
              >
                {refreshing ? 'Aggiornamento…' : 'Aggiorna metriche'}
              </Button>
            </span>
          </MuiTooltip>
        </Box>
      </Box>

      {/* ---- Row 2: KPI Cards ---- */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <KpiCard label="SERVER TOTALI" value={servers.length} borderColor="#0078d4" />
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
          label="ALLARMI"
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
            borderRadius: tokens.radius.sm,
            boxShadow: tokens.shadow.card,
            p: 1.5
          }}
        >
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 700,
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              mb: 1
            }}
          >
            Stato server
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
                    fontSize: 12,
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
                sx={{ fontSize: 28, fontWeight: 700, color: 'text.primary', lineHeight: 1 }}
              >
                {servers.length}
              </Typography>
              <Typography
                sx={{
                  fontSize: 10,
                  fontWeight: 700,
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
              { label: 'Non raggiungibili', color: '#d83b01', value: unreachableCount }
            ].map((item) => (
              <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: item.color,
                    flexShrink: 0
                  }}
                />
                <Typography
                  sx={{ fontSize: 11, color: 'text.secondary', flex: 1 }}
                >
                  {item.label}
                </Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.primary' }}>
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
            borderRadius: tokens.radius.sm,
            boxShadow: tokens.shadow.card,
            p: 1.5,
            minWidth: 200,
            overflow: 'hidden'
          }}
        >
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 700,
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
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                Nessuna metrica disponibile
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
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                />
                <Tooltip
                  formatter={(value) => [`${value}%`, 'CPU']}
                  contentStyle={{
                    fontSize: 12,
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
            borderRadius: tokens.radius.sm,
            boxShadow: tokens.shadow.card,
            overflow: 'auto',
            minWidth: 0
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              tableLayout: 'fixed'
            }}
          >
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
                  'AMBIENTE',
                  'INFRASTRUTTURA',
                  'TIPO',
                  'CPU%',
                  'MEM%',
                  'DB',
                  'ALLARMI',
                  'STATO',
                  'UPTIME'
                ].map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: '6px 8px',
                      textAlign: 'left',
                      fontWeight: 700,
                      fontSize: 11,
                      color: 'inherit',
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
              {servers.map((s) => {
                const key = serverKey(s)
                const m = metricsMap[key]
                const groupId = serverGroups[key]
                const group = groups.find((g) => g.id === groupId)
                const alias = serverAliases[key]
                const name = alias || s.host || s.ip || key
                const cpu = m?.instanceInfo?.cpuUsagePercent
                const memPct =
                  m
                    ? Math.round(
                        (m.instanceInfo.memoryUsedMb / m.instanceInfo.memoryTargetMb) * 100
                      )
                    : null
                const dbCount = m?.databases?.length ?? null
                const srvAlerts = activeAlerts.filter((a) => a.serverId === key)
                const critSrv = srvAlerts.filter((a) => a.severity === 'CRITICAL').length
                const warnSrv = srvAlerts.filter((a) => a.severity === 'WARNING').length
                const tipo =
                  s.agGroupId
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
                    key={s.id}
                    onClick={() => onNavigateToServer(s.id)}
                    style={{
                      backgroundColor: rowBg,
                      cursor: 'pointer',
                      transition: 'background-color 100ms'
                    }}
                    onMouseEnter={(e) => {
                      if (!s.unreachable)
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                          'rgba(128,128,128,0.08)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLTableRowElement).style.backgroundColor = rowBg
                    }}
                  >
                    <td
                      style={{
                        padding: '5px 8px',
                        borderBottom: '1px solid rgba(128,128,128,0.2)',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {name}
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
                        <span>
                          <span style={{ color: group.color }}>●</span> {group.name}
                        </span>
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
                              fontWeight: 700,
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
                        fontWeight: cpu !== undefined && cpu >= 60 ? 700 : 400,
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
                      {dbCount !== null ? dbCount : '—'}
                    </td>
                    <td
                      style={{
                        padding: '5px 8px',
                        borderBottom: '1px solid rgba(128,128,128,0.2)',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {critSrv > 0 && (
                        <span
                          style={{
                            color: '#fff',
                            background: '#a4262c',
                            borderRadius: 3,
                            padding: '1px 5px',
                            fontSize: 10,
                            fontWeight: 700,
                            marginRight: 3
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
                            fontWeight: 700
                          }}
                        >
                          {warnSrv} WARN
                        </span>
                      )}
                      {critSrv === 0 && warnSrv === 0 && (
                        <span style={{ opacity: 0.4 }}>—</span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '5px 8px',
                        borderBottom: '1px solid rgba(128,128,128,0.2)',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {s.unreachable ? (
                        <span
                          style={{
                            color: '#a4262c',
                            fontWeight: 700,
                            fontSize: 11
                          }}
                        >
                          ● OFFLINE
                        </span>
                      ) : m ? (
                        <span style={{ color: '#107c10', fontWeight: 700, fontSize: 11 }}>
                          ● ONLINE
                        </span>
                      ) : (
                        <span
                          style={{ opacity: 0.4, fontSize: 11 }}
                        >
                          ● SCONOSCIUTO
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
                      {uptime !== undefined ? `${uptime}g` : '—'}
                    </td>
                  </tr>
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
            borderRadius: tokens.radius.sm,
            boxShadow: tokens.shadow.card,
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
              flexShrink: 0
            }}
          >
            <Typography
              sx={{
                fontSize: 11,
                fontWeight: 700,
                color: 'text.secondary',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              Allarmi recenti
            </Typography>
            <Box
              onClick={onOpenAlerts}
              sx={{
                fontSize: 11,
                color: tokens.color.primary,
                cursor: 'pointer',
                '&:hover': { textDecoration: 'underline' }
              }}
            >
              Tutti →
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
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                  Nessun allarme attivo
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
                      borderLeft: `3px solid ${alertBorderColor}`,
                      px: 1.5,
                      py: 0.75,
                      borderBottom: '1px solid',
                      borderBottomColor: 'divider',
                      cursor: srvForAlert ? 'pointer' : 'default',
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
                          fontSize: 11,
                          fontWeight: 600,
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
                        fontSize: 11,
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
    </Box>
  )
}
