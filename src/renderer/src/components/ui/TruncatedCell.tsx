import { memo } from 'react'
import { Tooltip, Typography } from '@mui/material'

interface TruncatedCellProps {
  text: string
  maxWidth?: number | string
}

export const TruncatedCell = memo(function TruncatedCell({
  text,
  maxWidth = 200
}: TruncatedCellProps) {
  return (
    <Tooltip title={text} placement="top">
      <Typography
        noWrap
        sx={{
          maxWidth,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {text}
      </Typography>
    </Tooltip>
  )
})
