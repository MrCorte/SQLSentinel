import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box,
  Tabs,
  Tab,
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
  QueryInfo,
  BackupInfo,
  WaitStatInfo,
  DbCustomFields,
  CollectMetricsRequest
} from '../../../preload/index'
import { DisksTab } from './tabs/DisksTab'
import { tokens } from '../styles/tokens'

interface Props {
  metrics: ServerMetrics
  serverId: string
  connection: CollectMetricsRequest
}

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
  label, value, accent, tooltip
}: {
  label: string; value: string; accent: string; tooltip?: string
}): React.JSX.Element {
  const card = (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderTop: `3px solid ${accent}`,
        borderRadius: tokens.radius.sm,
        px: '20px',
        py: '16px',
        minWidth: 150,
        flex: '1 1 150px',
        boxShadow: tokens.shadow.card,
        cursor: tooltip ? 'help' : 'default'
      }}
    >
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: tokens.font.weightSemibold,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'text.secondary',
          mb: '8px',
          display: 'block'
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 18,
          fontWeight: 600,
          color: 'text.primary',
          lineHeight: 1.2
        }}
      >
        {value}
      </Typography>
    </Box>
  )
  return tooltip
    ? <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>} placement="top" arrow>{card}</Tooltip>
    : card
}

function TabPanoramica({ metrics }: Pick<Props, 'metrics'>): React.JSX.Element {
  const info = metrics.instanceInfo
  const memPercent = info.memoryTargetMb > 0 ? (info.memoryUsedMb / info.memoryTargetMb) * 100 : 0

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <KpiCard label="Versione" value={info.version} accent={kpiAccent('blue', 0)} />
        <KpiCard label="Edizione" value={info.edition} accent={kpiAccent('blue', 0)} />
        <KpiCard
          label="Memoria usata"
          value={`${info.memoryUsedMb.toLocaleString('it-IT')} MB`}
          accent={kpiAccent('health', memPercent > 90 ? 90 : memPercent > 70 ? 70 : 0)}
        />
        <KpiCard
          label="CPU"
          value={`${info.cpuUsagePercent.toFixed(1)} %`}
          accent={kpiAccent('health', info.cpuUsagePercent)}
        />
        <KpiCard label="Uptime" value={`${info.uptimeDays.toFixed(1)} giorni`} accent={kpiAccent('blue', 0)} />
        {info.logicalCpus > 0 && (
          <KpiCard
            label="CPU Logici"
            value={`${info.physicalCpus}C / ${info.logicalCpus}T`}
            accent={kpiAccent('blue', 0)}
            tooltip={`Core fisici: ${info.physicalCpus}\nThread logici: ${info.logicalCpus}\nHyperthreading: ${info.logicalCpus > info.physicalCpus ? 'Attivo' : 'Non attivo'}`}
          />
        )}
      </Box>
    </Stack>
  )
}

// -----------------------------------------------------------------------
// Helpers condivisi
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
      <DialogTitle>Modifica — {dbName}</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}
      >
        <TextField
          label="Alias"
          placeholder="Nome alternativo (opzionale)"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Referente"
          placeholder="Responsabile (opzionale)"
          value={referente}
          onChange={(e) => setReferente(e.target.value)}
          size="small"
          fullWidth
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" onClick={handleSave}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// -----------------------------------------------------------------------
// Tab Database
// -----------------------------------------------------------------------

type DatabaseRow = DatabaseInfo

function dbRowClass(db: DatabaseRow): string {
  if (db.stateDesc === 'OFFLINE') return 'row-db-offline'
  if (
    ['SUSPECT', 'EMERGENCY', 'RESTORING', 'RECOVERING', 'RECOVERY_PENDING'].includes(db.stateDesc)
  ) {
    return 'row-db-warning'
  }
  return ''
}

const GRID_HEADER_SX = {
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
  } else if (['RESTORING', 'RECOVERING', 'RECOVERY_PENDING', 'SUSPECT', 'EMERGENCY'].includes(stateDesc)) {
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
        border: `1px solid ${borderColor}`,
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

function TabDatabase({
  metrics,
  serverId
}: {
  metrics: ServerMetrics
  serverId: string
}): React.JSX.Element {
  const [customFields, setCustomFields] = useState<Record<string, DbCustomFields>>({})
  const [editingDb, setEditingDb] = useState<DatabaseRow | null>(null)

  useEffect(() => {
    window.sqlSentinel
      .getAllDbCustomFields()
      .then((r) => {
        if (r.ok) setCustomFields(r.data)
        else console.error('[TabDatabase] getAllDbCustomFields error:', r.error)
      })
      .catch((err) => console.error('[TabDatabase] getAllDbCustomFields threw:', err))
  }, [])

  const databases: DatabaseRow[] = useMemo(
    () =>
      (metrics.databases ?? []).map((db) => {
        const cf = customFields[`${serverId}/${db.name}`]
        return {
          ...db,
          alias: cf?.alias ?? db.alias,
          referente: cf?.referente ?? db.referente
        }
      }),
    [metrics.databases, customFields, serverId]
  )

  console.log('[TabDatabase] databases:', databases)
  console.log('[TabDatabase] customFields:', customFields)

  const handleSave = useCallback(
    async (fields: DbCustomFields) => {
      if (!editingDb) return
      const result = await window.sqlSentinel.setDbCustomFields({
        serverId,
        dbName: editingDb.name,
        fields
      })
      if (result.ok) {
        setCustomFields((prev) => ({
          ...prev,
          [`${serverId}/${editingDb.name}`]: fields
        }))
        setEditingDb(null)
      }
    },
    [editingDb, serverId]
  )

  const columns: GridColDef<DatabaseRow>[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Database',
        flex: 1,
        renderCell: (p) => <NameCell value={p.value as string} />
      },
      {
        field: 'stateDesc',
        headerName: 'Stato',
        width: 130,
        renderCell: (p) => <StatoCell stateDesc={p.value as string} />
      },
      {
        field: 'alias',
        headerName: 'Alias',
        width: 130,
        renderCell: (p) => (
          <Typography
            variant="body2"
            color={p.value ? 'text.primary' : 'text.disabled'}
            noWrap
          >
            {(p.value as string | undefined) || '—'}
          </Typography>
        )
      },
      {
        field: 'referente',
        headerName: 'Referente',
        width: 130,
        renderCell: (p) => (
          <Typography
            variant="body2"
            color={p.value ? 'text.primary' : 'text.disabled'}
            noWrap
          >
            {(p.value as string | undefined) || '—'}
          </Typography>
        )
      },
      { field: 'recoveryModel', headerName: 'Recovery', width: 100 },
      {
        field: 'sizeMb',
        headerName: 'Dati (MB)',
        headerAlign: 'right',
        width: 110,
        type: 'number',
        align: 'right',
        valueFormatter: (v: number) => v.toLocaleString('it-IT')
      },
      {
        field: 'logSizeMb',
        headerName: 'Log (MB)',
        width: 110,
        type: 'number',
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v: number) => v.toLocaleString('it-IT')
      },
      {
        field: 'actions',
        headerName: 'Azioni',
        width: 70,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <IconButton size="small" onClick={() => setEditingDb(p.row as DatabaseRow)}>
            <EditIcon fontSize="small" />
          </IconButton>
        )
      }
    ],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <>
      <DataGrid<DatabaseRow>
        rows={databases}
        columns={columns}
        getRowId={(r) => r.name}
        density="compact"
        disableRowSelectionOnClick
        pageSizeOptions={[25, 50]}
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        getRowClassName={(p) => dbRowClass(p.row as DatabaseRow)}
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
          onSave={handleSave}
        />
      )}
    </>
  )
}

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
  { field: 'status', headerName: 'Stato', width: 90 },
  {
    field: 'blockingSessionId',
    headerName: 'Bloccato da',
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
  { field: 'logicalReads', headerName: 'Letture logiche', width: 130, type: 'number' }
]

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
  return date ? new Date(date).toLocaleString('it-IT') : 'Mai'
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
    headerName: 'Ultimo Full',
    width: 175,
    renderCell: (p) => (
      <span style={backupCellStyle(p.value as Date | null)}>
        {formatBackupDate(p.value as Date | null)}
      </span>
    )
  },
  {
    field: 'lastDiffBackup',
    headerName: 'Ultimo Diff',
    width: 175,
    renderCell: (p) => (
      <span style={backupCellStyle(p.value as Date | null)}>
        {formatBackupDate(p.value as Date | null)}
      </span>
    )
  },
  {
    field: 'lastLogBackup',
    headerName: 'Ultimo Log',
    width: 175,
    renderCell: (p) => (
      <span style={backupCellStyle(p.value as Date | null)}>
        {formatBackupDate(p.value as Date | null)}
      </span>
    )
  }
]

// -----------------------------------------------------------------------
// Tab Query top
// -----------------------------------------------------------------------

const queryColumns: GridColDef<QueryInfo>[] = [
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
  { field: 'executionCount', headerName: 'Esecuzioni', width: 105, type: 'number' },
  { field: 'totalElapsedTimeMs', headerName: 'Elapsed tot (ms)', width: 140, type: 'number' },
  { field: 'avgCpuTimeMs', headerName: 'Avg CPU (ms)', width: 120, type: 'number' },
  { field: 'avgLogicalReads', headerName: 'Avg letture', width: 110, type: 'number' }
]

// -----------------------------------------------------------------------
// Tab Wait Stats
// -----------------------------------------------------------------------

function WaitPercentCell({ value }: { value: number }): React.JSX.Element {
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
}

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
    valueFormatter: (v: number) => v.toLocaleString('it-IT')
  },
  {
    field: 'maxWaitTimeMs',
    headerName: 'Max Wait (ms)',
    width: 130,
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    valueFormatter: (v: number) => v.toLocaleString('it-IT')
  },
  {
    field: 'signalWaitTimeMs',
    headerName: 'Signal Wait (ms)',
    width: 140,
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    valueFormatter: (v: number) => v.toLocaleString('it-IT')
  },
  {
    field: 'waitingTasksCount',
    headerName: 'Tasks in attesa',
    width: 130,
    type: 'number',
    align: 'right',
    headerAlign: 'right'
  }
]

// -----------------------------------------------------------------------
// Componente principale
// -----------------------------------------------------------------------

export function MetricsPanel({ metrics, serverId, connection }: Props): React.JSX.Element {
  const [tab, setTab] = useState(0)

  const databases = metrics?.databases ?? []
  const activeSessions = metrics?.activeSessions ?? []
  const backupStatus = metrics?.backupStatus ?? []
  const diskVolumes = metrics?.diskVolumes ?? []
  const databaseFiles = metrics?.databaseFiles ?? []
  const topQueries = metrics?.topQueries ?? []
  const waitStats = metrics?.waitStats ?? []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderBottomColor: 'divider',
        }}
      >
        <Tabs
          value={tab}
          onChange={(_e, v) => setTab(v as number)}
          sx={{
            minHeight: 36,
            '& .MuiTab-root': {
              minHeight: 36,
              fontSize: tokens.font.sizeBase,
              fontWeight: tokens.font.weightSemibold,
              color: 'text.secondary',
              py: 0,
              textTransform: 'none',
              '&.Mui-selected': { color: tokens.color.primary }
            },
            '& .MuiTabs-indicator': {
              backgroundColor: tokens.color.primary,
              height: 2
            }
          }}
        >
          <Tab label="Panoramica" />
          <Tab label={`Database (${databases.length})`} />
          <Tab label={`Sessioni (${activeSessions.length})`} />
          <Tab label="Backup" />
          <Tab label={`Dischi (${diskVolumes.length})`} />
          <Tab label={`Top Query (${topQueries.length})`} />
          <Tab label={`Wait Stats (${waitStats.length})`} />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', pt: 2 }}>
        {tab === 0 && <TabPanoramica metrics={metrics} />}

        {tab === 1 && <TabDatabase metrics={metrics} serverId={serverId} />}

        {tab === 2 && (
          <DataGrid<SessionInfo>
            rows={activeSessions}
            columns={sessionColumns}
            getRowId={(r) => r.sessionId}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            localeText={{ noRowsLabel: 'Nessuna sessione attiva' }}
            getRowClassName={(p) => sessionRowClass(p.row as SessionInfo)}
            sx={SESSION_SX}
          />
        )}

        {tab === 3 && (
          <DataGrid<BackupInfo>
            rows={backupStatus}
            columns={backupColumns}
            getRowId={(r) => r.databaseName}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            localeText={{ noRowsLabel: 'Nessun dato backup disponibile' }}
            sx={{ border: 0, ...GRID_HEADER_SX }}
          />
        )}

        {tab === 4 && (
          <DisksTab diskVolumes={diskVolumes} databaseFiles={databaseFiles} connection={connection} />
        )}

        {tab === 5 && (
          <DataGrid<QueryInfo>
            rows={topQueries.map((q, i) => ({ ...q, _idx: i }))}
            columns={queryColumns}
            getRowId={(r) => (r as QueryInfo & { _idx: number })._idx}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            localeText={{ noRowsLabel: 'Nessuna query disponibile' }}
            sx={{ border: 0, ...GRID_HEADER_SX }}
          />
        )}

        {tab === 6 && (
          <DataGrid<WaitStatInfo>
            rows={waitStats}
            columns={waitStatColumns}
            getRowId={(r) => r.waitType}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            localeText={{ noRowsLabel: 'Nessun dato wait stats disponibile' }}
            sx={{ border: 0, ...GRID_HEADER_SX }}
          />
        )}
      </Box>
    </Box>
  )
}
