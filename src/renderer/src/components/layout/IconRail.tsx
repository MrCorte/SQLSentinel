import { Box, Tooltip, Badge } from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import SearchIcon from '@mui/icons-material/Search'
import StorageIcon from '@mui/icons-material/Storage'
import BarChartIcon from '@mui/icons-material/BarChart'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import SettingsIcon from '@mui/icons-material/Settings'
import { tokens } from '../../styles/tokens'

const SECTIONS = [
  { tab: 0, label: 'Overview', icon: DashboardIcon },
  { tab: 1, label: 'Discovery', icon: SearchIcon },
  { tab: 2, label: 'Inventory', icon: StorageIcon },
  { tab: 3, label: 'Dashboard', icon: BarChartIcon },
  { tab: 5, label: 'Incidents', icon: WarningAmberIcon }
]

interface Props {
  activeTab: number
  onTabChange: (tab: number) => void
  onSettingsClick: () => void
  incidentBadge?: number
}

export function IconRail({ activeTab, onTabChange, onSettingsClick, incidentBadge = 0 }: Props): React.JSX.Element {
  return (
    <Box
      sx={{
        width: tokens.size.railWidth,
        minWidth: tokens.size.railWidth,
        height: '100vh',
        bgcolor: tokens.color.bgSurface,
        borderRight: `1px solid ${tokens.color.bgBorder}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 1,
        gap: 0.5,
        flexShrink: 0,
        zIndex: 200
      }}
    >
      {/* Logo — keyboard-activatable, navigates to Overview */}
      <Box
        component="button"
        type="button"
        onClick={() => onTabChange(0)}
        aria-label="Go to overview"
        sx={{
          mb: 1.5,
          cursor: 'pointer',
          flexShrink: 0,
          display: 'flex',
          userSelect: 'none',
          background: 'transparent',
          border: 'none',
          padding: 0,
          '&:focus-visible': {
            outline: `2px solid ${tokens.color.accent}`,
            outlineOffset: 2,
            borderRadius: 4
          }
        }}
      >
        <svg viewBox="0 0 56 56" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ss-logo-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2b8bd6" />
              <stop offset="100%" stopColor="#005a9e" />
            </linearGradient>
          </defs>
          <g transform="translate(4,4)">
            <path d="M24 0 L48 6 V26 C48 37 38 45 24 48 C10 45 0 37 0 26 V6 Z" fill="url(#ss-logo-grad)" />
            <g fill="#ffffff" transform="translate(0,10)">
              <ellipse cx="24" cy="5" rx="11" ry="2.6" />
              <path d="M13 5 V9 C13 10.6 18 12 24 12 C30 12 35 10.6 35 9 V5" fill="rgba(255,255,255,0.85)" />
              <ellipse cx="24" cy="14" rx="11" ry="2.6" opacity="0.9" />
              <path d="M13 14 V18 C13 19.6 18 21 24 21 C30 21 35 19.6 35 18 V14" fill="rgba(255,255,255,0.7)" />
              <ellipse cx="24" cy="23" rx="11" ry="2.6" opacity="0.8" />
              <path d="M13 23 V27 C13 28.6 18 30 24 30 C30 30 35 28.6 35 27 V23" fill="rgba(255,255,255,0.55)" />
            </g>
          </g>
        </svg>
      </Box>

      {/* Nav icons */}
      {SECTIONS.map(({ tab, label, icon: Icon }) => {
        const isActive = activeTab === tab
        const showBadge = tab === 5 && incidentBadge > 0
        return (
          <Tooltip key={tab} title={label} placement="right" arrow>
            <Box
              component="button"
              type="button"
              onClick={() => onTabChange(tab)}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              sx={{
                width: 34,
                height: 34,
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                background: isActive ? tokens.color.accentAlpha12 : 'transparent',
                border: isActive
                  ? `1px solid ${tokens.color.accentAlpha40}`
                  : '1px solid transparent',
                color: isActive ? tokens.color.accent : tokens.color.textMuted,
                transition: 'all 0.15s ease',
                padding: 0,
                '&:hover': {
                  bgcolor: tokens.color.accentAlpha12,
                  color: tokens.color.textPrimary
                },
                '&:focus-visible': {
                  outline: `2px solid ${tokens.color.accent}`,
                  outlineOffset: 2
                }
              }}
            >
              <Badge
                badgeContent={showBadge ? incidentBadge : 0}
                color="error"
                max={99}
                sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 14, minWidth: 14, p: '0 3px' } }}
              >
                <Icon sx={{ fontSize: 18 }} />
              </Badge>
            </Box>
          </Tooltip>
        )
      })}

      {/* Settings — pinned to bottom */}
      <Tooltip title="Settings" placement="right" arrow>
        <Box
          component="button"
          type="button"
          onClick={onSettingsClick}
          aria-label="Settings"
          aria-current={activeTab === 4 ? 'page' : undefined}
          sx={{
            mt: 'auto',
            width: 34,
            height: 34,
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            background: activeTab === 4 ? tokens.color.accentAlpha12 : 'transparent',
            border: activeTab === 4
              ? `1px solid ${tokens.color.accentAlpha40}`
              : '1px solid transparent',
            color: activeTab === 4 ? tokens.color.accent : tokens.color.textMuted,
            transition: 'all 0.15s ease',
            padding: 0,
            '&:hover': { bgcolor: tokens.color.accentAlpha12, color: tokens.color.textPrimary },
            '&:focus-visible': {
              outline: `2px solid ${tokens.color.accent}`,
              outlineOffset: 2
            }
          }}
        >
          <SettingsIcon sx={{ fontSize: 18 }} />
        </Box>
      </Tooltip>
    </Box>
  )
}
