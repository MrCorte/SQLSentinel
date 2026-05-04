import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { useAlertsStore } from '../../store/alertsStore'
import { tokens } from '../../styles/tokens'

const SECTION_NAMES: Record<number, string> = {
  0: 'Overview',
  1: 'Discovery',
  2: 'Inventory',
  3: 'Dashboard',
  4: 'Settings'
}

interface Props {
  activeTab: number
  selectedServerName: string | null
  onOpenAlerts: () => void
  onOpenAI: () => void
}

export function BreadcrumbBar({
  activeTab,
  selectedServerName,
  onOpenAlerts,
  onOpenAI
}: Props): React.JSX.Element {
  const criticalCount = useAlertsStore((s) =>
    s.alerts.filter((a) => a.severity === 'CRITICAL' && a.acknowledgedAt === null).length
  )
  const warningCount = useAlertsStore((s) =>
    s.alerts.filter((a) => a.severity === 'WARNING' && a.acknowledgedAt === null).length
  )

  const sectionName = SECTION_NAMES[activeTab] ?? 'SQLSentinel'
  const hasAlerts = criticalCount > 0 || warningCount > 0
  const alertLabel = criticalCount > 0 ? `${criticalCount} critical` : `${warningCount} warning`
  const alertColor = criticalCount > 0 ? tokens.color.danger : tokens.color.warning

  return (
    <Box
      sx={{
        height: tokens.size.breadcrumbHeight,
        minHeight: tokens.size.breadcrumbHeight,
        bgcolor: tokens.color.bgSurface,
        borderBottom: `1px solid ${tokens.color.bgBorder}`,
        display: 'flex',
        alignItems: 'center',
        px: 1.5,
        gap: 0.5,
        flexShrink: 0
      }}
    >
      {/* Breadcrumb left */}
      <Typography sx={{ fontSize: tokens.font.sizeXs, color: tokens.color.textMuted }}>
        {sectionName}
      </Typography>
      {selectedServerName && (
        <>
          <Typography sx={{ fontSize: tokens.font.sizeXs, color: tokens.color.bgBorder, mx: 0.5 }}>
            ›
          </Typography>
          <Typography
            sx={{
              fontSize: tokens.font.sizeXs,
              color: tokens.color.textPrimary,
              fontWeight: tokens.font.weightMedium
            }}
          >
            {selectedServerName}
          </Typography>
        </>
      )}

      {/* Right side */}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {hasAlerts && (
          <Tooltip title="Open alerts" placement="bottom">
            <Box
              onClick={onOpenAlerts}
              sx={{
                fontSize: tokens.font.sizeXs,
                fontWeight: tokens.font.weightMedium,
                color: alertColor,
                bgcolor: `${alertColor}20`,
                border: `1px solid ${alertColor}40`,
                borderRadius: '10px',
                px: 1,
                py: 0.25,
                cursor: 'pointer',
                userSelect: 'none',
                lineHeight: 1.4,
                '&:hover': { bgcolor: `${alertColor}30` }
              }}
            >
              ● {alertLabel}
            </Box>
          </Tooltip>
        )}

        <Tooltip title="AI Assistant" placement="bottom">
          <IconButton
            size="small"
            onClick={onOpenAI}
            aria-label="Open AI assistant"
            sx={{ color: tokens.color.textMuted }}
          >
            <SmartToyIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}
