import { memo } from 'react'
import { Box, Button, MenuItem, Select, TextField, Typography, InputAdornment } from '@mui/material'
import FilterListIcon from '@mui/icons-material/FilterList'
import SearchIcon from '@mui/icons-material/Search'
import type { ServerGroup } from '../../../types/index'
import type { FilterType, FilterState, FilterHost } from './useInventoryState'
import type { InventoryRow } from './inventoryTypes'

interface InventoryFiltersProps {
  // search
  search: string
  onSearchChange: (v: string) => void
  // filter values
  filterEnv: string
  onFilterEnvChange: (v: string) => void
  filterType: FilterType
  onFilterTypeChange: (v: FilterType) => void
  filterState: FilterState
  onFilterStateChange: (v: FilterState) => void
  filterHost: FilterHost
  onFilterHostChange: (v: FilterHost) => void
  filterAlias: string
  onFilterAliasChange: (v: string) => void
  filterReferente: string
  onFilterReferenteChange: (v: string) => void
  filterVersion: string
  onFilterVersionChange: (v: string) => void
  // options
  envGroups: ServerGroup[]
  aliasOptions: string[]
  referenteOptions: string[]
  versionOptions: string[]
  // expand/collapse
  allClusterKeys: string[]
  allMachineKeys: string[]
  expandedClusters: Set<string>
  expandedMachines: Set<string>
  onToggleAll: () => void
  onReset: () => void
  // display count
  sortedRows: InventoryRow[]
}

export const InventoryFilters = memo(function InventoryFilters({
  search,
  onSearchChange,
  filterEnv,
  onFilterEnvChange,
  filterType,
  onFilterTypeChange,
  filterState,
  onFilterStateChange,
  filterHost,
  onFilterHostChange,
  filterAlias,
  onFilterAliasChange,
  filterReferente,
  onFilterReferenteChange,
  filterVersion,
  onFilterVersionChange,
  envGroups,
  aliasOptions,
  referenteOptions,
  versionOptions,
  allClusterKeys,
  allMachineKeys,
  expandedClusters,
  expandedMachines,
  onToggleAll,
  onReset,
  sortedRows,
}: InventoryFiltersProps) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
      <TextField
        size="small"
        placeholder="Search server or alias..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
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
        value={filterEnv}
        onChange={(e) => onFilterEnvChange(e.target.value)}
        sx={{ minWidth: 160 }}
      >
        <MenuItem value="all">All environments</MenuItem>
        {envGroups.map((g) => (
          <MenuItem key={g.id} value={g.id}>
            {g.name}
          </MenuItem>
        ))}
      </Select>

      <Select
        size="small"
        value={filterType}
        onChange={(e) => onFilterTypeChange(e.target.value as FilterType)}
        sx={{ minWidth: 150 }}
      >
        <MenuItem value="all">All types</MenuItem>
        <MenuItem value="standalone">Standalone</MenuItem>
        <MenuItem value="ag-primary">AG Primary</MenuItem>
        <MenuItem value="ag-secondary">AG Secondary</MenuItem>
      </Select>

      <Select
        size="small"
        value={filterState}
        onChange={(e) => onFilterStateChange(e.target.value as FilterState)}
        sx={{ minWidth: 130 }}
      >
        <MenuItem value="all">All states</MenuItem>
        <MenuItem value="online">Online</MenuItem>
        <MenuItem value="offline">Offline</MenuItem>
      </Select>

      <Select
        size="small"
        value={filterHost}
        onChange={(e) => onFilterHostChange(e.target.value as FilterHost)}
        sx={{ minWidth: 130 }}
      >
        <MenuItem value="all">All</MenuItem>
        <MenuItem value="on-premise">On-Premise</MenuItem>
        <MenuItem value="cloud">Cloud</MenuItem>
      </Select>

      {aliasOptions.length > 0 && (
        <Select
          size="small"
          value={filterAlias}
          onChange={(e) => onFilterAliasChange(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="all">All aliases</MenuItem>
          {aliasOptions.map((a) => (
            <MenuItem key={a} value={a}>
              {a}
            </MenuItem>
          ))}
        </Select>
      )}

      {referenteOptions.length > 0 && (
        <Select
          size="small"
          value={filterReferente}
          onChange={(e) => onFilterReferenteChange(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="all">All referents</MenuItem>
          {referenteOptions.map((r) => (
            <MenuItem key={r} value={r}>
              {r}
            </MenuItem>
          ))}
        </Select>
      )}

      {versionOptions.length > 0 && (
        <Select
          size="small"
          value={filterVersion}
          onChange={(e) => onFilterVersionChange(e.target.value)}
          sx={{ minWidth: 165 }}
        >
          <MenuItem value="all">All versions</MenuItem>
          {versionOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </Select>
      )}

      <Button
        size="small"
        variant="text"
        color="inherit"
        startIcon={<FilterListIcon />}
        onClick={onReset}
      >
        Reset
      </Button>

      {(allClusterKeys.length > 0 || allMachineKeys.length > 0) && (
        <Button size="small" variant="text" color="inherit" onClick={onToggleAll} sx={{ ml: 0 }}>
          {expandedClusters.size > 0 || expandedMachines.size > 0
            ? 'Collapse all'
            : 'Expand all'}
        </Button>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
        {sortedRows.filter((r) => r.depth === 0).length} server
      </Typography>
    </Box>
  )
})
