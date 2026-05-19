import { useEffect, useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef, GridRowParams } from '@mui/x-data-grid'
import { tokens } from '../styles/tokens'
import { useIncidentsStore, loadIncidents, loadOpenCount } from '../store/incidentsStore'
import { IncidentDetailDrawer } from '../components/incidents/IncidentDetailDrawer'
import type { Incident, IncidentStatus } from '../../../preload/index'

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: tokens.color.danger,
  WARNING: tokens.color.warning
}

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'error' | 'success' | 'info'> = {
  open: 'error',
  investigating: 'warning',
  awaiting_approval: 'warning',
  resolved: 'success',
  archived: 'default'
}

const COLUMNS: GridColDef<Incident>[] = [
  {
    field: 'severity',
    headerName: 'Severity',
    width: 100,
    renderCell: ({ value }) => (
      <Chip
        label={value as string}
        size="small"
        sx={{
          bgcolor: SEVERITY_COLOR[value as string] ?? tokens.color.textMuted,
          color: '#fff',
          fontWeight: 600,
          fontSize: 11,
          height: 20
        }}
      />
    )
  },
  {
    field: 'status',
    headerName: 'Status',
    width: 140,
    renderCell: ({ value }) => (
      <Chip
        label={value as string}
        size="small"
        color={STATUS_COLOR[value as string] ?? 'default'}
        sx={{ height: 20, fontSize: 11 }}
      />
    )
  },
  {
    field: 'serverId',
    headerName: 'Server',
    flex: 1,
    renderCell: ({ value }) => (
      <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{value as string}</Typography>
    )
  },
  {
    field: 'category',
    headerName: 'Category',
    width: 160,
    valueFormatter: (value: string) => value.replace(/_/g, ' ')
  },
  {
    field: 'openedAt',
    headerName: 'Opened',
    width: 160,
    valueFormatter: (value: number) => new Date(value).toLocaleString()
  },
  {
    field: 'resolvedAt',
    headerName: 'Resolved',
    width: 160,
    valueFormatter: (value: number | undefined) => value ? new Date(value).toLocaleString() : '—'
  }
]

const STATUS_FILTERS: Array<{ label: string; value: IncidentStatus | 'all' }> = [
  { label: 'Active', value: 'open' },
  { label: 'Investigating', value: 'investigating' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'All', value: 'all' }
]

export function Incidents(): React.JSX.Element {
  const { incidents, selectedId, setSelectedId } = useIncidentsStore()
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'all'>('open')
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const filter = statusFilter === 'all' ? undefined : { status: statusFilter }
    loadIncidents(filter)
    loadOpenCount()
  }, [statusFilter])

  // Subscribe to push events
  useEffect(() => {
    const unsubCreated = window.sqlSentinel.incidents.onCreated((incident) => {
      useIncidentsStore.getState().upsertIncident(incident)
    })
    const unsubUpdated = window.sqlSentinel.incidents.onUpdated((incident) => {
      useIncidentsStore.getState().upsertIncident(incident)
    })
    return () => { unsubCreated(); unsubUpdated() }
  }, [])

  const handleRowClick = useCallback((params: GridRowParams<Incident>) => {
    setSelectedId(params.row.id)
    setDrawerOpen(true)
  }, [setSelectedId])

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2, gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700 }}>Incidents</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={statusFilter}
          onChange={(_e, v) => { if (v) setStatusFilter(v) }}
        >
          {STATUS_FILTERS.map(({ label, value }) => (
            <ToggleButton key={value} value={value} sx={{ fontSize: 12, py: 0.5, px: 1.5 }}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Grid */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={incidents}
          columns={COLUMNS}
          getRowId={(row) => row.id}
          onRowClick={handleRowClick}
          density="compact"
          disableRowSelectionOnClick={false}
          rowSelectionModel={{ type: 'include', ids: new Set(selectedId ? [selectedId] : []) }}
          sx={{
            fontSize: 12,
            '& .MuiDataGrid-row': { cursor: 'pointer' },
            '& .MuiDataGrid-columnHeader': { bgcolor: tokens.color.bgSurface }
          }}
          initialState={{
            sorting: { sortModel: [{ field: 'openedAt', sort: 'desc' }] }
          }}
        />
      </Box>

      <IncidentDetailDrawer
        open={drawerOpen && !!selectedId}
        onClose={() => { setDrawerOpen(false); setSelectedId(null) }}
      />
    </Box>
  )
}
