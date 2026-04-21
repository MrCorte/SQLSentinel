import { memo } from 'react'
import type { SxProps } from '@mui/material'
import { Box } from '@mui/material'

interface StatusDotProps {
  color: string
  size?: number
  glow?: boolean
  sx?: SxProps
}

export const StatusDot = memo(function StatusDot({ color, size = 8, glow, sx }: StatusDotProps) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
        ...(glow && { boxShadow: `0 0 6px 1px ${color}` }),
        ...sx,
      }}
    />
  )
})
