import { Box, Tooltip } from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import SearchIcon from '@mui/icons-material/Search'
import StorageIcon from '@mui/icons-material/Storage'
import BarChartIcon from '@mui/icons-material/BarChart'
import SettingsIcon from '@mui/icons-material/Settings'
import { tokens } from '../../styles/tokens'

const SECTIONS = [
  { tab: 0, label: 'Overview', icon: DashboardIcon },
  { tab: 1, label: 'Discovery', icon: SearchIcon },
  { tab: 2, label: 'Inventory', icon: StorageIcon },
  { tab: 3, label: 'Dashboard', icon: BarChartIcon }
]

interface Props {
  activeTab: number
  onTabChange: (tab: number) => void
  onSettingsClick: () => void
}

export function IconRail({ activeTab, onTabChange, onSettingsClick }: Props): React.JSX.Element {
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
      {/* Logo — background reacts to --color-accent */}
      <Box
        onClick={() => onTabChange(0)}
        sx={{
          width: 26,
          height: 26,
          borderRadius: '6px',
          background: 'var(--color-accent, #00d4aa)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 1.5,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.3s ease'
        }}
      >
        <Box
          component="span"
          sx={{
            fontSize: 9,
            fontWeight: 800,
            color: tokens.color.textOnAccent,
            fontFamily: tokens.font.family,
            lineHeight: 1,
            userSelect: 'none'
          }}
        >
          SS
        </Box>
      </Box>

      {/* Nav icons */}
      {SECTIONS.map(({ tab, label, icon: Icon }) => {
        const isActive = activeTab === tab
        return (
          <Tooltip key={tab} title={label} placement="right" arrow>
            <Box
              onClick={() => onTabChange(tab)}
              sx={{
                width: 34,
                height: 34,
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                bgcolor: isActive ? tokens.color.accentAlpha12 : 'transparent',
                border: isActive
                  ? `1px solid ${tokens.color.accentAlpha40}`
                  : '1px solid transparent',
                color: isActive ? tokens.color.accent : tokens.color.textMuted,
                transition: 'all 0.15s ease',
                '&:hover': {
                  bgcolor: tokens.color.accentAlpha12,
                  color: tokens.color.textPrimary
                }
              }}
            >
              <Icon sx={{ fontSize: 18 }} />
            </Box>
          </Tooltip>
        )
      })}

      {/* Settings — pinned to bottom */}
      <Tooltip title="Settings" placement="right" arrow>
        <Box
          onClick={onSettingsClick}
          sx={{
            mt: 'auto',
            width: 34,
            height: 34,
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            bgcolor: activeTab === 4 ? tokens.color.accentAlpha12 : 'transparent',
            border: activeTab === 4
              ? `1px solid ${tokens.color.accentAlpha40}`
              : '1px solid transparent',
            color: activeTab === 4 ? tokens.color.accent : tokens.color.textMuted,
            transition: 'all 0.15s ease',
            '&:hover': { bgcolor: tokens.color.accentAlpha12, color: tokens.color.textPrimary }
          }}
        >
          <SettingsIcon sx={{ fontSize: 18 }} />
        </Box>
      </Tooltip>
    </Box>
  )
}
