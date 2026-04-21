import { useState } from 'react'
import { useGroupsStore } from '../store/groupsStore'
import {
  Box,
  Stack,
  Paper,
  Alert,
  Button,
  TextField,
  Typography,
  LinearProgress,
  Chip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef } from '@mui/x-data-grid'
import { ServerStatusChip } from '../components/ServerStatusChip'
import { AddServerDialog } from '../components/AddServerDialog'
import type { AddServerFormData } from '../components/AddServerDialog'
import { useDiscovery } from '../hooks/useDiscovery'
import type { DiscoveryRow } from '../hooks/useDiscovery'
import { useServersStore } from '../store/serversStore'

// -----------------------------------------------------------------------
// Parsing porte da stringa "1433,1434" → [1433, 1434]
// -----------------------------------------------------------------------

function parsePorts(input: string): number[] {
  return input
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535)
}

// -----------------------------------------------------------------------
// Componente principale
// -----------------------------------------------------------------------

export function Discovery(): React.JSX.Element {
  const { servers, isScanning, progress, error, scan } = useDiscovery()
  const { setServerGroup, setServerAlias } = useGroupsStore()
  const savedServers = useServersStore((s) => s.servers)

  const isAlreadySaved = (row: DiscoveryRow): boolean =>
    savedServers.some((s) => (s.host ?? s.ip) === row.ip && s.port === row.port)

  // --- Form stato scan ---
  const [cidr, setCidr] = useState('192.168.1.0/24')
  const [portsInput, setPortsInput] = useState('1433,1434')
  const [concurrency, setConcurrency] = useState(50)
  const [cidrError, setCidrError] = useState('')

  // --- Dialog stato ---
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogInitialIp, setDialogInitialIp] = useState<string | undefined>()
  const [dialogInitialPort, setDialogInitialPort] = useState<number | undefined>()

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleScan = async (): Promise<void> => {
    const cidrTrimmed = cidr.trim()
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(cidrTrimmed)) {
      setCidrError('Formato non valido. Usa la notazione CIDR, es. 192.168.1.0/24')
      return
    }
    setCidrError('')
    await scan({
      cidr: cidrTrimmed,
      ports: parsePorts(portsInput),
      timeoutMs: 500,
      concurrency
    })
  }

  const openDialogManual = (): void => {
    setDialogInitialIp(undefined)
    setDialogInitialPort(undefined)
    setDialogOpen(true)
  }

  const openDialogFromRow = (row: DiscoveryRow): void => {
    setDialogInitialIp(row.ip)
    setDialogInitialPort(row.port)
    setDialogOpen(true)
  }

  const handleDialogSave = async (data: AddServerFormData): Promise<void> => {
    const result = await useServersStore.getState().addServer({
      host: data.ip,
      port: data.port,
      instanceName: data.instanceName || undefined,
      machineName: data.machineName || undefined,
      useWindowsAuth: data.useWindowsAuth,
      username: data.username || undefined,
      password: data.password || undefined,
      hostingType: data.hostingType
    })
    // Use server UUID for group/alias keys; fall back to ip:port key for group (still keyed that way)
    const newServer = result?.server ?? useServersStore.getState().servers.find(
      (s) => (s.host === data.ip || s.ip === data.ip) && s.port === data.port
    )
    const sid = `${data.ip}:${data.port}`
    if (data.groupId) setServerGroup(sid, data.groupId)
    if (data.alias?.trim() && newServer) setServerAlias(newServer.id, data.alias.trim())
    setDialogOpen(false)
  }

  // -----------------------------------------------------------------------
  // Colonne DataGrid
  // -----------------------------------------------------------------------

  const columns: GridColDef<DiscoveryRow>[] = [
    {
      field: 'ip',
      headerName: 'IP / Hostname',
      width: 160,
      valueGetter: (_value, row) => row.ip
    },
    {
      field: 'port',
      headerName: 'Porta',
      width: 80,
      type: 'number',
      align: 'left',
      headerAlign: 'left'
    },
    {
      field: 'reachable',
      headerName: 'Stato',
      width: 190,
      sortable: false,
      renderCell: (params) => (
        <ServerStatusChip reachable={params.row.reachable} responseTimeMs={params.row.responseTimeMs} />
      )
    },
    {
      field: 'responseTimeMs',
      headerName: 'Risposta (ms)',
      width: 130,
      type: 'number',
      align: 'left',
      headerAlign: 'left',
      valueFormatter: (value: number | undefined) => (value !== undefined ? `${value} ms` : '—')
    },
    {
      field: 'discoveryType',
      headerName: 'Tipo discovery',
      width: 130,
      renderCell: (params) => (
        <Chip
          label={params.row.discoveryType === 'auto-tcp' ? 'Auto-TCP' : 'Manuale'}
          size="small"
          variant="outlined"
          color={params.row.discoveryType === 'auto-tcp' ? 'primary' : 'secondary'}
        />
      )
    },
    {
      field: 'actions',
      headerName: 'Azioni',
      width: 200,
      sortable: false,
      renderCell: (params) =>
        isAlreadySaved(params.row) ? (
          <Chip label="Già monitorato" size="small" variant="outlined" sx={{ fontSize: 11 }} />
        ) : (
          <Button size="small" variant="outlined" onClick={() => openDialogFromRow(params.row)}>
            + Monitora
          </Button>
        )
    }
  ]

  // -----------------------------------------------------------------------
  // Progress
  // -----------------------------------------------------------------------

  const progressPercent = progress ? Math.round((progress.completed / progress.total) * 100) : 0
  const progressLabel = progress
    ? `${progress.completed}/${progress.total} host scansionati, ${progress.found} trovati`
    : ''

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Banner warning named instances */}
      <Alert severity="warning">
        <strong>Named instances su porte dinamiche non sono auto-discoverable.</strong> Se conosci
        l'IP e la porta statica, aggiungile manualmente con il pulsante qui sotto.
      </Alert>

      {/* Form di scan */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start" flexWrap="wrap">
          <TextField
            label="Subnet CIDR"
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            error={!!cidrError}
            helperText={cidrError || 'es. 192.168.1.0/24'}
            size="small"
            sx={{ minWidth: 200 }}
          />
          <TextField
            label="Porte aggiuntive"
            value={portsInput}
            onChange={(e) => setPortsInput(e.target.value)}
            helperText="Separate da virgola"
            size="small"
            sx={{ minWidth: 160 }}
          />
          <TextField
            label="Concorrenza"
            type="number"
            value={concurrency}
            onChange={(e) => setConcurrency(Math.max(1, Math.min(200, Number(e.target.value))))}
            helperText="Probe parallele (1–200)"
            size="small"
            inputProps={{ min: 1, max: 200 }}
            sx={{ width: 130 }}
          />
          <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
            <Button
              variant="contained"
              onClick={handleScan}
              disabled={isScanning}
            >
              {isScanning ? 'Scansione...' : 'Avvia Scan'}
            </Button>
            <Button variant="outlined" onClick={openDialogManual} disabled={isScanning}>
              Aggiungi Manualmente
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Progress bar */}
      {isScanning && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {progressLabel}
          </Typography>
          <LinearProgress variant={progress ? 'determinate' : 'indeterminate'} value={progressPercent} />
        </Box>
      )}

      {/* Errore */}
      {error && (
        <Alert severity="error" onClose={() => {}}>
          {error}
        </Alert>
      )}

      {/* Tabella risultati */}
      <Box sx={{ flex: 1, minHeight: 300 }}>
        <DataGrid<DiscoveryRow>
          rows={servers}
          columns={columns}
          getRowId={(row) => `${row.ip}:${row.port}`}
          getRowClassName={(params) => (isAlreadySaved(params.row) ? 'row-already-saved' : '')}
          density="compact"
          disableRowSelectionOnClick
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          localeText={{
            noRowsLabel: isScanning ? 'Scansione in corso...' : 'Nessun server trovato. Avvia una scan o aggiungi manualmente.'
          }}
          sx={{ border: 0, '& .row-already-saved': { opacity: 0.45 } }}
        />
      </Box>

      {/* Dialog aggiungi server */}
      <AddServerDialog
        open={dialogOpen}
        initialIp={dialogInitialIp}
        initialPort={dialogInitialPort}
        onClose={() => setDialogOpen(false)}
        onSave={handleDialogSave}
      />
    </Box>
  )
}
