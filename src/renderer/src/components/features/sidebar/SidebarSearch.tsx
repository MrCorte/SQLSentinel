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
        placeholder="Cerca server..."
        sx={{
          width: '100%',
          height: 28,
          bgcolor: '#2d2d2d',
          border: '1px solid #3d3d3d',
          borderRadius: '4px',
          color: '#fff',
          fontSize: 12,
          pl: '28px',
          pr: value ? '24px' : '8px',
          outline: 'none',
          fontFamily: 'inherit',
          '&::placeholder': { color: '#888' },
          '&:focus': { borderColor: tokens.color.primary }
        }}
      />
      {value && (
        <Box
          component="span"
          onClick={() => onChange('')}
          sx={{
            position: 'absolute',
            right: 20,
            top: '50%',
            transform: 'translateY(-55%)',
            color: '#888',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            '&:hover': { color: '#ccc' }
          }}
        >
          ×
        </Box>
      )}
    </Box>
  )
})
