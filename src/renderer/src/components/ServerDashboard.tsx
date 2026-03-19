import { useState } from 'react'
import { Paper, Box, Tooltip, Chip, Select, MenuItem } from '@mui/material'
import type { StoredServer, CollectMetricsRequest, ServerMetrics } from '../../../preload/index'
import type { MetricsHistoryPoint } from '../hooks/useMetrics'
import { MetricsPanel } from './MetricsPanel'
import { ServerHistorySection } from './ServerHistoryChart'
import { useServersStore } from '../store/serversStore'
import { HOSTING_OPTIONS, HOSTING_BADGE } from '../constants/hosting'
import type { ServerHostingType } from '../constants/hosting'

interface Props {
  server: StoredServer
  metrics: ServerMetrics
  history: MetricsHistoryPoint[]
  connection: CollectMetricsRequest
}

/**
 * Per-server dashboard:
 *
 *  1. KPI cards (CPU, Memoria, Uptime, Sessioni)  — rendered inside MetricsPanel → Tab Panoramica
 *  2. Storico CPU / Memoria                       — ring-buffer sparkline (NEW)
 *  3. Tabella database                            — MetricsPanel → Tab Database
 *  4. Sessioni / Blocchi / Job                   — MetricsPanel → tabs
 *
 * The Storico section is injected above the MetricsPanel tabs so it is always
 * visible regardless of which tab is active, giving a permanent at-a-glance
 * history view while the DBA works through the detail tabs below.
 */
export function ServerDashboard({ server, metrics, history, connection }: Props): React.JSX.Element {
  // serverId matches the "ip:port" key used throughout metricsStore / workerStore
  const serverId = `${server.ip ?? server.host}:${server.port}`
  const updateServer = useServersStore((s) => s.updateServer)
  const [editingHosting, setEditingHosting] = useState(false)

  const currentHosting: ServerHostingType = server.hostingType ?? 'on-premise'
  const badge = HOSTING_BADGE[currentHosting]

  return (
    <>
      {/* ── Hosting badge (inline edit) ───────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        {editingHosting ? (
          <Select
            size="small"
            autoFocus
            value={currentHosting}
            onChange={async (e) => {
              await updateServer(server.id, { hostingType: e.target.value as ServerHostingType })
              setEditingHosting(false)
            }}
            onBlur={() => setEditingHosting(false)}
            sx={{ fontSize: 12, height: 28 }}
          >
            {HOSTING_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: 12 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {opt.icon} {opt.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        ) : (
          <Tooltip title="Clicca per modificare il tipo di infrastruttura">
            <Chip
              label={badge.label}
              size="small"
              onClick={() => setEditingHosting(true)}
              sx={{
                cursor: 'pointer',
                backgroundColor: badge.color,
                color: '#fff',
                fontWeight: 700,
                fontSize: 10,
                borderRadius: '3px',
                '&:hover': { opacity: 0.85 }
              }}
            />
          </Tooltip>
        )}
      </Box>

      {/* ── Storico CPU / Memoria ─────────────────────────────────────── */}
      <Paper sx={{ p: 2, mb: 2, flexShrink: 0 }}>
        <ServerHistorySection serverId={serverId} />
      </Paper>

      {/* ── KPI cards + tabs (Panoramica, Database, Sessioni …) ──────── */}
      <MetricsPanel
        metrics={metrics}
        history={history}
        serverId={serverId}
        connection={connection}
      />
    </>
  )
}
