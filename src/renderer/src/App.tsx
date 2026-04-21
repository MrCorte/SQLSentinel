import { useState, useEffect, useMemo, useCallback } from 'react'
import { Box, Tabs, Tab, IconButton, Badge, Tooltip, Typography } from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import SettingsIcon from '@mui/icons-material/Settings'
import LogoutIcon from '@mui/icons-material/Logout'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { AIPanel } from './components/ai/AIPanel'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { Discovery } from './pages/Discovery'
import { Inventory } from './pages/Inventory'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { LoginPage } from './pages/Login'
import { AlertsDrawer } from './components/AlertsDrawer'
import { HomeDashboard } from './components/HomeDashboard'
import { WorkerProvider } from './context/WorkerContext'
import { useWorker } from './context/useWorker'
import { useServersStore } from './store/serversStore'
import { useAlertsStore } from './store/alertsStore'
import { useAppStore } from './store/appStore'
import { useMetricsStore } from './store/metricsStore'
import { tokens } from './styles/tokens'
import { useMockData } from './hooks/useMockData'
import { useIpcEvent } from './hooks/useIpcEvent'
import { buildTheme } from './styles/theme'
import { ThemeContext, type ThemeMode } from './context/ThemeContext'
import { AuthContext } from './context/AuthContext'
import type { AuthSession, ServerHealthPayload, StoredServer, ServerUnreachableEvent, Alert } from '../../preload/index'
import { createLogger } from './utils/logger'

const log = createLogger('app')
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// ---------------------------------------------------------------------------
// Inner — accede a WorkerContext (deve essere dentro WorkerProvider)
// ---------------------------------------------------------------------------

function AppInner({ onLogout }: { onLogout: () => void }): React.JSX.Element {
  const [tab, setTab] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  useMockData()

  const { setRetentionMinutes, seedHistory } = useWorker()
  const { alerts, setAlerts, addAlert, acknowledgeAlert: acknowledgeAlertInStore } = useAlertsStore()

  // Load persisted servers on mount — runs in both real and mock mode so that
  // servers added manually while VITE_USE_MOCK=true are preserved across restarts
  useEffect(() => {
    log.info('init — chiamata loadServers')
    const { loadServers } = useServersStore.getState()

    if (!window.sqlSentinel?.servers?.getAll) {
      log.error('sqlSentinel.servers non disponibile!')
      useServersStore.setState({ initialized: true })
      return
    }

    loadServers()
      .then(() => {
        const { servers } = useServersStore.getState()
        log.info('loadServers completato, servers:', servers.length)
        if (servers.length > 0) {
          window.sqlSentinel
            .workerStart({
              intervalSeconds: 60,
              servers: servers.map((s) => ({
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
                  .catch(() => {}) // non bloccante
              }
            })
            .catch((err) => log.error('workerStart failed:', err))
        }
      })
      .catch((err) => log.error('loadServers failed:', err))
  }, [])

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
      log.warn('sqlSentinel.onServerUnreachable non disponibile — skip')
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

  const handleAlertNew = useCallback((...args: unknown[]) => {
    const alert = args[0] as Alert
    addAlert(alert)
  }, [addAlert])

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

  const criticalCount = alerts.filter(
    (a) => a.severity === 'CRITICAL' && a.acknowledgedAt === null
  ).length

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* ---- Navbar 48px ---- */}
      <Box
        component="header"
        sx={{
          height: tokens.size.navbarHeight,
          minHeight: tokens.size.navbarHeight,
          bgcolor: 'background.paper',
          borderBottom: `2px solid`,
          borderColor: 'primary.main',
          boxShadow: tokens.shadow.navbar,
          display: 'flex',
          alignItems: 'center',
          zIndex: 100,
          flexShrink: 0,
          px: 2,
          gap: 1,
          backgroundImage: (theme) =>
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #162032 100%)'
              : 'linear-gradient(135deg, #ffffff 0%, #f0f6ff 100%)',
        }}
      >
        {/* Logo / product name */}
        <Typography
          onClick={() => setTab(0)}
          sx={{
            fontSize: tokens.font.sizeMd,
            fontWeight: tokens.font.weightBold,
            background: `linear-gradient(135deg, ${tokens.color.primary} 0%, ${tokens.color.primaryDark} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.02em',
            mr: 2,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          SQL Sentinel
        </Typography>

        {/* Pivot tabs — centrate, crescono */}
        <Tabs
          value={tab === 0 || tab === 4 ? false : tab}
          onChange={(_e, v) => setTab(v as number)}
          sx={{
            flex: 1,
            minHeight: tokens.size.navbarHeight,
            '& .MuiTabs-indicator': {
              backgroundColor: tokens.color.primary,
              height: 3,
              borderRadius: '3px 3px 0 0',
            }
          }}
        >
          <Tab
            value={1}
            label="Discovery"
            sx={{
              color: 'text.secondary',
              '&.Mui-selected': { color: 'primary.main' }
            }}
          />
          <Tab
            value={2}
            label="Inventario"
            sx={{
              color: 'text.secondary',
              '&.Mui-selected': { color: 'primary.main' }
            }}
          />
          <Tab
            value={3}
            label="Dashboard"
            sx={{
              color: 'text.secondary',
              '&.Mui-selected': { color: 'primary.main' }
            }}
          />
        </Tabs>

        {/* Icon buttons — destra */}
        <Tooltip
          title={criticalCount > 0 ? `${criticalCount} alert critici` : 'Alert'}
          disableHoverListener={false}
        >
          <IconButton
            size="small"
            onClick={() => setDrawerOpen(true)}
            sx={{
              color: criticalCount > 0 ? 'error.main' : 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' }
            }}
          >
            <Badge badgeContent={criticalCount || undefined} color="error" max={99}>
              <NotificationsIcon fontSize="small" />
            </Badge>
          </IconButton>
        </Tooltip>

        <Tooltip title="Assistente AI">
          <IconButton
            size="small"
            onClick={() => setAiOpen(true)}
            sx={{
              color: aiOpen ? 'primary.main' : 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' }
            }}
          >
            <SmartToyIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Impostazioni">
          <IconButton
            size="small"
            onClick={() => setTab(4)}
            sx={{
              color: tab === 4 ? 'primary.main' : 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' }
            }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Disconnetti">
          <IconButton
            size="small"
            onClick={onLogout}
            sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* ---- Page content ---- */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        {tab === 0 && (
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <HomeDashboard
              onNavigateToServer={(id) => {
                useAppStore.getState().setPendingServerId(id)
                setTab(3)
              }}
              onNavigateToDiscovery={() => setTab(1)}
              onOpenAlerts={() => setDrawerOpen(true)}
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

      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} />

      <AlertsDrawer
        open={drawerOpen}
        alerts={alerts}
        onClose={() => setDrawerOpen(false)}
        onAcknowledge={handleAcknowledge}
      />
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Root — WorkerProvider avvolge tutto
// ---------------------------------------------------------------------------

function App(): React.JSX.Element {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authChecking, setAuthChecking] = useState(true)

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

  const handleLogout = useCallback(async (): Promise<void> => {
    await window.sqlSentinel.logout()
    setSession(null)
  }, [])

  // Load persisted theme preference on mount (exempt from auth — needed for login page)
  useEffect(() => {
    window.sqlSentinel
      .getSettings()
      .then((result) => {
        if (result.ok && result.data.themeMode) {
          setThemeModeState(result.data.themeMode as ThemeMode)
        }
      })
      .catch((err) => log.error('getSettings (theme) failed:', err))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Track OS dark-mode preference for 'system' mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const effectiveMode = useMemo((): 'light' | 'dark' => {
    if (themeMode === 'dark') return 'dark'
    if (themeMode === 'light') return 'light'
    return systemDark ? 'dark' : 'light'
  }, [themeMode, systemDark])

  const muiTheme = useMemo(() => buildTheme(effectiveMode), [effectiveMode])

  const setThemeMode = useCallback(async (mode: ThemeMode): Promise<void> => {
    setThemeModeState(mode)
    await window.sqlSentinel.saveSettings({ themeMode: mode })
  }, [])

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode }}>
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        {authChecking ? null : !session ? (
          <LoginPage onLogin={setSession} />
        ) : (
          <AuthContext.Provider value={{ session, logout: handleLogout }}>
            <WorkerProvider>
              <AppInner onLogout={handleLogout} />
            </WorkerProvider>
          </AuthContext.Provider>
        )}
      </ThemeProvider>
    </ThemeContext.Provider>
  )
}

export default App
