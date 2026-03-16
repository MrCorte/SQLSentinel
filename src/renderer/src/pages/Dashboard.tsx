import { useState, useEffect } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Divider
} from '@mui/material'
import type { DiscoveredServer, CollectMetricsRequest } from '../../../preload/index'
import { useMetrics } from '../hooks/useMetrics'
import { MetricsPanel } from '../components/MetricsPanel'
import { ServerStatusChip } from '../components/ServerStatusChip'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function serverLabel(s: DiscoveredServer): string {
  return `${s.ip}:${s.port}`
}

function toCollectRequest(server: DiscoveredServer): CollectMetricsRequest {
  // Windows Auth di default — le credenziali vengono gestite in FASE futura
  return {
    ip: server.ip,
    port: server.port,
    useWindowsAuth: true
  }
}

// -----------------------------------------------------------------------
// Componente principale
// -----------------------------------------------------------------------

export function Dashboard(): React.JSX.Element {
  const [servers, setServers] = useState<DiscoveredServer[]>([])
  const [serversError, setServersError] = useState<string | null>(null)
  const [selectedServer, setSelectedServer] = useState<DiscoveredServer | null>(null)

  const connection = selectedServer ? toCollectRequest(selectedServer) : null
  const { metrics, isLoading, error, history, refresh, autoRefreshSeconds, setAutoRefreshSeconds } =
    useMetrics(connection)

  // Carica la lista server all'avvio
  useEffect(() => {
    window.sqlSentinel.getServers().then((result) => {
      if (result.ok) {
        setServers(result.data)
        if (result.data.length > 0) setSelectedServer(result.data[0])
      } else {
        setServersError(result.error)
      }
    })
  }, [])

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ---- Lista server (sidebar sinistra) ---- */}
      <Paper
        variant="outlined"
        square
        sx={{ width: 220, display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}
      >
        <Typography variant="subtitle2" sx={{ p: 1.5, pb: 0.5, fontWeight: 700 }}>
          Server monitorati
        </Typography>
        <Divider />
        {serversError && (
          <Alert severity="error" sx={{ m: 1 }}>
            {serversError}
          </Alert>
        )}
        {servers.length === 0 && !serversError && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
            Nessun server trovato. Usare la pagina Discovery per aggiungere server.
          </Typography>
        )}
        <List dense sx={{ flex: 1, overflow: 'auto' }}>
          {servers.map((s) => (
            <ListItemButton
              key={serverLabel(s)}
              selected={selectedServer ? serverLabel(selectedServer) === serverLabel(s) : false}
              onClick={() => setSelectedServer(s)}
            >
              <ListItemText
                primary={serverLabel(s)}
                secondary={<ServerStatusChip reachable={s.reachable} responseTimeMs={s.responseTimeMs} />}
                secondaryTypographyProps={{ component: 'div' }}
              />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      {/* ---- Area metriche (destra) ---- */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', p: 2, gap: 1.5 }}>
        {!selectedServer && (
          <Alert severity="info">Seleziona un server dalla lista per visualizzare le metriche.</Alert>
        )}

        {selectedServer && (
          <>
            {/* Toolbar */}
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <Typography variant="h6" sx={{ flex: 1, fontWeight: 700 }}>
                {serverLabel(selectedServer)}
              </Typography>

              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Auto-refresh</InputLabel>
                <Select
                  label="Auto-refresh"
                  value={autoRefreshSeconds}
                  onChange={(e) => setAutoRefreshSeconds(e.target.value as number)}
                >
                  <MenuItem value={0}>Disabilitato</MenuItem>
                  <MenuItem value={30}>Ogni 30 s</MenuItem>
                  <MenuItem value={60}>Ogni 60 s</MenuItem>
                  <MenuItem value={120}>Ogni 2 min</MenuItem>
                  <MenuItem value={300}>Ogni 5 min</MenuItem>
                </Select>
              </FormControl>

              <Button
                variant="contained"
                onClick={refresh}
                disabled={isLoading}
                startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {isLoading ? 'Raccolta...' : 'Aggiorna metriche'}
              </Button>
            </Stack>

            {/* Errore raccolta */}
            {error && <Alert severity="error">{error}</Alert>}

            {/* Pannello metriche */}
            {metrics ? (
              <Box sx={{ flex: 1, overflow: 'hidden' }}>
                <MetricsPanel metrics={metrics} history={history} />
              </Box>
            ) : (
              !isLoading && !error && (
                <Alert severity="info">
                  Premi "Aggiorna metriche" per raccogliere i dati dal server selezionato.
                </Alert>
              )
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
