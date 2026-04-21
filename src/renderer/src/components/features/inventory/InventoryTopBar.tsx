import { memo } from 'react'
import { Box, Button, CircularProgress, Tooltip, Typography, ToggleButtonGroup, ToggleButton } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import DownloadIcon from '@mui/icons-material/Download'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import StorageIcon from '@mui/icons-material/Storage'
import { tokens } from '../../../styles/tokens'

interface InventoryTopBarProps {
  refreshing: boolean
  lastRefresh: Date | null
  dbView: boolean
  onSetDbView: (v: boolean) => void
  inventoryEmpty: boolean
  onExportCsv: () => void
  onRefresh: () => void
}

export const InventoryTopBar = memo(function InventoryTopBar({
  refreshing,
  lastRefresh,
  dbView,
  onSetDbView,
  inventoryEmpty,
  onExportCsv,
  onRefresh,
}: InventoryTopBarProps): React.JSX.Element {
  return (
    <>
      {/* ── Top bar ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary', flex: 1 }}>
          SQL Server Inventory
        </Typography>
        {lastRefresh && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            Updated: {lastRefresh.toLocaleTimeString('en-US')}
          </Typography>
        )}
        <Tooltip title="Export CSV">
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={onExportCsv}
              disabled={inventoryEmpty}
              sx={{ fontSize: 12 }}
            >
              Export CSV
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Refresh metrics from all servers">
          <span>
            <Button
              size="small"
              variant="contained"
              startIcon={
                refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />
              }
              onClick={onRefresh}
              disabled={refreshing}
              sx={{ fontSize: 12, bgcolor: tokens.color.primary }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* ── View toggle ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
        <ToggleButtonGroup
          value={dbView ? 'db' : 'server'}
          exclusive
          onChange={(_e, v) => {
            if (v) onSetDbView(v === 'db')
          }}
          size="small"
        >
          <ToggleButton value="server" sx={{ fontSize: 12, px: 1.5, gap: 0.5 }}>
            <AccountTreeIcon sx={{ fontSize: 15 }} /> Server View
          </ToggleButton>
          <ToggleButton value="db" sx={{ fontSize: 12, px: 1.5, gap: 0.5 }}>
            <StorageIcon sx={{ fontSize: 15 }} /> DB View
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </>
  )
})
