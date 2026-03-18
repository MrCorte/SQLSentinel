import { Paper } from '@mui/material'
import type { StoredServer, CollectMetricsRequest, ServerMetrics } from '../../../preload/index'
import type { MetricsHistoryPoint } from '../hooks/useMetrics'
import { MetricsPanel } from './MetricsPanel'
import { ServerHistorySection } from './ServerHistoryChart'

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

  return (
    <>
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
