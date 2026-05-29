import { useState } from 'react'
import { Paper, Box, Tooltip, Chip, Select, MenuItem, Typography } from '@mui/material'
import type { StoredServer, CollectMetricsRequest, ServerMetrics } from '../../../preload/index'
import { MetricsPanel } from './MetricsPanel'
import { ServerHistorySection } from './ServerHistoryChart'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import { useServersStore } from '../store/serversStore'
import { HOSTING_OPTIONS, HOSTING_BADGE } from '../constants/hosting'
import type { ServerHostingType } from '../constants/hosting'
import { getServerDisplayName } from '../types'
import { RemediationCredentialsDialog } from './actions/RemediationCredentialsDialog'

interface Props {
  server: StoredServer
  metrics: ServerMetrics
  connection: CollectMetricsRequest
  onRemove?: () => void
}

/**
 * Per-server dashboard:
 *
 *  1. Storico CPU / Memoria  — ring-buffer sparkline, always visible above the tabs
 *  2. KPI cards (Panoramica) — MetricsPanel → Tab Panoramica
 *  3. Tabella database        — MetricsPanel → Tab Database
 *  4. Sessioni / Blocchi / Job — MetricsPanel → tabs
 */
export function ServerDashboard({ server, metrics, connection, onRemove }: Props): React.JSX.Element {
  // serverId matches the "ip:port" key used throughout metricsStore / workerStore
  const serverId = `${server.ip ?? server.host}:${server.port}`
  const updateServer = useServersStore((s) => s.updateServer)
  const [editingHosting, setEditingHosting] = useState(false)
  const [hostingError, setHostingError] = useState<string | null>(null)
  const [remediationOpen, setRemediationOpen] = useState(false)

  const currentHosting: ServerHostingType = server.hostingType ?? 'on-premise'
  const badge = HOSTING_BADGE[currentHosting]
  const remediationConfigured =
    Boolean(server.remediationUsername) || server.remediationUseWindowsAuth === true

  return (
    <>
      {/* ── Hosting badge (inline edit) ───────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        {editingHosting ? (
          <>
            <Select
              size="small"
              autoFocus
              value={currentHosting}
              onChange={async (e) => {
                try {
                  setHostingError(null)
                  await updateServer(server.id, {
                    hostingType: e.target.value as ServerHostingType
                  })
                  setEditingHosting(false)
                } catch {
                  setHostingError('Failed to save')
                }
              }}
              onBlur={() => {
                setEditingHosting(false)
                setHostingError(null)
              }}
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
            {hostingError && (
              <Typography sx={{ fontSize: 11, color: 'error.main', ml: 1 }}>
                {hostingError}
              </Typography>
            )}
          </>
        ) : (
          <Tooltip title="Click to change infrastructure type">
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
        <Tooltip
          title={
            remediationConfigured
              ? 'Edit the elevated credential used to run approved AI fixes'
              : 'Configure an elevated credential to run approved AI fixes on this server'
          }
        >
          <Chip
            icon={<ShieldOutlinedIcon sx={{ fontSize: 14 }} />}
            label={remediationConfigured ? 'Remediation: on' : 'Remediation: off'}
            size="small"
            variant="outlined"
            color={remediationConfigured ? 'success' : 'default'}
            onClick={() => setRemediationOpen(true)}
            sx={{ ml: 1, cursor: 'pointer', fontSize: 10, borderRadius: '3px' }}
          />
        </Tooltip>
      </Box>

      <RemediationCredentialsDialog
        open={remediationOpen}
        server={server}
        onClose={() => setRemediationOpen(false)}
      />

      {/* ── Storico CPU / Memoria ─────────────────────────────────────── */}
      <Paper sx={{ p: 2, mb: 2, flexShrink: 0 }}>
        <ServerHistorySection serverId={serverId} />
      </Paper>

      {/* ── KPI cards + tabs (Panoramica, Database, Sessioni …) ──────── */}
      <MetricsPanel
        metrics={metrics}
        serverId={serverId}
        serverDbId={server.id}
        serverNotes={server.notes}
        serverDisplayName={getServerDisplayName({ ip: server.ip ?? server.host, port: server.port })}
        connection={connection}
        onRemove={onRemove}
      />
    </>
  )
}
