import { useEffect, useState, useCallback, useMemo } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import LinearProgress from '@mui/material/LinearProgress'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef, GridRowParams } from '@mui/x-data-grid'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import SpeedIcon from '@mui/icons-material/Speed'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import BuildCircleIcon from '@mui/icons-material/BuildCircle'
import { tokens } from '../styles/tokens'
import { useShallow } from 'zustand/react/shallow'
import {
  useIncidentsStore,
  loadAiStats,
  loadIncidents,
  loadOpenCount
} from '../store/incidentsStore'
import { IncidentDetailDrawer } from '../components/incidents/IncidentDetailDrawer'
import type { Incident, IncidentAiStats, IncidentStatus } from '../../../preload/index'

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

interface IncidentGroupRow {
  id: string
  latestIncidentId: string
  serverId: string
  category: Incident['category']
  severity: Incident['severity']
  status: IncidentStatus
  openedAt: number
  windowStartAt: number
  resolvedAt?: number
  occurrences: number
}

const STATUS_PRIORITY: Record<IncidentStatus, number> = {
  open: 5,
  investigating: 4,
  awaiting_approval: 3,
  resolved: 2,
  archived: 1
}

const COLUMNS: GridColDef<IncidentGroupRow>[] = [
  {
    field: 'severity',
    headerName: 'Severity',
    width: 100,
    renderCell: ({ row }) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Chip
          label={row.severity}
          size="small"
          sx={{
            bgcolor: SEVERITY_COLOR[row.severity] ?? tokens.color.textMuted,
            color: '#fff',
            fontWeight: 600,
            fontSize: 11,
            height: 20
          }}
        />
      </Box>
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
    field: 'occurrences',
    headerName: 'Occurrences',
    width: 120
  },
  {
    field: 'windowStartAt',
    headerName: 'Time window',
    width: 280,
    renderCell: ({ row }) => (
      <Typography sx={{ fontSize: 12 }}>
        {formatTimeWindow(row.windowStartAt, row.openedAt)}
      </Typography>
    )
  },
  {
    field: 'openedAt',
    headerName: 'Latest',
    width: 160,
    valueFormatter: (value: number) => new Date(value).toLocaleString()
  },
  {
    field: 'resolvedAt',
    headerName: 'Resolved',
    width: 160,
    valueFormatter: (value: number | undefined) => (value ? new Date(value).toLocaleString() : '—')
  }
]

const STATUS_FILTERS: Array<{ label: string; value: IncidentStatus | 'all' }> = [
  { label: 'Active', value: 'open' },
  { label: 'Investigating', value: 'investigating' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'All', value: 'all' }
]

function groupIncidents(incidents: Incident[]): IncidentGroupRow[] {
  const groups = new Map<string, IncidentGroupRow>()

  for (const incident of incidents) {
    const key = `${incident.serverId}::${incident.category}`
    const current = groups.get(key)
    if (!current) {
      groups.set(key, {
        id: key,
        latestIncidentId: incident.id,
        serverId: incident.serverId,
        category: incident.category,
        severity: incident.severity,
        status: incident.status,
        openedAt: incident.openedAt,
        windowStartAt: incident.openedAt,
        resolvedAt: incident.resolvedAt,
        occurrences: 1
      })
      continue
    }

    current.occurrences += 1
    current.windowStartAt = Math.min(current.windowStartAt, incident.openedAt)

    if (incident.openedAt > current.openedAt) {
      current.openedAt = incident.openedAt
      current.latestIncidentId = incident.id
    }

    if (incident.severity === 'CRITICAL') {
      current.severity = 'CRITICAL'
    }

    if (STATUS_PRIORITY[incident.status] > STATUS_PRIORITY[current.status]) {
      current.status = incident.status
    }

    if (current.resolvedAt && incident.resolvedAt) {
      current.resolvedAt = Math.max(current.resolvedAt, incident.resolvedAt)
    } else {
      current.resolvedAt = undefined
    }
  }

  return [...groups.values()]
}

function formatTimeWindow(startAt: number, endAt: number): string {
  const start = new Date(startAt).toLocaleString()
  const end = new Date(endAt).toLocaleString()
  return start === end ? start : `${start} - ${end}`
}

export function Incidents(): React.JSX.Element {
  const { incidents, selectedId, aiStats } = useIncidentsStore(
    useShallow((s) => ({ incidents: s.incidents, selectedId: s.selectedId, aiStats: s.aiStats }))
  )
  const setSelectedId = useIncidentsStore((s) => s.setSelectedId)
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'all'>('open')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const groupedIncidents = useMemo(() => groupIncidents(incidents), [incidents])

  useEffect(() => {
    const filter = statusFilter === 'all' ? undefined : { status: statusFilter }
    loadIncidents(filter)
    loadOpenCount()
    loadAiStats()
  }, [statusFilter])

  // Subscribe to push events
  useEffect(() => {
    const unsubCreated = window.sqlSentinel.incidents.onCreated((incident) => {
      useIncidentsStore.getState().upsertIncident(incident)
      loadAiStats()
    })
    const unsubUpdated = window.sqlSentinel.incidents.onUpdated((incident) => {
      useIncidentsStore.getState().upsertIncident(incident)
      loadAiStats()
    })
    return () => {
      unsubCreated()
      unsubUpdated()
    }
  }, [])

  const handleRowClick = useCallback(
    (params: GridRowParams<IncidentGroupRow>) => {
      setSelectedId(params.row.latestIncidentId)
      setDrawerOpen(true)
    },
    [setSelectedId]
  )

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2, gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700 }}>Incidents</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={statusFilter}
          onChange={(_e, v) => {
            if (v) setStatusFilter(v)
          }}
        >
          {STATUS_FILTERS.map(({ label, value }) => (
            <ToggleButton key={value} value={value} sx={{ fontSize: 12, py: 0.5, px: 1.5 }}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <AiOperationsPanel stats={aiStats} />

      {/* Grid */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={groupedIncidents}
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
        onClose={() => {
          setDrawerOpen(false)
          setSelectedId(null)
        }}
      />
    </Box>
  )
}

function AiOperationsPanel({ stats }: { stats: IncidentAiStats | null }): React.JSX.Element {
  const successRate = stats ? Math.round(stats.successRate * 100) : 0
  const hasRuns = Boolean(stats?.totalRuns)
  const providerSummary = stats?.providers.length
    ? stats.providers
        .map(
          (provider) =>
            `${provider.provider} ${provider.runs}${provider.failedRuns ? `/${provider.failedRuns} failed` : ''}`
        )
        .join(' · ')
    : 'No provider runs'

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          md: '1.2fr repeat(3, minmax(150px, 1fr))'
        },
        gap: 1,
        alignItems: 'stretch'
      }}
    >
      <Box
        sx={{
          border: `1px solid ${tokens.color.bgBorder}`,
          borderRadius: 1,
          bgcolor: tokens.color.bgSurface,
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SmartToyIcon sx={{ fontSize: 18, color: tokens.color.accent }} />
          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>AI Operations</Typography>
          <Chip
            size="small"
            label={`${stats?.totalRuns ?? 0} runs`}
            sx={{ ml: 'auto', height: 20, fontSize: 11 }}
          />
        </Box>
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: 11, color: tokens.color.textMuted }}>
              Reliability
            </Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{successRate}%</Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={hasRuns ? successRate : 0}
            color={stats && stats.failedRuns > 0 ? 'warning' : 'success'}
            sx={{ height: 6, borderRadius: 1 }}
          />
        </Box>
        <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, wordBreak: 'break-word' }}>
          {providerSummary}
        </Typography>
      </Box>

      <AiMetricTile
        icon={<SpeedIcon sx={{ fontSize: 18 }} />}
        label="Latency"
        value={formatDuration(stats?.avgDurationMs)}
        subvalue={`p95 ${formatDuration(stats?.p95DurationMs)}`}
      />
      <AiMetricTile
        icon={<BuildCircleIcon sx={{ fontSize: 18 }} />}
        label="Tools"
        value={`${stats?.avgToolCalls ?? 0}`}
        subvalue={`${stats?.proposedActions ?? 0} pending · ${stats?.executedActions ?? 0} executed`}
      />
      <AiMetricTile
        icon={<ErrorOutlineIcon sx={{ fontSize: 18 }} />}
        label="Failures"
        value={`${stats?.failedRuns ?? 0}`}
        subvalue={
          stats?.lastRunAt ? `last ${new Date(stats.lastRunAt).toLocaleString()}` : 'no runs yet'
        }
        tone={stats && stats.failedRuns > 0 ? 'warning' : 'default'}
      />
    </Box>
  )
}

function AiMetricTile({
  icon,
  label,
  value,
  subvalue,
  tone = 'default'
}: {
  icon: React.ReactNode
  label: string
  value: string
  subvalue: string
  tone?: 'default' | 'warning'
}): React.JSX.Element {
  return (
    <Box
      sx={{
        border: `1px solid ${tone === 'warning' ? tokens.color.warning : tokens.color.bgBorder}`,
        borderRadius: 1,
        bgcolor: tokens.color.bgSurface,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 92
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: tokens.color.textMuted }}>
        {icon}
        <Typography sx={{ fontSize: 11, color: tokens.color.textMuted }}>{label}</Typography>
      </Box>
      <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{value}</Typography>
      <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, wordBreak: 'break-word' }}>
        {subvalue}
      </Typography>
    </Box>
  )
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) return 'n/a'
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`
}
