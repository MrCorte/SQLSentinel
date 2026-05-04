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
          component="button"
          type="button"
          onClick={onOpenAlerts}
          aria-label="Open all alerts"
          sx={{
            fontSize: tokens.font.sizeXs,
            color: tokens.color.primary,
            cursor: 'pointer',
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontFamily: 'inherit',
            '&:hover': { textDecoration: 'underline' },
            '&:focus-visible': {
              outline: `2px solid ${tokens.color.primary}`,
              outlineOffset: 1,
              borderRadius: 2
            }
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

            const isClickable = !!srvForAlert
            const handleNavigate = (): void => {
              if (srvForAlert) onNavigateToServer(srvForAlert.id)
            }
            return (
              <Box
                key={alert.id}
                {...(isClickable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      onClick: handleNavigate,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleNavigate()
                        }
                      },
                      'aria-label': `Open ${alertSrvName} — ${alert.message}`
                    }
                  : {})}
                sx={{
                  borderLeft: `4px solid ${alertBorderColor}`,
                  px: 1.5,
                  py: 0.75,
                  borderBottom: '1px solid',
                  borderBottomColor: tokens.color.bgBorder,
                  cursor: isClickable ? 'pointer' : 'default',
                  transition: 'background-color 0.12s ease',
                  backgroundImage: `linear-gradient(90deg, ${alertBorderColor}0a 0%, transparent 40%)`,
                  '&:hover': isClickable ? { bgcolor: tokens.color.bgBorder } : undefined,
                  '&:focus-visible': isClickable
                    ? { outline: `2px solid ${alertBorderColor}`, outlineOffset: -2 }
                    : undefined
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
