import { useState } from 'react'
import {
  Box,
  Tabs,
  Tab,
  Typography,
  Stack,
  Paper,
  Chip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef } from '@mui/x-data-grid'
import type { ServerMetrics, DatabaseInfo, SessionInfo, QueryInfo, BackupInfo } from '../../../preload/index'
import { MemoryChart } from './MemoryChart'
import type { MetricsHistoryPoint } from '../hooks/useMetrics'

interface Props {
  metrics: ServerMetrics
  history: MetricsHistoryPoint[]
}

// -----------------------------------------------------------------------
// Tab Panoramica
// -----------------------------------------------------------------------

function InfoCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 160 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body1" fontWeight={600}>
        {value}
      </Typography>
    </Paper>
  )
}

function TabPanoramica({ metrics, history }: Props): React.JSX.Element {
  const info = metrics.instanceInfo
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} flexWrap="wrap">
        <InfoCard label="Versione" value={info.version} />
        <InfoCard label="Edizione" value={info.edition} />
        <InfoCard label="Memoria usata" value={`${info.memoryUsedMb.toLocaleString('it-IT')} MB`} />
        <InfoCard label="CPU" value={`${info.cpuUsagePercent.toFixed(1)} %`} />
        <InfoCard label="Uptime" value={`${info.uptimeDays.toFixed(1)} giorni`} />
      </Stack>
      {history.length > 1 && <MemoryChart history={history} />}
      {history.length <= 1 && (
        <Typography variant="body2" color="text.secondary">
          Il grafico sarà disponibile dopo almeno 2 raccolte di metriche.
        </Typography>
      )}
    </Stack>
  )
}

// -----------------------------------------------------------------------
// Tab Database
// -----------------------------------------------------------------------

const dbColumns: GridColDef<DatabaseInfo>[] = [
  { field: 'name', headerName: 'Database', flex: 1 },
  { field: 'stateDesc', headerName: 'Stato', width: 110 },
  { field: 'recoveryModel', headerName: 'Recovery', width: 100 },
  {
    field: 'sizeMb',
    headerName: 'Dati (MB)',
    width: 110,
    type: 'number',
    align: 'right',
    headerAlign: 'right',
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
  }
]

// -----------------------------------------------------------------------
// Tab Sessioni
// -----------------------------------------------------------------------

const sessionColumns: GridColDef<SessionInfo>[] = [
  { field: 'sessionId', headerName: 'SID', width: 70, type: 'number' },
  { field: 'status', headerName: 'Stato', width: 90 },
  {
    field: 'blockingSessionId',
    headerName: 'Bloccato da',
    width: 105,
    type: 'number',
    renderCell: (params) =>
      params.value > 0 ? (
        <Chip label={params.value} size="small" color="error" />
      ) : (
        <Typography variant="body2">—</Typography>
      )
  },
  { field: 'waitType', headerName: 'Wait type', flex: 1 },
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
  const ageH = (Date.now() - new Date(date).getTime()) / MS_PER_HOUR
  if (ageH > 24) return { color: '#d32f2f', fontWeight: 600 }
  return {}
}

function formatBackupDate(date: Date | null): string {
  if (!date) return 'Mai'
  return new Date(date).toLocaleString('it-IT')
}

const backupColumns: GridColDef<BackupInfo>[] = [
  { field: 'databaseName', headerName: 'Database', flex: 1 },
  {
    field: 'lastFullBackup',
    headerName: 'Ultimo Full',
    width: 175,
    renderCell: (params) => (
      <span style={backupCellStyle(params.value as Date | null)}>
        {formatBackupDate(params.value as Date | null)}
      </span>
    )
  },
  {
    field: 'lastDiffBackup',
    headerName: 'Ultimo Diff',
    width: 175,
    renderCell: (params) => (
      <span style={backupCellStyle(params.value as Date | null)}>
        {formatBackupDate(params.value as Date | null)}
      </span>
    )
  },
  {
    field: 'lastLogBackup',
    headerName: 'Ultimo Log',
    width: 175,
    renderCell: (params) => (
      <span style={backupCellStyle(params.value as Date | null)}>
        {formatBackupDate(params.value as Date | null)}
      </span>
    )
  }
]

// -----------------------------------------------------------------------
// Tab Query top
// -----------------------------------------------------------------------

const queryColumns: GridColDef<QueryInfo>[] = [
  { field: 'queryText', headerName: 'Query', flex: 1, renderCell: (params) => (
    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11 }} noWrap title={params.value as string}>
      {params.value}
    </Typography>
  )},
  { field: 'executionCount', headerName: 'Esecuzioni', width: 105, type: 'number' },
  { field: 'totalElapsedTimeMs', headerName: 'Elapsed tot (ms)', width: 140, type: 'number' },
  { field: 'avgCpuTimeMs', headerName: 'Avg CPU (ms)', width: 120, type: 'number' },
  { field: 'avgLogicalReads', headerName: 'Avg letture', width: 110, type: 'number' }
]

// -----------------------------------------------------------------------
// Componente principale
// -----------------------------------------------------------------------

export function MetricsPanel({ metrics, history }: Props): React.JSX.Element {
  const [tab, setTab] = useState(0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Tabs value={tab} onChange={(_e, v) => setTab(v as number)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Panoramica" />
        <Tab label={`Database (${metrics.databases.length})`} />
        <Tab label={`Sessioni (${metrics.activeSessions.length})`} />
        <Tab label="Backup" />
        <Tab label={`Top Query (${metrics.topQueries.length})`} />
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', pt: 2 }}>
        {tab === 0 && <TabPanoramica metrics={metrics} history={history} />}

        {tab === 1 && (
          <DataGrid<DatabaseInfo>
            rows={metrics.databases}
            columns={dbColumns}
            getRowId={(r) => r.name}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            sx={{ border: 0 }}
          />
        )}

        {tab === 2 && (
          <DataGrid<SessionInfo>
            rows={metrics.activeSessions}
            columns={sessionColumns}
            getRowId={(r) => r.sessionId}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            localeText={{ noRowsLabel: 'Nessuna sessione attiva' }}
            sx={{ border: 0 }}
          />
        )}

        {tab === 3 && (
          <DataGrid<BackupInfo>
            rows={metrics.backupStatus}
            columns={backupColumns}
            getRowId={(r) => r.databaseName}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            localeText={{ noRowsLabel: 'Nessun dato backup disponibile' }}
            sx={{ border: 0 }}
          />
        )}

        {tab === 4 && (
          <DataGrid<QueryInfo>
            rows={metrics.topQueries.map((q, i) => ({ ...q, _idx: i }))}
            columns={queryColumns}
            getRowId={(r) => (r as QueryInfo & { _idx: number })._idx}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            localeText={{ noRowsLabel: 'Nessuna query disponibile' }}
            sx={{ border: 0 }}
          />
        )}
      </Box>
    </Box>
  )
}
