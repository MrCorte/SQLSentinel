import { memo } from 'react'
import {
  Box,
  Button,
  MenuItem,
  Select,
  TextField,
  Typography,
  InputAdornment,
} from '@mui/material'
import FilterListIcon from '@mui/icons-material/FilterList'
import SearchIcon from '@mui/icons-material/Search'
import { compatLevelToSqlVersion } from '../../../utils/sqlVersionUtils'
import type { FilterDbRecovery, FilterDbTde } from './useInventoryState'
import type { DbViewRow } from './inventoryTypes'

interface InventoryDbFiltersProps {
  dbSearch: string
  onDbSearchChange: (v: string) => void
  filterDbRecovery: FilterDbRecovery
  onFilterDbRecoveryChange: (v: FilterDbRecovery) => void
  filterDbTde: FilterDbTde
  onFilterDbTdeChange: (v: FilterDbTde) => void
  filterDbCompat: string
  onFilterDbCompatChange: (v: string) => void
  filterDbOffline: boolean
  onFilterDbOfflineToggle: () => void
  filterDbNoBackup: boolean
  onFilterDbNoBackupToggle: () => void
  compatLevelOptions: number[]
  expandedDbServers: Set<string>
  onToggleAll: () => void
  onReset: () => void
  allDbViewRowsExpanded: DbViewRow[]
  filteredDbRows: (DbViewRow & { type: 'db-row' })[]
}

export const InventoryDbFilters = memo(function InventoryDbFilters({
  dbSearch,
  onDbSearchChange,
  filterDbRecovery,
  onFilterDbRecoveryChange,
  filterDbTde,
  onFilterDbTdeChange,
  filterDbCompat,
  onFilterDbCompatChange,
  filterDbOffline,
  onFilterDbOfflineToggle,
  filterDbNoBackup,
  onFilterDbNoBackupToggle,
  compatLevelOptions,
  expandedDbServers,
  onToggleAll,
  onReset,
  allDbViewRowsExpanded,
  filteredDbRows,
}: InventoryDbFiltersProps) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
      <TextField
        size="small"
        placeholder="Cerca database o server..."
        value={dbSearch}
        onChange={(e) => onDbSearchChange(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            </InputAdornment>
          ),
        }}
        sx={{ minWidth: 220 }}
      />

      <Select
        size="small"
        value={filterDbRecovery}
        onChange={(e) => onFilterDbRecoveryChange(e.target.value as FilterDbRecovery)}
        sx={{ minWidth: 150 }}
      >
        <MenuItem value="all">Tutti i recovery</MenuItem>
        <MenuItem value="FULL">FULL</MenuItem>
        <MenuItem value="SIMPLE">SIMPLE</MenuItem>
        <MenuItem value="BULK_LOGGED">BULK_LOGGED</MenuItem>
      </Select>

      <Select
        size="small"
        value={filterDbTde}
        onChange={(e) => onFilterDbTdeChange(e.target.value as FilterDbTde)}
        sx={{ minWidth: 150 }}
      >
        <MenuItem value="all">TDE: Tutti</MenuItem>
        <MenuItem value="encrypted">Solo crittografati</MenuItem>
        <MenuItem value="not-encrypted">Solo non crittografati</MenuItem>
      </Select>

      {compatLevelOptions.length > 0 && (
        <Select
          size="small"
          value={filterDbCompat}
          onChange={(e) => onFilterDbCompatChange(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="all">Tutti i compat</MenuItem>
          {compatLevelOptions.map((l) => (
            <MenuItem key={l} value={String(l)}>
              {compatLevelToSqlVersion(l)} ({l})
            </MenuItem>
          ))}
        </Select>
      )}

      <Button
        size="small"
        variant={filterDbOffline ? 'contained' : 'outlined'}
        color="error"
        onClick={onFilterDbOfflineToggle}
        sx={{ fontSize: 12, height: 36 }}
      >
        Solo Offline
      </Button>

      <Button
        size="small"
        variant={filterDbNoBackup ? 'contained' : 'outlined'}
        color="warning"
        onClick={onFilterDbNoBackupToggle}
        sx={{ fontSize: 12, height: 36 }}
      >
        Senza Backup &gt;24h
      </Button>

      <Button
        size="small"
        variant="text"
        color="inherit"
        startIcon={<FilterListIcon />}
        onClick={onReset}
      >
        Reset
      </Button>

      <Button size="small" variant="text" color="inherit" onClick={onToggleAll} sx={{ ml: 0 }}>
        {expandedDbServers.size > 0 ? 'Comprimi tutti' : 'Espandi tutti'}
      </Button>

      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
        {allDbViewRowsExpanded.filter((r) => r.type === 'server-header').length} server ·{' '}
        {filteredDbRows.length} DB
      </Typography>
    </Box>
  )
})
