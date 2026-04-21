import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
  LinearProgress,
  Tooltip
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import EditIcon from '@mui/icons-material/Edit'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { StoredServer, CollectMetricsRequest } from '../../../preload/index'
import { useMetrics } from '../hooks/useMetrics'
import { useWorker } from '../context/useWorker'
import { AgDashboard } from '../components/AgDashboard'
import { ServerDashboard } from '../components/ServerDashboard'
import { Sidebar } from '../components/Sidebar'
import { useGroupsStore } from '../store/groupsStore'
import { useServersStore } from '../store/serversStore'
import { useAgStore } from '../store/agStore'
import { useAppStore } from '../store/appStore'
import { useMetricsStore } from '../store/metricsStore'
import { useShallow } from 'zustand/shallow'
import { getServerDisplayName } from '../types/index'
import { tokens } from '../styles/tokens'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function serverLabel(s: StoredServer): string {
  return `${s.ip ?? s.host}:${s.port}`
}

function toCollectRequest(server: StoredServer): CollectMetricsRequest {
  return {
    ip: server.ip ?? server.host,
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
  const { servers, initialized, removeServer, updateServer } = useServersStore(
    useShallow((s) => ({
      servers: s.servers,
      initialized: s.initialized,
      removeServer: s.removeServer,
      updateServer: s.updateServer
    }))
  )
  const { detectAgsForServer } = useAgStore()
  const [selectedServer, setSelectedServer] = useState<StoredServer | null>(null)
  const [selectedAgName, setSelectedAgName] = useState<string | null>(null)

  // Handle navigation from Inventory: select a specific server when pending
  const pendingServerId = useAppStore((s) => s.pendingServerId)
  const setPendingServerId = useAppStore((s) => s.setPendingServerId)
  useEffect(() => {
    if (!pendingServerId) return
    const srv = servers.find((s) => s.id === pendingServerId)
    if (srv) {
      setSelectedServer(srv)
      setSelectedAgName(null)
      setPendingServerId(null)
    }
  }, [pendingServerId, servers, setPendingServerId])
  const [retriggering, setRetriggering] = useState(false)

  const { intervalSeconds, setIntervalSeconds, setConnection, pushSnapshot, pushSnapshotBatch } =
    useWorker()
  const { serverAliases, setServerAlias } = useGroupsStore()

  // Inline alias editing
  const [editingAlias, setEditingAlias] = useState(false)
  const [aliasInput, setAliasInput] = useState('')
  const aliasInputRef = useRef<HTMLInputElement | null>(null)

  const connection = useMemo(
    () => (selectedServer ? toCollectRequest(selectedServer) : null),
    [selectedServer]
  )
  const selectedServerId = selectedServer ? serverLabel(selectedServer) : null

  const cachedMetrics = useMetricsStore(
    (s) => (selectedServerId ? s.metricsMap[selectedServerId] ?? null : null)
  )

  const { metrics, isLoading, error, refresh, receiveMetrics } = useMetrics(connection, {
    onReceived: pushSnapshot
  })

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
  }, [connection])

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

  const stablePushSnapshotBatch = useCallback(pushSnapshotBatch, [pushSnapshotBatch])
  const stableReceiveMetrics = useCallback(receiveMetrics, [receiveMetrics])

  // Ref always updated to the current server: we avoid re-subscribing to the IPC channel
  // on every selectedServerId change (which could have dropped/duplicated
  // in-flight batches). The callback reads the current id from the ref.
  const selectedServerIdRef = useRef(selectedServerId)
  useEffect(() => {
    selectedServerIdRef.current = selectedServerId
  }, [selectedServerId])

  useEffect(() => {
    const unsubBatch = window.sqlSentinel.onMetricsBatchUpdated((batch) => {
      stablePushSnapshotBatch(batch)
      const currentId = selectedServerIdRef.current
      const active = batch.find(({ serverId }) => serverId === currentId)
      if (active) stableReceiveMetrics(active.metrics)
    })
    return unsubBatch
  }, [stablePushSnapshotBatch, stableReceiveMetrics])

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

      {/* ---- Metrics area ---- */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          p: 2,
          gap: 1.5,
          bgcolor: 'background.default'
        }}
      >
        {!selectedServer && !selectedAgName && (
          <Alert severity="info">Select a server or an Availability Group from the list.</Alert>
        )}

        {/* AG Dashboard */}
        {selectedAgName && !selectedServer && connection === null && (
          (() => {
            // Use any available server connection for AG queries (prefer the first one)
            const anyConn = servers.length > 0 ? toCollectRequest(servers[0]) : null
            if (!anyConn) return (
              <Alert severity="warning">
                No server available to query the AG. Add at least one server first.
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
                      color: 'text.primary',
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
                        color: 'text.primary',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {getServerDisplayName({
                        ip: selectedServer.ip ?? selectedServer.host,
                        port: selectedServer.port,
                        alias: serverAliases[serverLabel(selectedServer)]
                      })}
                    </Typography>
                    {serverAliases[serverLabel(selectedServer)] && (
                      <Typography
                        component="span"
                        sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        {serverLabel(selectedServer)}
                      </Typography>
                    )}
                  </>
                )}
                <Tooltip title="Rename">
                  <IconButton
                    size="small"
                    onClick={startEditAlias}
                    sx={{ color: 'text.secondary', flexShrink: 0 }}
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
                  <MenuItem value={0}>Disabled</MenuItem>
                  <MenuItem value={30}>Every 30 s</MenuItem>
                  <MenuItem value={60}>Every 60 s</MenuItem>
                  <MenuItem value={120}>Every 2 min</MenuItem>
                  <MenuItem value={300}>Every 5 min</MenuItem>
                </Select>
              </FormControl>

              <Button
                variant="contained"
                onClick={refresh}
                disabled={isLoading}
                startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : undefined}
              >
                {isLoading ? 'Collecting...' : 'Refresh metrics'}
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
                  bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.2 : 0.08),
                  border: `1px solid ${tokens.color.error}`,
                  borderRadius: 1
                }}
              >
                <WarningAmberIcon sx={{ color: tokens.color.error, fontSize: 18, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 13, color: tokens.color.error, flex: 1 }}>
                  Server unreachable
                  {selectedServer.unreachableSince
                    ? ` — last contact: ${new Date(selectedServer.unreachableSince).toLocaleString('en-US')}`
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
                  Retry now
                </Button>
              </Box>
            )}

            {error && <Alert severity="error">{error}</Alert>}

            {(() => {
              // Stale-while-revalidate: use fresh metrics if available,
              // otherwise show the store cache (seedFromHistory / worker push)
              const displayMetrics = metrics ?? cachedMetrics
              const isFirstLoad = isLoading && !displayMetrics

              if (isFirstLoad) {
                return (
                  <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress size={32} />
                  </Box>
                )
              }

              if (!displayMetrics && !isLoading && !error) {
                return (
                  <Alert severity="info">
                    Press &quot;Refresh metrics&quot; to collect data from the server.
                  </Alert>
                )
              }

              return displayMetrics ? (
                <Box sx={{ flex: 1, overflow: 'auto', position: 'relative' }}>
                  {/* Silent refresh bar — does not block the UI */}
                  {isLoading && (
                    <LinearProgress
                      sx={{ position: 'sticky', top: 0, left: 0, right: 0, zIndex: 10 }}
                    />
                  )}
                  <ServerDashboard
                    server={selectedServer}
                    metrics={displayMetrics}
                    connection={connection!}
                  />
                </Box>
              ) : null
            })()}
          </>
        )}
      </Box>
    </Box>
  )
}
