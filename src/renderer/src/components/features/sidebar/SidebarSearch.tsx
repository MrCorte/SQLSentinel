import { memo } from 'react'
import { Box } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { tokens } from '../../../styles/tokens'

// ---------------------------------------------------------------------------
// SidebarSearch — pure presentational search input
// ---------------------------------------------------------------------------

interface SidebarSearchProps {
  value: string
  onChange: (v: string) => void
}

export const SidebarSearch = memo(function SidebarSearch({
  value,
  onChange
}: SidebarSearchProps): React.JSX.Element {
  return (
    <Box sx={{ position: 'relative', px: 1.5, pb: 1 }}>
      <Box
        component="span"
        sx={{
          position: 'absolute',
          left: 22,
          top: '50%',
          transform: 'translateY(-55%)',
          color: '#888',
          display: 'flex',
          pointerEvents: 'none'
        }}
      >
        <SearchIcon sx={{ fontSize: 14 }} />
      </Box>
      <Box
        component="input"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder="Search server..."
        aria-label="Search server"
        sx={{
          width: '100%',
          height: 28,
          // Token-driven colours so the input adapts to light theme. The
          // previous hardcoded #2d2d2d/#fff would render a black box on light.
          bgcolor: tokens.color.bgSurface,
          border: `1px solid ${tokens.color.bgBorder}`,
          borderRadius: '4px',
          color: tokens.color.textPrimary,
          fontSize: 12,
          pl: '28px',
          pr: value ? '24px' : '8px',
          outline: 'none',
          fontFamily: 'inherit',
          '&::placeholder': { color: tokens.color.textMuted },
          '&:focus': { borderColor: tokens.color.primary }
        }}
      />
      {value && (
        <Box
          component="button"
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          sx={{
            position: 'absolute',
            right: 20,
            top: '50%',
            transform: 'translateY(-55%)',
            color: tokens.color.textMuted,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontFamily: 'inherit',
            '&:hover': { color: tokens.color.textPrimary },
            '&:focus-visible': {
              outline: `2px solid ${tokens.color.primary}`,
              outlineOffset: 1,
              borderRadius: 2
            }
          }}
        >
          ×
        </Box>
      )}
    </Box>
  )
})
