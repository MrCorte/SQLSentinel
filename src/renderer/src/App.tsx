import { useState, useEffect } from 'react'
import { Box, Tabs, Tab, IconButton, Badge, Tooltip, Typography } from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import SettingsIcon from '@mui/icons-material/Settings'
import { Discovery } from './pages/Discovery'
import { Inventory } from './pages/Inventory'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { AlertsDrawer } from './components/AlertsDrawer'
import { HomeDashboard } from './components/HomeDashboard'
import { WorkerProvider } from './context/WorkerContext'
import { useWorker } from './context/useWorker'
import { useServersStore } from './store/serversStore'
import { useAlertsStore } from './store/alertsStore'
import { useAppStore } from './store/appStore'
import { useMetricsStore } from './store/metricsStore'
import { tokens } from './styles/tokens'

// ---------------------------------------------------------------------------
// Inner — accede a WorkerContext (deve essere dentro WorkerProvider)
// ---------------------------------------------------------------------------

function AppInner(): React.JSX.Element {
  const [tab, setTab] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { setRetentionMinutes } = useWorker()
  const { alerts, setAlerts, addAlert, acknowledgeAlert: acknowledgeAlertInStore } = useAlertsStore()

  // Load persisted servers on mount
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
  useEffect(() => {
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
          bgcolor: tokens.color.bgCard,
          borderBottom: `1px solid ${tokens.color.border}`,
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
              color: tokens.color.textSecondary,
              '&.Mui-selected': { color: tokens.color.primary }
            }}
          />
          <Tab
            value={2}
            label="Inventario"
            sx={{
              color: tokens.color.textSecondary,
              '&.Mui-selected': { color: tokens.color.primary }
            }}
          />
          <Tab
            value={3}
            label="Dashboard"
            sx={{
              color: tokens.color.textSecondary,
              '&.Mui-selected': { color: tokens.color.primary }
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
              color: criticalCount > 0 ? tokens.color.error : tokens.color.textSecondary,
              '&:hover': { bgcolor: tokens.color.bgApp }
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
              color: tab === 4 ? tokens.color.primary : tokens.color.textSecondary,
              '&:hover': { bgcolor: tokens.color.bgApp }
            }}
          >
            <SettingsIcon fontSize="small" />
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
  return (
    <WorkerProvider>
      <AppInner />
    </WorkerProvider>
  )
}

export default App
