import { useEffect } from 'react'
import {
  Box,
  Typography,
  Stack,
  Chip,
  Divider,
  CircularProgress,
  Tooltip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef } from '@mui/x-data-grid'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { CollectMetricsRequest, AvailabilityReplica, AvailabilityDatabase } from '../../../preload/index'
import { useAgStore } from '../store/agStore'
import { tokens } from '../styles/tokens'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function healthColor(h: string): string {
  if (h === 'HEALTHY') return tokens.color.success
  if (h === 'PARTIALLY_HEALTHY') return '#d83b01'
  return tokens.color.error
}

function healthBg(h: string): string {
  if (h === 'HEALTHY') return tokens.color.successLight
  if (h === 'PARTIALLY_HEALTHY') return '#fed9cc'
  return tokens.color.errorLight
}

function syncStateColor(s: string): string {
  if (s === 'SYNCHRONIZED') return tokens.color.success
  if (s === 'SYNCHRONIZING') return '#d83b01'
  return tokens.color.error
}

function syncStateBg(s: string): string {
  if (s === 'SYNCHRONIZED') return tokens.color.successLight
  if (s === 'SYNCHRONIZING') return '#fff4ce'
  return tokens.color.errorLight
}

// ---------------------------------------------------------------------------
// ReplicaCard
// ---------------------------------------------------------------------------

function ReplicaCard({ replica }: { replica: AvailabilityReplica }): React.JSX.Element {
  const isPrimary = replica.role_desc === 'PRIMARY'
  const isConnected = replica.connected_state_desc === 'CONNECTED'

  return (
    <Box
      sx={{
        bgcolor: tokens.color.bgCard,
        border: `1px solid ${isPrimary ? tokens.color.primary : tokens.color.border}`,
        borderTop: `3px solid ${isPrimary ? tokens.color.primary : tokens.color.border}`,
        borderRadius: tokens.radius.sm,
        p: 1.5,
        minWidth: 220,
        flex: '1 1 220px',
        boxShadow: tokens.shadow.card
      }}
    >
      {/* Header */}
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: tokens.color.textPrimary, flex: 1 }}>
          {isPrimary ? '★ ' : '○ '}
          {replica.replica_server_name}
        </Typography>
        <Chip
          label={replica.role_desc}
          size="small"
          sx={{
            fontSize: 9,
            height: 18,
            fontWeight: 700,
            bgcolor: isPrimary ? tokens.color.successLight : '#f3f2f1',
            color: isPrimary ? tokens.color.success : '#605e5c'
          }}
        />
      </Stack>

      <Divider sx={{ mb: 1 }} />

      <Stack spacing={0.5}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>Modalità</Typography>
          <Typography variant="caption" sx={{ color: tokens.color.textPrimary, fontWeight: 600 }}>
            {replica.availability_mode_desc === 'SYNCHRONOUS_COMMIT' ? 'SYNC' : 'ASYNC'}
            {' — '}
            {replica.failover_mode_desc === 'AUTOMATIC' ? 'AUTO' : 'MANUAL'}
          </Typography>
        </Stack>

        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>Connessione</Typography>
          <Typography
            variant="caption"
            sx={{ color: isConnected ? tokens.color.success : tokens.color.error, fontWeight: 600 }}
          >
            {replica.connected_state_desc} {isConnected ? '✅' : '❌'}
          </Typography>
        </Stack>

        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>Sync health</Typography>
          <Typography
            variant="caption"
            sx={{ color: healthColor(replica.synchronization_health_desc), fontWeight: 600 }}
          >
            {replica.synchronization_health_desc === 'HEALTHY' ? '✅ HEALTHY' :
             replica.synchronization_health_desc === 'PARTIALLY_HEALTHY' ? '⚠ PARTIAL' : '❌ UNHEALTHY'}
          </Typography>
        </Stack>

        {replica.operational_state_desc && (
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>Stato op.</Typography>
            <Typography variant="caption" sx={{ color: tokens.color.textPrimary }}>
              {replica.operational_state_desc}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// AG Dashboard
// ---------------------------------------------------------------------------

interface Props {
  agName: string
  connection: CollectMetricsRequest
}

const LOG_QUEUE_WARN_KB = 10240

const DB_GRID_SX = {
  border: 0,
  '& .MuiDataGrid-columnHeader': {
    bgcolor: tokens.color.bgApp,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: tokens.color.textSecondary
  },
  '& .MuiDataGrid-columnHeaders': {
    borderBottom: `2px solid ${tokens.color.primary}`
  },
  '& .row-sync': { bgcolor: '#fff4ce' },
  '& .row-nosync': { bgcolor: tokens.color.errorLight }
} as const

export function AgDashboard({ agName, connection }: Props): React.JSX.Element {
  const { agDetails, updateAgDetails } = useAgStore()
  const detail = agDetails[agName]

  // Fetch details on mount and every 60s
  useEffect(() => {
    updateAgDetails(connection)
    const timer = setInterval(() => updateAgDetails(connection), 60_000)
    return () => clearInterval(timer)
  }, [agName, connection.ip, connection.port]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography sx={{ color: tokens.color.textSecondary }}>
          Caricamento dati AG...
        </Typography>
      </Box>
    )
  }

  const dbColumns: GridColDef<AvailabilityDatabase>[] = [
    {
      field: 'database_name',
      headerName: 'Database',
      flex: 1,
      renderCell: (p) => (
        <Typography variant="body2" noWrap sx={{ width: '100%' }}>
          {p.value as string}
        </Typography>
      )
    },
    {
      field: 'synchronization_state_desc',
      headerName: 'Sync State',
      width: 140,
      renderCell: (p) => (
        <Chip
          label={p.value as string}
          size="small"
          sx={{
            fontSize: 10,
            height: 20,
            fontWeight: 700,
            bgcolor: syncStateBg(p.value as string),
            color: syncStateColor(p.value as string)
          }}
        />
      )
    },
    {
      field: 'synchronization_health_desc',
      headerName: 'Health',
      width: 130,
      renderCell: (p) => (
        <Chip
          label={p.value as string}
          size="small"
          sx={{
            fontSize: 10,
            height: 20,
            fontWeight: 700,
            bgcolor: healthBg(p.value as string),
            color: healthColor(p.value as string)
          }}
        />
      )
    },
    {
      field: 'log_send_queue_kb',
      headerName: 'Log Queue (KB)',
      width: 130,
      type: 'number',
      align: 'right',
      headerAlign: 'right',
      renderCell: (p) => {
        const v = p.value as number
        return (
          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ width: '100%' }}>
            {v > LOG_QUEUE_WARN_KB && (
              <Tooltip title={`Log queue elevata: ${v.toLocaleString('it-IT')} KB`}>
                <WarningAmberIcon sx={{ fontSize: 14, color: '#d83b01' }} />
              </Tooltip>
            )}
            <Typography variant="body2" sx={{ color: v > LOG_QUEUE_WARN_KB ? '#d83b01' : 'inherit', fontWeight: v > LOG_QUEUE_WARN_KB ? 700 : 400 }}>
              {v.toLocaleString('it-IT')}
            </Typography>
          </Stack>
        )
      }
    },
    {
      field: 'redo_queue_kb',
      headerName: 'Redo Queue (KB)',
      width: 140,
      type: 'number',
      align: 'right',
      headerAlign: 'right',
      valueFormatter: (v: number) => v.toLocaleString('it-IT')
    },
    {
      field: 'last_commit_time',
      headerName: 'Last Commit',
      width: 160,
      renderCell: (p) => (
        <Typography variant="body2">
          {p.value ? new Date(p.value as string).toLocaleString('it-IT') : '—'}
        </Typography>
      )
    }
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* AG Header */}
      <Box
        sx={{
          bgcolor: tokens.color.bgCard,
          border: `1px solid ${tokens.color.border}`,
          borderLeft: `4px solid ${healthColor(detail.ag_health)}`,
          borderRadius: tokens.radius.sm,
          px: 2,
          py: 1.5,
          boxShadow: tokens.shadow.card
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: tokens.color.textPrimary, flex: 1 }}>
            {detail.ag_name}
          </Typography>
          <Chip
            label={`● ${detail.ag_health}`}
            size="small"
            sx={{
              fontWeight: 700,
              fontSize: 11,
              bgcolor: healthBg(detail.ag_health),
              color: healthColor(detail.ag_health)
            }}
          />
        </Stack>
        <Stack direction="row" spacing={3} sx={{ mt: 0.75 }}>
          <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>
            Primary: <strong style={{ color: tokens.color.textPrimary }}>{detail.primary_replica || '—'}</strong>
          </Typography>
          <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>
            Aggiornato: <strong style={{ color: tokens.color.textPrimary }}>
              {detail.lastUpdated.toLocaleTimeString('it-IT')}
            </strong>
          </Typography>
          <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>
            {detail.replicas.length} repliche · {detail.databases.length} DB
          </Typography>
        </Stack>
      </Box>

      {/* Replica cards */}
      <Box>
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: tokens.color.textSecondary,
            mb: 1.5
          }}
        >
          Repliche
        </Typography>
        {detail.replicas.length === 0 ? (
          <Typography variant="body2" sx={{ color: tokens.color.textSecondary }}>
            Nessuna replica disponibile.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {detail.replicas.map((r) => (
              <ReplicaCard key={r.replica_id} replica={r} />
            ))}
          </Box>
        )}
      </Box>

      <Divider />

      {/* Database table */}
      <Box>
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: tokens.color.textSecondary,
            mb: 1.5
          }}
        >
          Database AG
        </Typography>
        {detail.databases.length === 0 ? (
          <Typography variant="body2" sx={{ color: tokens.color.textSecondary }}>
            Nessun database AG disponibile (questa replica potrebbe essere SECONDARY — i dati
            sono visibili solo dalla PRIMARY).
          </Typography>
        ) : (
          <DataGrid<AvailabilityDatabase>
            rows={detail.databases}
            columns={dbColumns}
            getRowId={(r) => `${r.ag_name}-${r.database_name}`}
            density="compact"
            disableRowSelectionOnClick
            hideFooter={detail.databases.length <= 25}
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            getRowClassName={(p) => {
              const s = (p.row as AvailabilityDatabase).synchronization_state_desc
              if (s === 'SYNCHRONIZING') return 'row-sync'
              if (s === 'NOT_SYNCHRONIZING') return 'row-nosync'
              return ''
            }}
            sx={DB_GRID_SX}
          />
        )}
      </Box>
    </Box>
  )
}
