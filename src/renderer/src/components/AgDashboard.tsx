import { useState, useCallback, useEffect } from 'react'
import {
  Box,
  Typography,
  Stack,
  Chip,
  Divider,
  CircularProgress,
  Tooltip,
  Snackbar,
  Alert
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef } from '@mui/x-data-grid'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { CollectMetricsRequest, AvailabilityReplica, AvailabilityDatabase } from '../../../preload/index'
import { useAgStore } from '../store/agStore'
import { useServersStore } from '../store/serversStore'
import { useGroupsStore } from '../store/groupsStore'
import { useAppStore } from '../store/appStore'
import { alpha } from '@mui/material/styles'
import { tokens } from '../styles/tokens'
import { useVisibilityPoll } from '../hooks/useVisibilityPoll'

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

interface ReplicaCardProps {
  replica: AvailabilityReplica
  displayName: string
  onNavigate: (replica: AvailabilityReplica) => void
}

function ReplicaCard({ replica, displayName, onNavigate }: ReplicaCardProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const isPrimary = replica.role_desc === 'PRIMARY'
  const isConnected = replica.connected_state_desc === 'CONNECTED'

  return (
    <Tooltip title={`Apri dashboard: ${replica.replica_server_name}`} arrow>
      <Box
        onClick={() => onNavigate(replica)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        sx={{
          bgcolor: 'background.paper',
          border: (theme) => `1px solid ${isPrimary ? tokens.color.primary : theme.palette.divider}`,
          borderTop: (theme) => `3px solid ${isPrimary ? tokens.color.primary : theme.palette.divider}`,
          borderRadius: tokens.radius.sm,
          p: 1.5,
          minWidth: 220,
          flex: '1 1 220px',
          boxShadow: hovered
            ? '0 4px 12px rgba(0,0,0,0.15)'
            : isPrimary
              ? `${tokens.shadow.card}, 0 0 0 1px rgba(0,120,212,0.25)`
              : tokens.shadow.card,
          transform: hovered ? 'translateY(-1px)' : 'none',
          transition: 'box-shadow 200ms, transform 200ms',
          cursor: 'pointer',
          position: 'relative'
        }}
      >
        {/* Header */}
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.primary' }}>
              {isPrimary ? '★ ' : '○ '}
              {displayName}
            </Typography>
            {displayName !== replica.replica_server_name && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {replica.replica_server_name}
              </Typography>
            )}
          </Box>
          <Chip
            label={replica.role_desc}
            size="small"
            sx={{
              fontSize: 9,
              height: 18,
              fontWeight: 700,
              bgcolor: isPrimary ? tokens.color.successLight : 'background.default',
              color: isPrimary ? tokens.color.success : 'text.secondary'
            }}
          />
        </Stack>

        <Divider sx={{ mb: 1 }} />

        <Stack spacing={0.5}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Modalità</Typography>
            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600 }}>
              {replica.availability_mode_desc === 'SYNCHRONOUS_COMMIT' ? 'SYNC' : 'ASYNC'}
              {' — '}
              {replica.failover_mode_desc === 'AUTOMATIC' ? 'AUTO' : 'MANUAL'}
            </Typography>
          </Stack>

          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Connessione</Typography>
            <Typography
              variant="caption"
              sx={{ color: isConnected ? tokens.color.success : tokens.color.error, fontWeight: 600 }}
            >
              {isConnected ? '✅' : '❌'} {replica.connected_state_desc}
            </Typography>
          </Stack>

          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Sync health</Typography>
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
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Stato op.</Typography>
              <Typography variant="caption" sx={{ color: 'text.primary' }}>
                {replica.operational_state_desc}
              </Typography>
            </Stack>
          )}
        </Stack>

        {/* Freccia "→ Dashboard" visibile solo al hover */}
        <Typography
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            fontSize: 11,
            color: tokens.color.primary,
            fontWeight: 600,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 200ms'
          }}
        >
          → Dashboard
        </Typography>
      </Box>
    </Tooltip>
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
    bgcolor: 'background.default',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: 'text.secondary'
  },
  '& .MuiDataGrid-columnHeaders': {
    borderBottom: `2px solid ${tokens.color.primary}`
  },
  '& .row-sync': { bgcolor: (theme: { palette: { mode: string; warning: { main: string } } }) => theme.palette.mode === 'dark' ? alpha(theme.palette.warning.main, 0.15) : '#fff4ce' },
  '& .row-nosync': { bgcolor: tokens.color.errorLight }
}

export function AgDashboard({ agName, connection }: Props): React.JSX.Element {
  const { agDetails, updateAgDetails } = useAgStore()
  const servers = useServersStore((s) => s.servers)
  const serverAliases = useGroupsStore((s) => s.serverAliases)
  const setPendingServerId = useAppStore((s) => s.setPendingServerId)
  const detail = agDetails[agName]

  const [snackbarMsg, setSnackbarMsg] = useState<string | null>(null)

  // Fetch details on mount
  useEffect(() => {
    updateAgDetails(connection)
  }, [agName, connection.ip, connection.port]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll every 60s, pausing when window is hidden
  const handleUpdateDetails = useCallback(() => {
    if (connection) updateAgDetails(connection)
  }, [connection, updateAgDetails])

  useVisibilityPoll(handleUpdateDetails, 60_000)

  const getDisplayName = useCallback((replicaServerName: string): string => {
    const nameBase = replicaServerName.split('\\')[0].toLowerCase()
    const match = servers.find((s) => {
      const addr = (s.host ?? s.ip ?? '').toLowerCase()
      return addr === nameBase || addr.includes(nameBase) || nameBase.includes(addr)
    })
    if (!match) return replicaServerName
    return serverAliases[match.id] || match.host || replicaServerName
  }, [servers, serverAliases])

  const handleNavigateToServer = useCallback((replica: AvailabilityReplica): void => {
    const nameBase = replica.replica_server_name.split('\\')[0].toLowerCase()
    const match = servers.find((s) => {
      const addr = (s.host ?? s.ip ?? '').toLowerCase()
      return addr === nameBase || addr.includes(nameBase) || nameBase.includes(addr)
    })
    if (match) {
      setPendingServerId(match.id)
    } else {
      setSnackbarMsg(
        `Server "${replica.replica_server_name}" non presente nella lista server monitorati. Aggiungilo prima dalla Discovery.`
      )
    }
  }, [servers, setPendingServerId])

  if (!detail) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography sx={{ color: 'text.secondary' }}>
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
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderLeft: `4px solid ${healthColor(detail.ag_health)}`,
          borderRadius: tokens.radius.sm,
          px: 2,
          py: 1.5,
          boxShadow: tokens.shadow.card
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary', flex: 1 }}>
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
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Primary: <strong style={{ color: 'inherit' }}>{detail.primary_replica || '—'}</strong>
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Aggiornato: <strong style={{ color: 'inherit' }}>
              {detail.lastUpdated.toLocaleTimeString('it-IT')}
            </strong>
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
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
            color: 'text.secondary',
            mb: 1.5
          }}
        >
          Repliche — clicca per aprire il dashboard del server
        </Typography>
        {detail.replicas.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Nessuna replica disponibile.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {detail.replicas.map((r) => (
              <ReplicaCard
                key={r.replica_id}
                replica={r}
                displayName={getDisplayName(r.replica_server_name)}
                onNavigate={handleNavigateToServer}
              />
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
            color: 'text.secondary',
            mb: 1.5
          }}
        >
          Database AG
        </Typography>
        {detail.databases.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Nessun database AG disponibile (questa replica potrebbe essere SECONDARY — i dati
            sono visibili solo dalla PRIMARY).
          </Typography>
        ) : (
          <DataGrid<AvailabilityDatabase>
            rows={detail.databases}
            columns={dbColumns}
            getRowId={(r) => `${r.ag_name}-${r.database_name}`}
            density="compact"
            autoHeight
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

      {/* Toast warning — server non monitorato */}
      <Snackbar
        open={snackbarMsg !== null}
        autoHideDuration={5000}
        onClose={() => setSnackbarMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="warning" onClose={() => setSnackbarMsg(null)} sx={{ width: '100%' }}>
          {snackbarMsg}
        </Alert>
      </Snackbar>
    </Box>
  )
}
