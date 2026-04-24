import { Box, Typography } from '@mui/material'
import { tokens } from '../../../styles/tokens'
import { serverKey, formatTimeShort } from './useHomeDashboard'
import type { Alert, StoredServer } from '../../../../../preload/index'

// ---------------------------------------------------------------------------
// AlertsFeed — recent alerts panel (right sidebar of home dashboard)
// ---------------------------------------------------------------------------

export interface AlertsFeedProps {
  recentAlerts: Alert[]
  servers: StoredServer[]
  serverAliases: Record<string, string>
  onOpenAlerts: () => void
  onNavigateToServer: (id: string) => void
}

export function AlertsFeed({
  recentAlerts,
  servers,
  serverAliases,
  onOpenAlerts,
  onNavigateToServer
}: AlertsFeedProps): React.JSX.Element {
  return (
    <Box
      sx={{
        width: 300,
        flexShrink: 0,
        bgcolor: tokens.color.bgSurface,
        border: `1px solid ${tokens.color.bgBorder}`,
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
          borderBottomColor: tokens.color.bgBorder,
          flexShrink: 0,
          backgroundImage: 'linear-gradient(135deg, rgba(247,129,102,0.07) 0%, transparent 100%)'
        }}
      >
        <Typography
          sx={{
            fontSize: tokens.font.sizeXs,
            fontWeight: tokens.font.weightBold,
            color: tokens.color.textMuted,
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
            <Typography sx={{ fontSize: tokens.font.sizeBase, color: tokens.color.textMuted }}>
              No active alerts
            </Typography>
          </Box>
        ) : (
          recentAlerts.map((alert: Alert) => {
            const srvForAlert = servers.find((sv) => serverKey(sv) === alert.serverId)
            const alertSrvName = srvForAlert
              ? serverAliases[srvForAlert.id] ||
                srvForAlert.host ||
                srvForAlert.ip ||
                alert.serverId
              : alert.serverId
            const alertBorderColor = alert.severity === 'CRITICAL' ? tokens.color.danger : tokens.color.dotWarning

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
                  borderBottomColor: tokens.color.bgBorder,
                  cursor: srvForAlert ? 'pointer' : 'default',
                  transition: 'background-color 0.12s ease',
                  backgroundImage: `linear-gradient(90deg, ${alertBorderColor}0a 0%, transparent 40%)`,
                  '&:hover': srvForAlert ? { bgcolor: tokens.color.bgBorder } : undefined
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
                  <Typography sx={{ fontSize: 10, color: tokens.color.textMuted, whiteSpace: 'nowrap' }}>
                    {formatTimeShort(new Date(alert.detectedAt))}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: tokens.font.sizeXs,
                      fontWeight: tokens.font.weightSemibold,
                      color: tokens.color.textPrimary,
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
                    color: tokens.color.textMuted,
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
  )
}
