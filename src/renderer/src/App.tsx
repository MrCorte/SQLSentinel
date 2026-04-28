import { useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { Box } from '@mui/material'
import { AIPanel } from './components/ai/AIPanel'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { Discovery } from './pages/Discovery'
import { Inventory } from './pages/Inventory'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { LoginPage } from './pages/Login'
import { StorageSetupPage } from './pages/StorageSetupPage'
import { AlertsDrawer } from './components/AlertsDrawer'
import { HomeDashboard } from './components/HomeDashboard'
import { WorkerProvider } from './context/WorkerContext'
import { useWorker } from './context/useWorker'
import { useServersStore } from './store/serversStore'
import { useAlertsStore } from './store/alertsStore'
import { useAppStore } from './store/appStore'
import { useMetricsStore } from './store/metricsStore'
import { useMockData } from './hooks/useMockData'
import { useIpcEvent } from './hooks/useIpcEvent'
import { buildTheme } from './styles/theme'
import { darkValues, lightValues } from './styles/tokens'
import { ThemeContext } from './context/ThemeContext'
import type { ThemeMode } from './context/ThemeContext'
import { AuthContext } from './context/AuthContext'
import { AccentProvider } from './components/layout/AccentProvider'
import { IconRail } from './components/layout/IconRail'
import { BreadcrumbBar } from './components/layout/BreadcrumbBar'
import { ServerTree } from './components/layout/ServerTree'
import type {
  AuthSession,
  ServerHealthPayload,
  StoredServer,
  ServerUnreachableEvent,
  Alert
} from '../../preload/index'
import { createLogger } from './utils/logger'
import { migrateAliasKeys, migrateServerGroupKeys } from './store/groupsStore'
import { useGroupsStore } from './store/groupsStore'
import { getServerDisplayName } from './types/index'

const log = createLogger('app')
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// Tree is visible on Inventory (2) and Dashboard (3) only
const TREE_VISIBLE_TABS = new Set([2, 3])

// ---------------------------------------------------------------------------
// Inner — accesses WorkerContext (must be inside WorkerProvider)
// ---------------------------------------------------------------------------

function AppInner(): React.JSX.Element {
  const [tab, setTab] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  useMockData()

  const { setRetentionMinutes, seedHistory } = useWorker()
  const {
    alerts,
    setAlerts,
    addAlert,
    acknowledgeAlert: acknowledgeAlertInStore
  } = useAlertsStore()
  const { selectedServerId, setSelectedServerId } = useAppStore()
  const servers = useServersStore((s) => s.servers)
  const serverAliases = useGroupsStore((s) => s.serverAliases)

  // Derive selected server object from id
  const selectedServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId) ?? null,
    [servers, selectedServerId]
  )

  const selectedServerName = useMemo(() => {
    if (!selectedServer) return null
    return getServerDisplayName({
      ip: selectedServer.host ?? selectedServer.ip ?? '',
      port: selectedServer.port,
      alias: serverAliases[selectedServer.id]
    })
  }, [selectedServer, serverAliases])
  const [selectedAgName, setSelectedAgName] = useState<string | null>(null)

  // Load persisted servers on mount — runs in both real and mock mode so that
  // servers added manually while VITE_USE_MOCK=true are preserved across restarts
  useEffect(() => {
    log.info('init — chiamata loadServers')
    const { loadServers } = useServersStore.getState()

    if (!window.sqlSentinel?.servers?.getAll) {
      log.error('sqlSentinel.servers not available!')
      useServersStore.setState({ initialized: true })
      return
    }

    loadServers()
      .then(() => {
        const { servers: srvs } = useServersStore.getState()
        log.info('loadServers completato, servers:', srvs.length)
        migrateAliasKeys(srvs)
        migrateServerGroupKeys(srvs)
        if (srvs.length > 0) {
          window.sqlSentinel
            .workerStart({
              intervalSeconds: 60,
              servers: srvs.map((s) => ({
                ip: s.ip ?? s.host,
                port: s.port,
                instanceName: s.instanceName,
                useWindowsAuth: s.useWindowsAuth ?? false,
                username: s.username,
                password: s.password
              }))
            })
            .then(() => {
              if (typeof window.sqlSentinel?.getHistoryBulk === 'function') {
                window.sqlSentinel
                  .getHistoryBulk()
                  .then((result) => {
                    if (result.ok && Object.keys(result.data).length > 0) {
                      seedHistory(result.data)
                    }
                  })
                  .catch(() => {}) // non-blocking
              }
            })
            .catch((err) => log.error('workerStart failed:', err))
        }
      })
      .catch((err) => log.error('loadServers failed:', err))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync server list with the background worker whenever servers are added/removed
  // Skip in mock mode — mock IPs (10.0.x.x) are not reachable
  useEffect(() => {
    if (USE_MOCK) return
    return useServersStore.subscribe((state) => {
      if (!state.initialized) return
      window.sqlSentinel.workerSyncServers({
        servers: state.servers.map((s) => ({
          ip: s.ip ?? s.host,
          port: s.port,
          instanceName: s.instanceName,
          useWindowsAuth: s.useWindowsAuth ?? false,
          username: s.username,
          password: s.password
        }))
      })
    })
  }, [])

  // Circuit-breaker health updates from the main process
  const handleServerHealthUpdate = useCallback((...args: unknown[]) => {
    const health = args[0] as ServerHealthPayload
    useMetricsStore.getState().setServerHealth(health)
  }, [])

  useIpcEvent(window.sqlSentinel.onServerHealthUpdate, handleServerHealthUpdate)

  // AG detection push: worker found replica roles — update serversStore in-place
  const handleServerConfigUpdated = useCallback((...args: unknown[]) => {
    const updatedServers = args[0] as StoredServer[]
    const { updateServer } = useServersStore.getState()
    for (const srv of updatedServers) {
      updateServer(srv.id, {
        agGroupId: srv.agGroupId,
        agName: srv.agName,
        agRole: srv.agRole,
        logicalCpus: srv.logicalCpus,
        physicalCpus: srv.physicalCpus
      })
    }
  }, [])

  useEffect(() => {
    if (typeof window.sqlSentinel?.onServerConfigUpdated !== 'function') return
    return window.sqlSentinel.onServerConfigUpdated(handleServerConfigUpdated)
  }, [handleServerConfigUpdated])

  // Listen for health-check push events
  const handleServerUnreachable = useCallback((...args: unknown[]) => {
    const data = args[0] as ServerUnreachableEvent
    useServersStore.getState().updateServer(data.serverId, {
      unreachable: true,
      unreachableSince: data.since
    })
  }, [])

  const handleServerRecovered = useCallback((...args: unknown[]) => {
    const serverId = args[0] as string
    useServersStore.getState().updateServer(serverId, {
      unreachable: false,
      unreachableSince: undefined,
      lastSeen: new Date().toISOString()
    })
  }, [])

  useEffect(() => {
    if (typeof window.sqlSentinel?.onServerUnreachable !== 'function') {
      log.warn('sqlSentinel.onServerUnreachable not available — skip')
      return
    }
    const unsubUnreachable = window.sqlSentinel.onServerUnreachable(handleServerUnreachable)
    const unsubRecovered = window.sqlSentinel.onServerRecovered(handleServerRecovered)
    return () => {
      unsubUnreachable()
      unsubRecovered()
    }
  }, [handleServerUnreachable, handleServerRecovered])

  useEffect(() => {
    window.sqlSentinel
      .getSettings()
      .then((result) => {
        if (result.ok) setRetentionMinutes(result.data.retentionMinutes)
      })
      .catch((err) => log.error('getSettings failed:', err))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.sqlSentinel
      .getAlerts()
      .then((result) => {
        if (result.ok) setAlerts(result.data)
      })
      .catch((err) => log.error('getAlerts failed:', err))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAlertNew = useCallback(
    (...args: unknown[]) => {
      const alert = args[0] as Alert
      addAlert(alert)
    },
    [addAlert]
  )

  useIpcEvent(window.sqlSentinel.onAlertNew, handleAlertNew)

  function handleAcknowledge(alertId: string): void {
    window.sqlSentinel
      .acknowledgeAlert({ alertId })
      .then((result) => {
        if (result.ok) {
          acknowledgeAlertInStore(alertId)
        }
      })
      .catch((err) => log.error('acknowledgeAlert failed:', err))
  }

  function handleSelectServer(server: StoredServer): void {
    setSelectedServerId(server.id)
    setSelectedAgName(null)
    setTab(3)
  }

  const showTree = TREE_VISIBLE_TABS.has(tab)

  return (
    <AccentProvider>
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* Icon Rail */}
        <IconRail activeTab={tab} onTabChange={setTab} onSettingsClick={() => setTab(4)} />

        {/* Right of rail: breadcrumb + (tree + content) */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0
          }}
        >
          <BreadcrumbBar
            activeTab={tab}
            selectedServerName={selectedServerName}
            onOpenAlerts={() => setDrawerOpen(true)}
            onOpenAI={() => setAiOpen(true)}
          />

          <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Server tree — visible on Inventory + Dashboard tabs */}
            {showTree && (
              <ServerTree
                selectedServer={selectedServer}
                selectedAgName={selectedAgName}
                onSelectServer={handleSelectServer}
                onSelectAg={(agName) => {
                  setSelectedAgName(agName)
                  setTab(3)
                }}
                onRemoveServer={(server) => {
                  window.sqlSentinel.servers.remove(server.id).catch(() => {})
                  useServersStore.getState().removeServer(server.id)
                  if (selectedServerId === server.id) setSelectedServerId(null)
                }}
              />
            )}

            {/* Main content */}
            <Box sx={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
              {tab === 0 && (
                <Box sx={{ height: '100%', overflow: 'auto' }}>
                  <HomeDashboard
                    onNavigateToServer={(id) => {
                      setSelectedServerId(id)
                      setTab(3)
                    }}
                    onNavigateToDiscovery={() => setTab(1)}
                  />
                </Box>
              )}
              {tab === 1 && (
                <Box sx={{ height: '100%', overflow: 'auto' }}>
                  <Discovery />
                </Box>
              )}
              {tab === 2 && (
                <Box sx={{ height: '100%', overflow: 'hidden' }}>
                  <Inventory onNavigateToDashboard={() => setTab(3)} />
                </Box>
              )}
              {tab === 3 && (
                <Box sx={{ height: '100%', overflow: 'hidden' }}>
                  <Dashboard />
                </Box>
              )}
              {tab === 4 && (
                <Box sx={{ height: '100%', overflow: 'auto' }}>
                  <Settings />
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      <AlertsDrawer
        open={drawerOpen}
        alerts={alerts}
        onClose={() => setDrawerOpen(false)}
        onAcknowledge={handleAcknowledge}
      />
    </AccentProvider>
  )
}

// ---------------------------------------------------------------------------
// Root — WorkerProvider avvolge tutto
// ---------------------------------------------------------------------------

function App(): React.JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [storageState, setStorageState] = useState<'loading' | 'setup' | 'ready'>('loading')
  const [storageError, setStorageError] = useState<string | undefined>()

  // ── Theme mode ────────────────────────────────────────────────────────────
  const [themeMode, setThemeModeState] = useState<ThemeMode>(
    () => (localStorage.getItem('themeMode') as ThemeMode) ?? 'system'
  )
  const [sysDark, setSysDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => setSysDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const effectiveMode: 'light' | 'dark' =
    themeMode === 'system' ? (sysDark ? 'dark' : 'light') : themeMode

  // Inject CSS custom properties before paint so all components using
  // tokens.color.bg*/text* CSS vars pick up the right values immediately
  useLayoutEffect(() => {
    const vals = effectiveMode === 'dark' ? darkValues : lightValues
    const root = document.documentElement
    root.style.setProperty('--t-bg-base', vals.bgBase)
    root.style.setProperty('--t-bg-surface', vals.bgSurface)
    root.style.setProperty('--t-bg-border', vals.bgBorder)
    root.style.setProperty('--t-text-primary', vals.textPrimary)
    root.style.setProperty('--t-text-muted', vals.textMuted)
  }, [effectiveMode])

  const muiTheme = useMemo(() => {
    const vals = effectiveMode === 'dark' ? darkValues : lightValues
    return buildTheme(effectiveMode, vals)
  }, [effectiveMode])

  const setThemeMode = useCallback(async (mode: ThemeMode): Promise<void> => {
    localStorage.setItem('themeMode', mode)
    setThemeModeState(mode)
  }, [])

  // Check if a session already exists (e.g. app restarted within the same process)
  useEffect(() => {
    window.sqlSentinel
      .checkAuth()
      .then(({ authenticated, session: s }) => {
        if (authenticated && s) setSession(s)
      })
      .catch((err) => log.error('checkAuth failed:', err))
      .finally(() => setAuthChecking(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Global UNAUTHORIZED handler — session expired or revoked
  useEffect(() => {
    function onUnhandledRejection(e: PromiseRejectionEvent): void {
      if (
        e.reason instanceof Error &&
        (e.reason.message === 'UNAUTHORIZED' || e.reason.message.includes('UNAUTHORIZED'))
      ) {
        e.preventDefault()
        setSession(null)
      }
    }
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }, [])

  useEffect(() => {
    // Fallback query: se l'evento è già arrivato prima che l'effect si registrasse,
    // interroga lo stato corrente per uscire subito da 'loading'
    window.sqlSentinel.storage
      .getConfig()
      .then((r) => {
        setStorageState((prev) => {
          if (prev !== 'loading') return prev // evento già gestito dai listener
          return r.ok && r.data !== null ? 'ready' : 'setup'
        })
      })
      .catch(() => {
        setStorageState((prev) => (prev === 'loading' ? 'setup' : prev))
      })

    const unsubNotConfigured = window.sqlSentinel.storage.onNotConfigured((err) => {
      setStorageError(err)
      setStorageState('setup')
    })
    const unsubConfigured = window.sqlSentinel.storage.onConfigured(() => {
      setStorageState('ready')
    })

    // Timeout di sicurezza: se dopo 10s non arriva nessun segnale, mostra il setup
    const timer = setTimeout(() => {
      setStorageState((prev) => (prev === 'loading' ? 'setup' : prev))
    }, 10_000)

    return () => {
      clearTimeout(timer)
      unsubNotConfigured()
      unsubConfigured()
    }
  }, [])

  const handleStorageConfigured = useCallback(() => setStorageState('ready'), [])

  const handleLogout = useCallback(async (): Promise<void> => {
    await window.sqlSentinel.logout()
    setSession(null)
  }, [])

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode }}>
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        {storageState === 'loading' ? null : storageState === 'setup' ? (
          <StorageSetupPage initialError={storageError} onConfigured={handleStorageConfigured} />
        ) : authChecking ? null : !session ? (
          <LoginPage onLogin={setSession} />
        ) : (
          <AuthContext.Provider value={{ session, logout: handleLogout }}>
            <WorkerProvider>
              <AppInner />
            </WorkerProvider>
          </AuthContext.Provider>
        )}
      </ThemeProvider>
    </ThemeContext.Provider>
  )
}

export default App
