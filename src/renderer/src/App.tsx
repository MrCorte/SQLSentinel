import { useState, useEffect } from 'react'
import { Box, Tabs, Tab, IconButton, Badge, Tooltip, Typography } from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import SettingsIcon from '@mui/icons-material/Settings'
import { Discovery } from './pages/Discovery'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { AlertsDrawer } from './components/AlertsDrawer'
import { WorkerProvider } from './context/WorkerContext'
import { useWorker } from './context/useWorker'
import { useServersStore } from './store/serversStore'
import { tokens } from './styles/tokens'
import type { Alert } from '../../preload/index'

// ---------------------------------------------------------------------------
// Inner — accede a WorkerContext (deve essere dentro WorkerProvider)
// ---------------------------------------------------------------------------

function AppInner(): React.JSX.Element {
  const [tab, setTab] = useState(0)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { setRetentionMinutes } = useWorker()

  // Load persisted servers on mount
  useEffect(() => {
    if (typeof window.sqlSentinel?.servers?.getAll === 'function') {
      useServersStore.getState().loadServers()
    } else {
      console.warn('[App] sqlSentinel.servers non disponibile — preload non aggiornato?')
      useServersStore.setState({ initialized: true })
    }
  }, [])

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
  }, [])

  useEffect(() => {
    return window.sqlSentinel.onAlertNew((alert) => {
      setAlerts((prev) => [...prev, alert])
    })
  }, [])

  function handleAcknowledge(alertId: string): void {
    window.sqlSentinel.acknowledgeAlert({ alertId }).then((result) => {
      if (result.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? { ...a, acknowledgedAt: new Date() } : a))
        )
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
          sx={{
            fontSize: tokens.font.sizeMd,
            fontWeight: tokens.font.weightSemibold,
            color: tokens.color.primary,
            letterSpacing: '-0.01em',
            mr: 2,
            whiteSpace: 'nowrap'
          }}
        >
          SQL Sentinel
        </Typography>

        {/* Pivot tabs — centrate, crescono */}
        <Tabs
          value={tab}
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
            label="Discovery"
            sx={{
              color: tokens.color.textSecondary,
              '&.Mui-selected': { color: tokens.color.primary }
            }}
          />
          <Tab
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
            onClick={() => setTab(2)}
            sx={{
              color: tab === 2 ? tokens.color.primary : tokens.color.textSecondary,
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
            <Discovery />
          </Box>
        )}
        {tab === 1 && (
          <Box sx={{ height: '100%', overflow: 'hidden' }}>
            <Dashboard />
          </Box>
        )}
        {tab === 2 && (
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
