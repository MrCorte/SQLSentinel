import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box,
  Stack,
  Typography,
  Button,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  IconButton,
  Tooltip
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { StoredServer, CollectMetricsRequest } from '../../../preload/index'
import { useMetrics } from '../hooks/useMetrics'
import { useWorker } from '../context/useWorker'
import { MetricsPanel } from '../components/MetricsPanel'
import { AgDashboard } from '../components/AgDashboard'
import { Sidebar } from '../components/Sidebar'
import { useGroupsStore } from '../store/groupsStore'
import { useServersStore } from '../store/serversStore'
import { useAgStore } from '../store/agStore'
import { getServerDisplayName } from '../types/index'
import { tokens } from '../styles/tokens'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function serverLabel(s: StoredServer): string {
  return `${s.ip}:${s.port}`
}

function toCollectRequest(server: StoredServer): CollectMetricsRequest {
  return {
    ip: server.ip,
    port: server.port,
    instanceName: server.instanceName,
    useWindowsAuth: server.useWindowsAuth,
    username: server.username,
    password: server.password
  }
}

// -----------------------------------------------------------------------
// Componente principale
// -----------------------------------------------------------------------

export function Dashboard(): React.JSX.Element {
  const { servers, initialized, removeServer, updateServer } = useServersStore()
  const { detectAgsForServer } = useAgStore()
  const [selectedServer, setSelectedServer] = useState<StoredServer | null>(null)
  const [selectedAgName, setSelectedAgName] = useState<string | null>(null)
  const [retriggering, setRetriggering] = useState(false)

  const { intervalSeconds, setIntervalSeconds, setConnection, getHistory, pushSnapshot } =
    useWorker()
  const { serverAliases, setServerAlias } = useGroupsStore()

  // Inline alias editing
  const [editingAlias, setEditingAlias] = useState(false)
  const [aliasInput, setAliasInput] = useState('')
  const aliasInputRef = useRef<HTMLInputElement | null>(null)

  const connection = selectedServer ? toCollectRequest(selectedServer) : null
  const selectedServerId = selectedServer ? serverLabel(selectedServer) : null

  const { metrics, isLoading, error, refresh, receiveMetrics } = useMetrics(connection, {
    onReceived: pushSnapshot
  })

  const history = selectedServerId ? getHistory(selectedServerId) : []
  console.log('[Dashboard] reading history for', selectedServerId, 'punti:', history.length)

  // Auto-select first server when store initializes
  useEffect(() => {
    if (initialized && servers.length > 0 && selectedServer === null) {
      setSelectedServer(servers[0])
    }
  }, [initialized, servers.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep selectedServer in sync if the server entry is updated in the store
  useEffect(() => {
    if (!selectedServer) return
    const updated = servers.find((s) => s.id === selectedServer.id)
    if (updated && updated !== selectedServer) setSelectedServer(updated)
  }, [servers]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setConnection(connection)
  }, [connection?.ip, connection?.port]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedServerId) return
    refresh()
  }, [selectedServerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect AG membership for each server after store loads
  useEffect(() => {
    if (!initialized) return
    for (const s of servers) {
      detectAgsForServer(s.id, toCollectRequest(s))
    }
  }, [initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectServer = useCallback((server: StoredServer): void => {
    setSelectedServer(server)
    setSelectedAgName(null)
  }, [])

  const handleSelectAg = useCallback((agName: string): void => {
    setSelectedAgName(agName)
    setSelectedServer(null)
  }, [])

  const stablePushSnapshot = useCallback(pushSnapshot, [pushSnapshot])
  const stableReceiveMetrics = useCallback(receiveMetrics, [receiveMetrics])

  useEffect(() => {
    const unsub = window.sqlSentinel.onMetricsUpdated(({ serverId, metrics: m }) => {
      stablePushSnapshot(serverId, m)
      if (serverId === selectedServerId) stableReceiveMetrics(m)
    })
    return unsub
  }, [selectedServerId, stablePushSnapshot, stableReceiveMetrics])

  // Inline alias edit helpers
  const startEditAlias = useCallback((): void => {
    if (!selectedServer) return
    setAliasInput(serverAliases[serverLabel(selectedServer)] ?? '')
    setEditingAlias(true)
    setTimeout(() => aliasInputRef.current?.select(), 0)
  }, [selectedServer, serverAliases])

  const confirmEditAlias = useCallback((): void => {
    if (!selectedServer) return
    setServerAlias(serverLabel(selectedServer), aliasInput)
    setEditingAlias(false)
  }, [selectedServer, aliasInput, setServerAlias])

  const cancelEditAlias = useCallback((): void => {
    setEditingAlias(false)
  }, [])

  // Remove server via store (persists to electron-store)
  const handleRemoveServer = useCallback(
    async (server: StoredServer): Promise<void> => {
      await removeServer(server.id)
      if (selectedServer?.id === server.id) setSelectedServer(null)
    },
    [selectedServer, removeServer]
  )

  // Immediate health check for the selected server
  const handleRetryNow = useCallback(async (): Promise<void> => {
    if (!selectedServer) return
    setRetriggering(true)
    try {
      const result = await window.sqlSentinel.collectMetrics(toCollectRequest(selectedServer))
      if (result.ok) {
        await updateServer(selectedServer.id, {
          unreachable: false,
          unreachableSince: undefined,
          lastSeen: new Date().toISOString()
        })
        receiveMetrics(result.data)
      }
    } finally {
      setRetriggering(false)
    }
  }, [selectedServer, updateServer, receiveMetrics])

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ---- Sidebar ---- */}
      <Sidebar
        servers={servers}
        serversError={null}
        selectedServer={selectedServer}
        selectedAgName={selectedAgName}
        onSelectServer={handleSelectServer}
        onSelectAg={handleSelectAg}
        onRemoveServer={handleRemoveServer}
      />

      {/* ---- Area metriche ---- */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          p: 2,
          gap: 1.5,
          bgcolor: tokens.color.bgApp
        }}
      >
        {!selectedServer && !selectedAgName && (
          <Alert severity="info">Seleziona un server o un Availability Group dalla lista.</Alert>
        )}

        {/* AG Dashboard */}
        {selectedAgName && !selectedServer && connection === null && (
          (() => {
            // Use any available server connection for AG queries (prefer the first one)
            const anyConn = servers.length > 0 ? toCollectRequest(servers[0]) : null
            if (!anyConn) return (
              <Alert severity="warning">
                Nessun server disponibile per interrogare l&apos;AG. Aggiungere prima almeno un server.
              </Alert>
            )
            return (
              <Box sx={{ flex: 1, overflow: 'auto' }}>
                <AgDashboard agName={selectedAgName} connection={anyConn} />
              </Box>
            )
          })()
        )}

        {selectedServer && (
          <>
            {/* Toolbar */}
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              {/* Server title — alias + IP subtitle + inline edit */}
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                {editingAlias ? (
                  <Box
                    component="input"
                    ref={aliasInputRef}
                    value={aliasInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setAliasInput(e.target.value)
                    }
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter') confirmEditAlias()
                      if (e.key === 'Escape') cancelEditAlias()
                    }}
                    onBlur={confirmEditAlias}
                    placeholder={serverLabel(selectedServer)}
                    sx={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: `2px solid ${tokens.color.primary}`,
                      fontSize: tokens.font.sizeLg,
                      fontWeight: tokens.font.weightSemibold,
                      color: tokens.color.textPrimary,
                      outline: 'none',
                      minWidth: 200,
                      fontFamily: 'inherit',
                      p: 0
                    }}
                  />
                ) : (
                  <>
                    <Typography
                      sx={{
                        fontSize: tokens.font.sizeLg,
                        fontWeight: tokens.font.weightSemibold,
                        color: tokens.color.textPrimary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {getServerDisplayName({
                        ip: selectedServer.ip,
                        port: selectedServer.port,
                        alias: serverAliases[serverLabel(selectedServer)]
                      })}
                    </Typography>
                    {serverAliases[serverLabel(selectedServer)] && (
                      <Typography
                        component="span"
                        sx={{ fontSize: 12, color: '#605e5c', whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        {serverLabel(selectedServer)}
                      </Typography>
                    )}
                  </>
                )}
                <Tooltip title="Rinomina">
                  <IconButton
                    size="small"
                    onClick={startEditAlias}
                    sx={{ color: tokens.color.textSecondary, flexShrink: 0 }}
                  >
                    <EditIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>

              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Auto-refresh</InputLabel>
                <Select
                  label="Auto-refresh"
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(e.target.value as number)}
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
                startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : undefined}
              >
                {isLoading ? 'Raccolta...' : 'Aggiorna metriche'}
              </Button>
            </Stack>

            {/* Unreachable banner */}
            {selectedServer.unreachable && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  py: 1,
                  bgcolor: '#3d1a1a',
                  border: `1px solid ${tokens.color.error}`,
                  borderRadius: 1
                }}
              >
                <WarningAmberIcon sx={{ color: tokens.color.error, fontSize: 18, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 13, color: tokens.color.error, flex: 1 }}>
                  Server non raggiungibile
                  {selectedServer.unreachableSince
                    ? ` — ultimo contatto: ${new Date(selectedServer.unreachableSince).toLocaleString('it-IT')}`
                    : ''}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={
                    retriggering ? (
                      <CircularProgress size={12} color="inherit" />
                    ) : (
                      <RefreshIcon sx={{ fontSize: 14 }} />
                    )
                  }
                  onClick={handleRetryNow}
                  disabled={retriggering}
                  sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  Riprova ora
                </Button>
              </Box>
            )}

            {error && <Alert severity="error">{error}</Alert>}

            {metrics ? (
              <Box sx={{ flex: 1, overflow: 'hidden' }}>
                <MetricsPanel
                  metrics={metrics}
                  history={history}
                  serverId={selectedServerId ?? ''}
                  connection={connection!}
                />
              </Box>
            ) : (
              !isLoading &&
              !error && (
                <Alert severity="info">
                  Premi &quot;Aggiorna metriche&quot; per raccogliere i dati dal server.
                </Alert>
              )
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
