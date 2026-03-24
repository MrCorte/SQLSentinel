import { useState, useEffect, useMemo, useCallback } from 'react'
import { Box, Tabs, Tab, IconButton, Badge, Tooltip, Typography } from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import SettingsIcon from '@mui/icons-material/Settings'
import LogoutIcon from '@mui/icons-material/Logout'
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
import { buildTheme } from './styles/theme'
import { ThemeContext, type ThemeMode } from './context/ThemeContext'
import { AuthContext } from './context/AuthContext'
import type { AuthSession } from '../../preload/index'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// ---------------------------------------------------------------------------
// Inner — accede a WorkerContext (deve essere dentro WorkerProvider)
// ---------------------------------------------------------------------------

function AppInner({ onLogout }: { onLogout: () => void }): React.JSX.Element {
  const [tab, setTab] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useMockData()

  const { setRetentionMinutes } = useWorker()
  const { alerts, setAlerts, addAlert, acknowledgeAlert: acknowledgeAlertInStore } = useAlertsStore()

  // Load persisted servers on mount — runs in both real and mock mode so that
  // servers added manually while VITE_USE_MOCK=true are preserved across restarts
  useEffect(() => {
    console.log('[App] init — chiamata loadServers')
    const { loadServers } = useServersStore.getState()

    if (!window.sqlSentinel?.servers?.getAll) {
      console.error('[App] sqlSentinel.servers non disponibile!')
      useServersStore.setState({ initialized: true })
      return
    }

    loadServers().then(() => {
      const { servers } = useServersStore.getState()
      console.log('[App] loadServers completato, servers:', servers.length)
      if (servers.length > 0) {
        window.sqlSentinel.workerStart({
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
      }
    })
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
  useEffect(() => {
    return window.sqlSentinel.onServerHealthUpdate((health) => {
      useMetricsStore.getState().setServerHealth(health)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // AG detection push: worker found replica roles — update serversStore in-place
  useEffect(() => {
    if (typeof window.sqlSentinel?.onServerConfigUpdated !== 'function') return
    return window.sqlSentinel.onServerConfigUpdated((updatedServers) => {
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
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for health-check push events
  useEffect(() => {
    if (typeof window.sqlSentinel?.onServerUnreachable !== 'function') {
      console.warn('[App] sqlSentinel.onServerUnreachable non disponibile — skip')
      return
    }
    const unsubUnreachable = window.sqlSentinel.onServerUnreachable(({ serverId, since }) => {
      useServersStore.getState().updateServer(serverId, {
        unreachable: true,
        unreachableSince: since
      })
    })
    const unsubRecovered = window.sqlSentinel.onServerRecovered((serverId) => {
      useServersStore.getState().updateServer(serverId, {
        unreachable: false,
        unreachableSince: undefined,
        lastSeen: new Date().toISOString()
      })
    })
    return () => {
      unsubUnreachable()
      unsubRecovered()
    }
  }, [])

  useEffect(() => {
    window.sqlSentinel.getSettings().then((result) => {
      if (result.ok) setRetentionMinutes(result.data.retentionMinutes)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.sqlSentinel.getAlerts().then((result) => {
      if (result.ok) setAlerts(result.data)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return window.sqlSentinel.onAlertNew((alert) => {
      addAlert(alert)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleAcknowledge(alertId: string): void {
    window.sqlSentinel.acknowledgeAlert({ alertId }).then((result) => {
      if (result.ok) {
        acknowledgeAlertInStore(alertId)
      }
    })
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
          borderBottom: 1,
          borderColor: 'divider',
          boxShadow: tokens.shadow.navbar,
          display: 'flex',
          alignItems: 'center',
          zIndex: 100,
          flexShrink: 0,
          px: 2,
          gap: 1
        }}
      >
        {/* Logo / product name */}
        <Typography
          onClick={() => setTab(0)}
          sx={{
            fontSize: tokens.font.sizeMd,
            fontWeight: tokens.font.weightSemibold,
            color: tokens.color.primary,
            letterSpacing: '-0.01em',
            mr: 2,
            whiteSpace: 'nowrap',
            cursor: 'pointer'
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
              height: 2
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
    window.sqlSentinel.checkAuth().then(({ authenticated, session: s }) => {
      if (authenticated && s) setSession(s)
      setAuthChecking(false)
    })
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
    window.sqlSentinel.getSettings().then((result) => {
      if (result.ok && result.data.themeMode) {
        setThemeModeState(result.data.themeMode as ThemeMode)
      }
    })
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
