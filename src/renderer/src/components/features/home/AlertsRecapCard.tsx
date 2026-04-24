import { useMemo } from 'react'
import { Box, Typography, Tooltip } from '@mui/material'
import { useAlertsStore } from '../../../store/alertsStore'
import { useServersStore } from '../../../store/serversStore'
import { useGroupsStore } from '../../../store/groupsStore'
import { tokens } from '../../../styles/tokens'
import type { Alert } from '../../../../../preload/index'

type AlertCategory = Alert['category']

const CATEGORIES: { key: AlertCategory; label: string }[] = [
  { key: 'cpu_high', label: 'CPU High' },
  { key: 'blocking_sessions', label: 'Blocking' },
  { key: 'database_offline', label: 'DB Offline' },
  { key: 'backup_overdue', label: 'Backup' },
  { key: 'disk_space_low', label: 'Disk' }
]

function relativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function AlertsRecapCard(): React.JSX.Element {
  const alerts = useAlertsStore((s) => s.alerts)
  const servers = useServersStore((s) => s.servers)
  const serverAliases = useGroupsStore((s) => s.serverAliases)

  // serverId (ip:port) → display name
  const serverNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of servers) {
      const key = `${s.host ?? s.ip}:${s.port}`
      map[key] = serverAliases[s.id] ?? key
    }
    return map
  }, [servers, serverAliases])

  // Count per category
  const categoryCounts = useMemo(() => {
    const counts: Record<AlertCategory, { crit: number; warn: number }> = {
      cpu_high: { crit: 0, warn: 0 },
      blocking_sessions: { crit: 0, warn: 0 },
      database_offline: { crit: 0, warn: 0 },
      backup_overdue: { crit: 0, warn: 0 },
      disk_space_low: { crit: 0, warn: 0 }
    }
    for (const a of alerts) {
      if (a.severity === 'CRITICAL') counts[a.category].crit++
      else counts[a.category].warn++
    }
    return counts
  }, [alerts])

  // Last 5: unacknowledged first, then by detectedAt desc
  const recentAlerts = useMemo(
    () =>
      [...alerts]
        .sort((a, b) => {
          if (!a.acknowledgedAt && b.acknowledgedAt) return -1
          if (a.acknowledgedAt && !b.acknowledgedAt) return 1
          return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
        })
        .slice(0, 5),
    [alerts]
  )

  return (
    <Box
      sx={{
        bgcolor: tokens.color.bgSurface,
        border: `1px solid ${tokens.color.bgBorder}`,
        borderTop: `3px solid ${tokens.color.danger}`,
        borderRadius: `${tokens.radius.md}px`,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%'
      }}
    >
      {/* Card title */}
      <Typography
        sx={{
          fontSize: tokens.font.sizeXs,
          fontWeight: tokens.font.weightSemibold,
          color: tokens.color.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          mb: 1,
          flexShrink: 0
        }}
      >
        Alerts
      </Typography>

      {/* Zone A — category badges */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1, flexShrink: 0 }}>
        {CATEGORIES.map(({ key, label }) => {
          const counts = categoryCounts[key]
          const hasAlerts = counts.crit + counts.warn > 0
          return (
            <Box
              key={key}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.75,
                py: 0.25,
                borderRadius: '4px',
                bgcolor: hasAlerts ? `${tokens.color.bgBorder}` : 'transparent',
                border: `1px solid ${hasAlerts ? tokens.color.bgBorder : 'transparent'}`,
                opacity: hasAlerts ? 1 : 0.35
              }}
            >
              <Typography
                sx={{ fontSize: 10, color: tokens.color.textMuted, fontWeight: tokens.font.weightMedium }}
              >
                {label}
              </Typography>
              {counts.crit > 0 && (
                <Typography sx={{ fontSize: 10, fontWeight: tokens.font.weightBold, color: tokens.color.danger }}>
                  {counts.crit}
                </Typography>
              )}
              {counts.warn > 0 && (
                <Typography sx={{ fontSize: 10, fontWeight: tokens.font.weightBold, color: tokens.color.warning }}>
                  {counts.warn}
                </Typography>
              )}
            </Box>
          )
        })}
      </Box>

      {/* Zone B — recent alerts list */}
      {alerts.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: tokens.font.sizeSm, color: tokens.color.textMuted }}>
            No alerts
          </Typography>
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {recentAlerts.map((alert) => (
            <Tooltip key={alert.id} title={alert.message} placement="top" arrow disableInteractive>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  opacity: alert.acknowledgedAt ? 0.45 : 1
                }}
              >
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    flexShrink: 0,
                    bgcolor:
                      alert.severity === 'CRITICAL' ? tokens.color.danger : tokens.color.warning
                  }}
                />
                <Typography
                  sx={{
                    fontSize: 11,
                    color: tokens.color.textPrimary,
                    flexShrink: 0,
                    maxWidth: 90,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: tokens.font.weightMedium
                  }}
                >
                  {serverNameMap[alert.serverId] ?? alert.serverId}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 11,
                    color: tokens.color.textMuted,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {alert.message}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 10,
                    color: tokens.color.textMuted,
                    flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {relativeTime(alert.detectedAt)}
                </Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>
      )}
    </Box>
  )
}
