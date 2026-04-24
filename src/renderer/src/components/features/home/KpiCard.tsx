import { memo } from 'react'
import { Box, Typography } from '@mui/material'
import { tokens } from '../../../styles/tokens'

// ---------------------------------------------------------------------------
// KpiCard — memoized KPI summary card
// ---------------------------------------------------------------------------

export interface KpiCardProps {
  label: string
  value: number | string
  borderColor: string
  onClick?: () => void
}

export const KpiCard = memo(function KpiCard({
  label,
  value,
  borderColor,
  onClick
}: KpiCardProps): React.JSX.Element {
  return (
    <Box
      onClick={onClick}
      sx={{
        flex: '1 1 110px',
        minWidth: 100,
        bgcolor: tokens.color.bgSurface,
        border: '1px solid',
        borderColor: tokens.color.bgBorder,
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: `${tokens.radius.md}px`,
        p: 1.5,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: tokens.shadow.card,
        transition: 'all 0.18s ease',
        backgroundImage: `linear-gradient(135deg, transparent 55%, ${borderColor}0f 100%)`,
        '&:hover': onClick
          ? { boxShadow: tokens.shadow.elevated, transform: 'translateY(-2px)' }
          : { boxShadow: tokens.shadow.elevated }
      }}
    >
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: tokens.font.weightBold,
          color: tokens.color.textMuted,
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
