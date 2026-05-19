import { useEffect } from 'react'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ArchiveIcon from '@mui/icons-material/Archive'
import DownloadIcon from '@mui/icons-material/Download'
import { tokens } from '../../styles/tokens'
import { useIncidentsStore, loadDetail } from '../../store/incidentsStore'
import { notify } from '../../store/notifyStore'
import type { IncidentEvent, IncidentStatus } from '../../../../preload/index'

const DRAWER_WIDTH = 480

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: tokens.color.danger,
  WARNING: tokens.color.warning
}

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'error' | 'success' | 'info'> = {
  open: 'error',
  investigating: 'warning',
  awaiting_approval: 'warning',
  resolved: 'success',
  archived: 'default'
}

interface Props {
  open: boolean
  onClose: () => void
}

export function IncidentDetailDrawer({ open, onClose }: Props): React.JSX.Element {
  const { selectedId, detail, loadingDetail } = useIncidentsStore()

  useEffect(() => {
    if (open && selectedId) loadDetail(selectedId)
  }, [open, selectedId])

  const incident = detail?.incident

  async function handleSetStatus(status: IncidentStatus): Promise<void> {
    if (!incident) return
    const res = await window.sqlSentinel.incidents.setStatus({ id: incident.id, status })
    if (!res.ok) notify.error(res.error, 'Status update failed')
  }

  async function handleExport(): Promise<void> {
    if (!incident) return
    const res = await window.sqlSentinel.incidents.exportPostmortem(incident.id)
    if (!res.ok) { notify.error(res.error, 'Export failed'); return }
    const blob = new Blob([res.data], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `incident-${incident.id.slice(0, 8)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      PaperProps={{ sx: { width: DRAWER_WIDTH, display: 'flex', flexDirection: 'column' } }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: tokens.color.bgSurface,
          borderBottom: `1px solid ${tokens.color.bgBorder}`,
          flexShrink: 0
        }}
      >
        <Typography sx={{ flex: 1, fontWeight: 600, fontSize: 14 }}>
          {incident ? `Incident #${incident.id.slice(0, 8)}` : 'Incident Detail'}
        </Typography>
        <Tooltip title="Export postmortem">
          <span>
            <IconButton size="small" onClick={handleExport} disabled={!incident}>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {loadingDetail && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {incident && !loadingDetail && (
          <>
            {/* Metadata */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              <Chip
                label={incident.severity}
                size="small"
                sx={{
                  bgcolor: SEVERITY_COLOR[incident.severity] ?? tokens.color.textMuted,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 11
                }}
              />
              <Chip
                label={incident.status}
                size="small"
                color={STATUS_COLOR[incident.status] ?? 'default'}
              />
              <Typography sx={{ fontSize: 12, color: tokens.color.textMuted }}>
                {incident.category.replace(/_/g, ' ')}
              </Typography>
            </Box>

            <Box>
              <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, mb: 0.5 }}>Server</Typography>
              <Typography sx={{ fontSize: 13, fontFamily: 'monospace' }}>{incident.serverId}</Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 3 }}>
              <Box>
                <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, mb: 0.5 }}>Opened</Typography>
                <Typography sx={{ fontSize: 12 }}>{new Date(incident.openedAt).toLocaleString()}</Typography>
              </Box>
              {incident.resolvedAt && (
                <Box>
                  <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, mb: 0.5 }}>Resolved</Typography>
                  <Typography sx={{ fontSize: 12 }}>{new Date(incident.resolvedAt).toLocaleString()}</Typography>
                </Box>
              )}
            </Box>

            {incident.summary && (
              <Box>
                <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, mb: 0.5 }}>Summary</Typography>
                <Typography sx={{ fontSize: 13 }}>{incident.summary}</Typography>
              </Box>
            )}

            {incident.rootCauseMd && (
              <Box>
                <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, mb: 0.5 }}>Root Cause Analysis</Typography>
                <Box
                  component="pre"
                  sx={{
                    fontSize: 12,
                    fontFamily: 'inherit',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    bgcolor: tokens.color.bgBase,
                    border: `1px solid ${tokens.color.bgBorder}`,
                    borderRadius: 1,
                    p: 1.5,
                    m: 0
                  }}
                >
                  {incident.rootCauseMd}
                </Box>
              </Box>
            )}

            <Divider />

            {/* Timeline */}
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Timeline
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {(detail?.events ?? []).map((ev: IncidentEvent) => (
                  <EventRow key={ev.id} event={ev} />
                ))}
                {detail?.events.length === 0 && (
                  <Typography sx={{ fontSize: 12, color: tokens.color.textMuted }}>No events yet</Typography>
                )}
              </Box>
            </Box>

            {/* Actions */}
            <Divider />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {(incident.status === 'open' || incident.status === 'investigating') && (
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  onClick={() => handleSetStatus('resolved')}
                >
                  Resolve
                </Button>
              )}
              {incident.status !== 'archived' && incident.status !== 'open' && incident.status !== 'investigating' && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ArchiveIcon />}
                  onClick={() => handleSetStatus('archived')}
                >
                  Archive
                </Button>
              )}
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  )
}

function EventRow({ event }: { event: IncidentEvent }): React.JSX.Element {
  const ts = new Date(event.at).toLocaleTimeString()
  const payload = event.payload as Record<string, unknown>

  let label = event.kind.replace(/_/g, ' ')
  let detail = ''

  if (event.kind === 'alert_added') {
    label = 'Alert'
    detail = String(payload.message ?? '')
  } else if (event.kind === 'tool_call') {
    label = 'Tool'
    detail = String(payload.name ?? '')
  } else if (event.kind === 'action_proposed') {
    label = 'Proposed'
    detail = String(payload.toolName ?? '')
  } else if (event.kind === 'action_executed') {
    label = 'Executed'
    detail = String(payload.toolName ?? '')
  } else if (event.kind === 'status_change') {
    label = 'Status'
    detail = `→ ${String(payload.status ?? '')}`
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, flexShrink: 0, pt: '1px', minWidth: 64 }}>
        {ts}
      </Typography>
      <Typography sx={{ fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 70 }}>
        {label}
      </Typography>
      {detail && (
        <Typography sx={{ fontSize: 12, color: tokens.color.textMuted, wordBreak: 'break-word' }}>
          {detail}
        </Typography>
      )}
    </Box>
  )
}
