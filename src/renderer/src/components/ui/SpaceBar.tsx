import { Box, Typography } from '@mui/material'
import { tokens } from '../../styles/tokens'

interface SpaceBarProps {
  used: number
  total: number
  unit: string
}

function getColor(pct: number): string {
  if (pct >= 90) return '#a4262c'
  if (pct >= 70) return '#d83b01'
  return '#107c10'
}

export function SpaceBar({ used, total, unit }: SpaceBarProps): React.JSX.Element {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  const color = getColor(pct)

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          height: 8,
          borderRadius: '4px',
          bgcolor: 'action.disabledBackground',
          overflow: 'hidden'
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: `${pct.toFixed(1)}%`,
            bgcolor: color,
            borderRadius: '4px',
            transition: 'width 400ms ease'
          }}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{ color: tokens.color.textMuted, mt: 0.5, display: 'block', fontSize: 11 }}
      >
        {used.toFixed(1)} / {total.toFixed(1)} {unit} ({pct.toFixed(1)}%)
      </Typography>
    </Box>
  )
}
