import { memo, useState, useEffect, useMemo } from 'react'
import {
  Box,
  Typography,
  Stack,
  Chip,
  Tooltip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef } from '@mui/x-data-grid'
import type {
  ServerMetrics,
  DatabaseInfo,
  SessionInfo,
  BackupInfo,
  WaitStatInfo,
  DbCustomFields
} from '../../../../../preload/index'
import { NoteEditor } from '../../NoteEditor'
import { compatLevelToSqlVersion } from '../../../utils/sqlVersionUtils'
import { tokens } from '../../../styles/tokens'
import type { MetricsData, QueryRow } from './useMetricsData'

// -----------------------------------------------------------------------
// Shared grid header style
// -----------------------------------------------------------------------

export const GRID_HEADER_SX = {
  '& .MuiDataGrid-columnHeader': {
    bgcolor: 'background.default',
    fontSize: tokens.font.sizeXs,
    fontWeight: tokens.font.weightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'text.secondary'
  },
  '& .MuiDataGrid-columnHeaders': {
    borderBottom: `2px solid ${tokens.color.primary}`
  }
} as const

// -----------------------------------------------------------------------
// Tab Panoramica
// -----------------------------------------------------------------------

function kpiAccent(type: 'blue' | 'health', value: number): string {
  if (type === 'blue') return tokens.color.primary
  if (value > 80) return tokens.color.error
  if (value > 60) return tokens.color.warning
  return tokens.color.success
}

function KpiCard({
  label,
  value,
  accent,
  tooltip
}: {
  label: string
  value: string
  accent: string
  tooltip?: string
}): React.JSX.Element {
  const card = (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: (theme) =>
          theme.palette.mode === 'dark' ? `${accent}33` : theme.palette.divider,
        borderLeft: `4px solid ${accent}`,
        borderRadius: `${tokens.radius.md}px`,
        px: '18px',
        py: '14px',
        minWidth: 150,
        flex: '1 1 150px',
        boxShadow: tokens.shadow.card,
        cursor: tooltip ? 'help' : 'default',
        transition: 'all 0.18s ease',
        backgroundImage: `linear-gradient(135deg, transparent 60%, ${accent}14 100%)`,
        '&:hover': {
          boxShadow: tokens.shadow.cardHover,
          transform: 'translateY(-2px)'
        }
      }}
    >
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: tokens.font.weightSemibold,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          color: 'text.secondary',
          mb: '6px',
          display: 'block'
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 20,
          fontWeight: tokens.font.weightBold,
          color: accent,
          lineHeight: 1.2
        }}
      >
        {value}
      </Typography>
    </Box>
  )
  return tooltip ? (
    <Tooltip
      title={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>}
      placement="top"
      arrow
    >
      {card}
    </Tooltip>
  ) : (
    card
  )
}

export const TabPanoramica = memo(function TabPanoramica({
  metrics,
  serverDbId,
  serverNotes
}: {
  metrics: ServerMetrics
  serverDbId: string
  serverNotes?: string
}): React.JSX.Element {
  const info = metrics.instanceInfo
  const memPercent = info.memoryTargetMb > 0 ? (info.memoryUsedMb / info.memoryTargetMb) * 100 : 0

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <KpiCard label="Version" value={info.version} accent={kpiAccent('blue', 0)} />
        <KpiCard label="Edition" value={info.edition} accent={kpiAccent('blue', 0)} />
        <KpiCard
          label="Memory used"
          value={`${info.memoryUsedMb.toLocaleString('en-US')} MB`}
          accent={kpiAccent('health', memPercent > 90 ? 90 : memPercent > 70 ? 70 : 0)}
        />
        <KpiCard
          label="CPU"
          value={`${info.cpuUsagePercent.toFixed(1)} %`}
          accent={kpiAccent('health', info.cpuUsagePercent)}
        />
        <KpiCard
          label="Uptime"
          value={`${info.uptimeDays.toFixed(1)} days`}
          accent={kpiAccent('blue', 0)}
        />
        {info.logicalCpus > 0 && (
          <KpiCard
            label="Logical CPUs"
            value={`${info.physicalCpus}C / ${info.logicalCpus}T`}
            accent={kpiAccent('blue', 0)}
            tooltip={`Physical cores: ${info.physicalCpus}\nLogical threads: ${info.logicalCpus}\nHyperthreading: ${info.logicalCpus > info.physicalCpus ? 'Active' : 'Inactive'}`}
          />
        )}
      </Box>

      <Box
        sx={{
          p: 2,
          bgcolor: 'background.paper',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider'
        }}
      >
        <NoteEditor key={serverDbId} serverId={serverDbId} initialNote={serverNotes ?? ''} />
      </Box>
    </Stack>
  )
})

// -----------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------

function NameCell({ value }: { value: string }): React.JSX.Element {
  return (
    <Tooltip title={value} placement="top" arrow disableInteractive>
      <Typography variant="body2" noWrap sx={{ width: '100%' }}>
        {value}
      </Typography>
    </Tooltip>
  )
}

// -----------------------------------------------------------------------
// Tab Database — edit dialog
// -----------------------------------------------------------------------

interface DbEditDialogProps {
  open: boolean
  dbName: string
  initial: DbCustomFields
  onClose: () => void
  onSave: (fields: DbCustomFields) => void
}

function DbEditDialog({
  open,
  dbName,
  initial,
  onClose,
  onSave
}: DbEditDialogProps): React.JSX.Element {
  const [alias, setAlias] = useState(initial.alias ?? '')
  const [referente, setReferente] = useState(initial.referente ?? '')

  // Sync when a different row is opened
  useEffect(() => {
    setAlias(initial.alias ?? '')
    setReferente(initial.referente ?? '')
  }, [dbName, initial.alias, initial.referente])

  function handleSave(): void {
    onSave({
      alias: alias.trim() || undefined,
      referente: referente.trim() || undefined
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Edit — {dbName}</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}
      >
        <TextField
          label="Alias"
          placeholder="Alternative name (optional)"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Owner"
          placeholder="Responsible person (optional)"
          value={referente}
          onChange={(e) => setReferente(e.target.value)}
          size="small"
          fullWidth
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// -----------------------------------------------------------------------
// Tab Database
// -----------------------------------------------------------------------

function dbRowClass(db: DatabaseInfo): string {
  if (db.stateDesc === 'OFFLINE') return 'row-db-offline'
  if (
    ['SUSPECT', 'EMERGENCY', 'RESTORING', 'RECOVERING', 'RECOVERY_PENDING'].includes(db.stateDesc)
  ) {
    return 'row-db-warning'
  }
  return ''
}

const DB_SX = {
  border: 0,
  ...GRID_HEADER_SX,
  '& .row-db-offline': {
    bgcolor: tokens.color.errorLight,
    color: tokens.color.error,
    '&:hover': { bgcolor: '#fcc' }
  },
  '& .row-db-warning': {
    bgcolor: tokens.color.warningLight,
    color: tokens.color.warning,
    '&:hover': { bgcolor: '#fecba1' }
  }
} as const

function StatoCell({ stateDesc }: { stateDesc: string }): React.JSX.Element {
  let bgcolor = 'background.default'
  let color = 'text.secondary'
  let borderColor = 'divider'

  if (stateDesc === 'ONLINE') {
    bgcolor = tokens.color.successLight
    color = tokens.color.success
    borderColor = tokens.color.success
  } else if (stateDesc === 'OFFLINE') {
    bgcolor = tokens.color.errorLight
    color = tokens.color.error
    borderColor = tokens.color.error
  } else if (
    ['RESTORING', 'RECOVERING', 'RECOVERY_PENDING', 'SUSPECT', 'EMERGENCY'].includes(stateDesc)
  ) {
    bgcolor = tokens.color.warningLight
    color = tokens.color.warning
    borderColor = tokens.color.warning
  }

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: '10px',
        py: '2px',
        borderRadius: '12px',
        border: '1px solid',
        borderColor,
        bgcolor,
        fontSize: 11,
        fontWeight: 600,
        color,
        letterSpacing: '0.3px',
        lineHeight: 1.4
      }}
    >
      {stateDesc}
    </Box>
  )
}

export const TabDatabase = memo(function TabDatabase({
  databases,
  editingDb,
  setEditingDb,
  handleSaveDbFields
}: {
  databases: DatabaseInfo[]
  editingDb: DatabaseInfo | null
  setEditingDb: (db: DatabaseInfo | null) => void
  handleSaveDbFields: MetricsData['handleSaveDbFields']
}): React.JSX.Element {
  const columns: GridColDef<DatabaseInfo>[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Database',
        flex: 1,
        renderCell: (p) => <NameCell value={p.value as string} />
      },
      {
        field: 'stateDesc',
        headerName: 'State',
        width: 130,
        renderCell: (p) => <StatoCell stateDesc={p.value as string} />
      },
      {
        field: 'alias',
        headerName: 'Alias',
        width: 130,
        renderCell: (p) => (
          <Typography variant="body2" color={p.value ? 'text.primary' : 'text.disabled'} noWrap>
            {(p.value as string | undefined) || '—'}
          </Typography>
        )
      },
      {
        field: 'referente',
        headerName: 'Owner',
        width: 130,
        renderCell: (p) => (
          <Typography variant="body2" color={p.value ? 'text.primary' : 'text.disabled'} noWrap>
            {(p.value as string | undefined) || '—'}
          </Typography>
        )
      },
      { field: 'recoveryModel', headerName: 'Recovery', width: 100 },
      {
        field: 'sizeMb',
        headerName: 'Data (MB)',
        headerAlign: 'right',
        width: 110,
        type: 'number',
        align: 'right',
        valueFormatter: (v: number) => v.toLocaleString('en-US')
      },
      {
        field: 'logSizeMb',
        headerName: 'Log (MB)',
        width: 110,
        type: 'number',
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v: number) => v.toLocaleString('en-US')
      },
      {
        field: 'compatibilityLevel',
        headerName: 'Compat',
        width: 100,
        renderCell: (p) => {
          const level = p.value as number | undefined
          if (!level)
            return (
              <Typography variant="body2" color="text.disabled">
                —
              </Typography>
            )
          return (
            <Tooltip title={`Compatibility level ${level}`}>
              <Typography
                variant="body2"
                sx={{
                  color: level < 130 ? 'warning.main' : 'text.secondary',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {compatLevelToSqlVersion(level)}
              </Typography>
            </Tooltip>
          )
        }
      },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 70,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <IconButton size="small" onClick={() => setEditingDb(p.row as DatabaseInfo)}>
            <EditIcon fontSize="small" />
          </IconButton>
        )
      }
    ],
    [setEditingDb]
  )

  return (
    <>
      <DataGrid<DatabaseInfo>
        rows={databases}
        columns={columns}
        getRowId={(r) => r.name}
        density="compact"
        autoHeight
        disableRowSelectionOnClick
        pageSizeOptions={[25, 50]}
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        getRowClassName={(p) => dbRowClass(p.row as DatabaseInfo)}
        sx={DB_SX}
      />
      {editingDb && (
        <DbEditDialog
          open
          dbName={editingDb.name}
          initial={{
            alias: editingDb.alias,
            referente: editingDb.referente
          }}
          onClose={() => setEditingDb(null)}
          onSave={handleSaveDbFields}
        />
      )}
    </>
  )
})

// -----------------------------------------------------------------------
// Tab Sessioni
// -----------------------------------------------------------------------

function sessionRowClass(session: SessionInfo): string {
  if (session.status === 'suspended' && session.waitTimeMs > 5000) return 'row-session-critical'
  if (session.blockingSessionId > 0) return 'row-session-blocked'
  return ''
}

const SESSION_SX = {
  border: 0,
  ...GRID_HEADER_SX,
  '& .row-session-critical': {
    bgcolor: tokens.color.errorLight,
    color: tokens.color.error,
    '&:hover': { bgcolor: '#fcc' }
  },
  '& .row-session-blocked': {
    bgcolor: tokens.color.warningLight,
    color: tokens.color.warning,
    '&:hover': { bgcolor: '#fecba1' }
  }
} as const

const sessionColumns: GridColDef<SessionInfo>[] = [
  { field: 'sessionId', headerName: 'SID', width: 70, type: 'number' },
  { field: 'status', headerName: 'Status', width: 90 },
  {
    field: 'blockingSessionId',
    headerName: 'Blocked by',
    width: 105,
    type: 'number',
    renderCell: (p) =>
      p.value > 0 ? (
        <Chip label={p.value} size="small" color="error" />
      ) : (
        <Typography variant="body2">—</Typography>
      )
  },
  {
    field: 'waitType',
    headerName: 'Wait type',
    flex: 1,
    renderCell: (p) => (
      <Tooltip title={p.value as string} placement="top" arrow disableInteractive>
        <Typography variant="body2" noWrap sx={{ width: '100%' }}>
          {p.value || '—'}
        </Typography>
      </Tooltip>
    )
  },
  { field: 'waitTimeMs', headerName: 'Wait (ms)', width: 95, type: 'number' },
  { field: 'cpuTime', headerName: 'CPU (ms)', width: 95, type: 'number' },
  { field: 'logicalReads', headerName: 'Logical reads', width: 130, type: 'number' }
]

export function TabSessioni({
  activeSessions
}: {
  activeSessions: SessionInfo[]
}): React.JSX.Element {
  return (
    <DataGrid<SessionInfo>
      rows={activeSessions}
      columns={sessionColumns}
      getRowId={(r) => r.sessionId}
      density="compact"
      autoHeight
      disableRowSelectionOnClick
      pageSizeOptions={[25, 50]}
      initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
      localeText={{ noRowsLabel: 'No active sessions' }}
      getRowClassName={(p) => sessionRowClass(p.row as SessionInfo)}
      sx={SESSION_SX}
    />
  )
}

// -----------------------------------------------------------------------
// Tab Backup
// -----------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000

function backupCellStyle(date: Date | null): React.CSSProperties {
  if (!date) return { color: '#d32f2f', fontWeight: 600 }
  if ((Date.now() - new Date(date).getTime()) / MS_PER_HOUR > 24) {
    return { color: '#d32f2f', fontWeight: 600 }
  }
  return {}
}

function formatBackupDate(date: Date | null): string {
  return date ? new Date(date).toLocaleString('en-US') : 'Never'
}

const backupColumns: GridColDef<BackupInfo>[] = [
  {
    field: 'databaseName',
    headerName: 'Database',
    flex: 1,
    renderCell: (p) => <NameCell value={p.value as string} />
  },
  {
    field: 'lastFullBackup',
    headerName: 'Last Full',
    width: 175,
    renderCell: (p) => (
      <span style={backupCellStyle(p.value as Date | null)}>
        {formatBackupDate(p.value as Date | null)}
      </span>
    )
  },
  {
    field: 'lastDiffBackup',
    headerName: 'Last Diff',
    width: 175,
    renderCell: (p) => (
      <span style={backupCellStyle(p.value as Date | null)}>
        {formatBackupDate(p.value as Date | null)}
      </span>
    )
  },
  {
    field: 'lastLogBackup',
    headerName: 'Last Log',
    width: 175,
    renderCell: (p) => (
      <span style={backupCellStyle(p.value as Date | null)}>
        {formatBackupDate(p.value as Date | null)}
      </span>
    )
  }
]

export function TabBackup({ backupStatus }: { backupStatus: BackupInfo[] }): React.JSX.Element {
  return (
    <DataGrid<BackupInfo>
      rows={backupStatus}
      columns={backupColumns}
      getRowId={(r) => r.databaseName}
      density="compact"
      autoHeight
      disableRowSelectionOnClick
      pageSizeOptions={[25, 50]}
      initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
      localeText={{ noRowsLabel: 'No backup data available' }}
      sx={{ border: 0, ...GRID_HEADER_SX }}
    />
  )
}

// -----------------------------------------------------------------------
// Tab Query top
// -----------------------------------------------------------------------

const queryColumns: GridColDef<QueryRow>[] = [
  {
    field: 'queryText',
    headerName: 'Query',
    flex: 1,
    renderCell: (p) => (
      <Tooltip title={p.value as string} placement="top" arrow disableInteractive>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11 }} noWrap>
          {p.value}
        </Typography>
      </Tooltip>
    )
  },
  { field: 'executionCount', headerName: 'Executions', width: 105, type: 'number' },
  { field: 'totalElapsedTimeMs', headerName: 'Elapsed tot (ms)', width: 140, type: 'number' },
  { field: 'avgCpuTimeMs', headerName: 'Avg CPU (ms)', width: 120, type: 'number' },
  { field: 'avgLogicalReads', headerName: 'Avg reads', width: 110, type: 'number' }
]

export function TabTopQuery({ topQueriesRows }: { topQueriesRows: QueryRow[] }): React.JSX.Element {
  return (
    <DataGrid<QueryRow>
      rows={topQueriesRows}
      columns={queryColumns}
      getRowId={(r) => r._rowId}
      density="compact"
      autoHeight
      disableRowSelectionOnClick
      pageSizeOptions={[25, 50]}
      initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
      localeText={{ noRowsLabel: 'No queries available' }}
      sx={{ border: 0, ...GRID_HEADER_SX }}
    />
  )
}

// -----------------------------------------------------------------------
// Tab Wait Stats
// -----------------------------------------------------------------------

export const WaitPercentCell = memo(function WaitPercentCell({
  value
}: {
  value: number
}): React.JSX.Element {
  const color = value > 20 ? '#ef4444' : value > 10 ? '#f97316' : '#22c55e'
  return (
    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
      <Box sx={{ flex: 1, bgcolor: '#1e293b', borderRadius: 0.5, height: 8, overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.min(100, value)}%`, bgcolor: color, height: '100%' }} />
      </Box>
      <Typography variant="caption" sx={{ minWidth: 42, textAlign: 'right', color }}>
        {value.toFixed(1)}%
      </Typography>
    </Box>
  )
})

const waitStatColumns: GridColDef<WaitStatInfo>[] = [
  {
    field: 'waitType',
    headerName: 'Wait Type',
    flex: 1,
    renderCell: (p) => (
      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
        {p.value as string}
      </Typography>
    )
  },
  {
    field: 'waitPercent',
    headerName: 'Wait %',
    width: 170,
    type: 'number',
    renderCell: (p) => <WaitPercentCell value={p.value as number} />
  },
  {
    field: 'waitTimeMs',
    headerName: 'Wait Time (ms)',
    width: 130,
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    valueFormatter: (v: number) => v.toLocaleString('en-US')
  },
  {
    field: 'maxWaitTimeMs',
    headerName: 'Max Wait (ms)',
    width: 130,
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    valueFormatter: (v: number) => v.toLocaleString('en-US')
  },
  {
    field: 'signalWaitTimeMs',
    headerName: 'Signal Wait (ms)',
    width: 140,
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    valueFormatter: (v: number) => v.toLocaleString('en-US')
  },
  {
    field: 'waitingTasksCount',
    headerName: 'Waiting tasks',
    width: 130,
    type: 'number',
    align: 'right',
    headerAlign: 'right'
  }
]

export function TabWaitStats({ waitStats }: { waitStats: WaitStatInfo[] }): React.JSX.Element {
  return (
    <DataGrid<WaitStatInfo>
      rows={waitStats}
      columns={waitStatColumns}
      getRowId={(r) => r.waitType}
      density="compact"
      autoHeight
      disableRowSelectionOnClick
      pageSizeOptions={[25, 50]}
      initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
      localeText={{ noRowsLabel: 'No wait stats data available' }}
      sx={{ border: 0, ...GRID_HEADER_SX }}
    />
  )
}
