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
  Skeleton,
  Tooltip
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import EditIcon from '@mui/icons-material/Edit'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { StoredServer, CollectMetricsRequest } from '../../../preload/index'
import { useMetrics } from '../hooks/useMetrics'
import { useWorker } from '../context/useWorker'
import { AgDashboard } from '../components/features/ag/AgDashboard'
import { ServerDashboard } from '../components/features/server/ServerDashboard'
import { useGroupsStore } from '../store/groupsStore'
import { useServersStore } from '../store/serversStore'
import { useAgStore } from '../store/agStore'
import { useAppStore } from '../store/appStore'
import { useMetricsStore } from '../store/metricsStore'
import { useShallow } from 'zustand/react/shallow'
import { getServerDisplayName } from '../types/index'
import { tokens } from '../styles/tokens'
import { selectDisplayMetrics } from '../utils/selectDisplayMetrics'

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
  const { servers, initialized, updateServer, removeServer } = useServersStore(
    useShallow((s) => ({
      servers: s.servers,
      initialized: s.initialized,
      updateServer: s.updateServer,
      removeServer: s.removeServer
    }))
  )
  const detectAgsForServer = useAgStore((s) => s.detectAgsForServer)
  const selectedServerId = useAppStore((s) => s.selectedServerId)
  const selectedServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId) ?? null,
    [servers, selectedServerId]
  )
  // Shared via appStore so the sidebar AG header and the HomeDashboard AG header
  // both drive this view (was previously dead local state).
  const selectedAgName = useAppStore((s) => s.selectedAgName)
  const [retriggering, setRetriggering] = useState(false)

  const { intervalSeconds, setIntervalSeconds, setConnection, pushSnapshot } = useWorker()
  const serverAliases = useGroupsStore((s) => s.serverAliases)
  const setServerAlias = useGroupsStore((s) => s.setServerAlias)

  // Inline alias editing
  const [editingAlias, setEditingAlias] = useState(false)
  const [aliasInput, setAliasInput] = useState('')
  const aliasInputRef = useRef<HTMLInputElement | null>(null)

  const connection = useMemo(
    () => (selectedServer ? toCollectRequest(selectedServer) : null),
    [selectedServer]
  )
  const serverMetricsKey = selectedServer ? serverLabel(selectedServer) : null

  const cachedMetrics = useMetricsStore((s) =>
    serverMetricsKey ? (s.metricsMap[serverMetricsKey] ?? null) : null
  )

  const { metrics, isLoading, error, refresh, receiveMetrics } = useMetrics(connection, {
    onReceived: pushSnapshot
  })

  const handleRemoveServer = useCallback(async () => {
    if (!selectedServer) return
    await removeServer(selectedServer.id)
    // selectedServer disappears from servers[] → selectedServerId no longer matches → Dashboard shows empty state
  }, [removeServer, selectedServer])

  useEffect(() => {
    setConnection(connection)
    // Only re-notify worker when actual connection params change, not on metadata patches
  }, [
    connection?.ip,
    connection?.port,
    connection?.instanceName,
    connection?.useWindowsAuth,
    connection?.username,
    connection?.password
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!serverMetricsKey) return
    refresh()
  }, [serverMetricsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect AG membership for each server after store loads.
  // Pass the full server list and updateServer so agStore can write AG metadata
  // back to each matched replica without importing serversStore itself.
  useEffect(() => {
    if (!initialized) return
    for (const s of servers) {
      detectAgsForServer(s.id, toCollectRequest(s), servers, updateServer)
    }
  }, [initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  const stableReceiveMetrics = useCallback(receiveMetrics, [receiveMetrics])

  // Ref always updated to the current server: we avoid re-subscribing to the IPC channel
  // on every serverMetricsKey change (which could have dropped/duplicated
  // in-flight batches). The callback reads the current id from the ref.
  const selectedServerIdRef = useRef(serverMetricsKey)
  useEffect(() => {
    selectedServerIdRef.current = serverMetricsKey
  }, [serverMetricsKey])

  // Global metricsMap + history are updated by the AppInner-level subscription.
  // Here we only update local component state for the currently selected server.
  useEffect(() => {
    const unsubBatch = window.sqlSentinel.onMetricsBatchUpdated((batch) => {
      const currentId = selectedServerIdRef.current
      const active = batch.find(({ serverId }) => serverId === currentId)
      if (active) stableReceiveMetrics(active.metrics)
    })
    return unsubBatch
  }, [stableReceiveMetrics])

  // Inline alias edit helpers
  const startEditAlias = useCallback((): void => {
    if (!selectedServer) return
    setAliasInput(serverAliases[selectedServer.id] ?? '')
    setEditingAlias(true)
    setTimeout(() => aliasInputRef.current?.select(), 0)
  }, [selectedServer, serverAliases])

  const confirmEditAlias = useCallback((): void => {
    if (!selectedServer) return
    setServerAlias(selectedServer.id, aliasInput)
    setEditingAlias(false)
  }, [selectedServer, aliasInput, setServerAlias])

  const cancelEditAlias = useCallback((): void => {
    setEditingAlias(false)
  }, [])

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
    <Box
      sx={{
        height: '100%',
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
      {selectedAgName &&
        !selectedServer &&
        connection === null &&
        (() => {
          // Le query AG devono partire da un MEMBRO del cluster selezionato:
          // usare servers[0] (un server qualsiasi del registry, magari di un
          // altro AG o irraggiungibile) lasciava la dashboard su "Loading AG
          // data..." per sempre. Si preferisce un membro raggiungibile.
          const agMembers = servers.filter((s) => s.agName === selectedAgName)
          const pick =
            agMembers.find((s) => !s.unreachable) ?? agMembers[0] ?? servers[0]
          const anyConn = pick ? toCollectRequest(pick) : null
          if (!anyConn)
            return (
              <Alert severity="warning">
                No server available to query the AG. Add at least one server first.
              </Alert>
            )
          return (
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              <AgDashboard agName={selectedAgName} connection={anyConn} />
            </Box>
          )
        })()}

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
                      alias: serverAliases[selectedServer.id]
                    })}
                  </Typography>
                  {serverAliases[selectedServer.id] && (
                    <Typography
                      component="span"
                      sx={{
                        fontSize: 12,
                        color: 'text.secondary',
                        whiteSpace: 'nowrap',
                        flexShrink: 0
                      }}
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
                  aria-label="Rename server alias"
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
                bgcolor: (theme) =>
                  alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.2 : 0.08),
                border: `1px solid ${tokens.color.danger}`,
                borderRadius: 1
              }}
            >
              <WarningAmberIcon sx={{ color: tokens.color.danger, fontSize: 18, flexShrink: 0 }} />
              <Typography sx={{ fontSize: 13, color: tokens.color.danger, flex: 1 }}>
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
            const displayMetrics = selectDisplayMetrics(metrics, cachedMetrics)
            const isFirstLoad = isLoading && !displayMetrics

            if (isFirstLoad) {
              // Skeleton mirroring the actual server dashboard layout (KPI row +
              // tabs + table) so the page feels populated while metrics load.
              return (
                <Box sx={{ flex: 1, p: 2 }}>
                  <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} variant="rounded" height={86} sx={{ flex: 1 }} />
                    ))}
                  </Stack>
                  <Skeleton variant="rounded" height={40} sx={{ mb: 1 }} />
                  <Skeleton variant="rounded" height={280} />
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
              <Box
                key={serverMetricsKey ?? ''}
                sx={{ flex: 1, overflow: 'auto', position: 'relative' }}
              >
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
                  onRemove={handleRemoveServer}
                />
              </Box>
            ) : null
          })()}
        </>
      )}
    </Box>
  )
}
