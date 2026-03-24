import { Box, Typography } from '@mui/material'
import { tokens } from '../styles/tokens'

interface Props {
  reachable: boolean | null
  responseTimeMs?: number
}

export function ServerStatusChip({ reachable, responseTimeMs }: Props): React.JSX.Element {
  if (reachable === null || reachable === undefined) {
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          py: 0.125,
          borderRadius: '12px',
          bgcolor: 'background.default',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography component="span" sx={{ fontSize: tokens.font.sizeXs, color: 'text.secondary' }}>
          Sconosciuto
        </Typography>
      </Box>
    )
  }

  if (reachable) {
    const label = responseTimeMs !== undefined ? `Online · ${responseTimeMs}ms` : 'Online'
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          py: 0.125,
          borderRadius: '12px',
          bgcolor: tokens.color.successLight,
          border: `1px solid ${tokens.color.success}`
        }}
      >
        <Typography component="span" sx={{ fontSize: tokens.font.sizeXs, color: tokens.color.success, fontWeight: tokens.font.weightSemibold }}>
          {label}
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: 0.125,
        borderRadius: '12px',
        bgcolor: tokens.color.errorLight,
        border: `1px solid ${tokens.color.error}`
      }}
    >
      <Typography component="span" sx={{ fontSize: tokens.font.sizeXs, color: tokens.color.error, fontWeight: tokens.font.weightSemibold }}>
        Non raggiungibile
      </Typography>
    </Box>
  )
}
