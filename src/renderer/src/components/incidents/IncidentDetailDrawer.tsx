import { useEffect, useState, useRef } from 'react'
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
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { tokens } from '../../styles/tokens'
import { useShallow } from 'zustand/react/shallow'
import { useIncidentsStore, loadDetail } from '../../store/incidentsStore'
import { notify } from '../../store/notifyStore'
import { useAuth } from '../../context/AuthContext'
import type { IncidentEvent, IncidentAction, IncidentAuditEntry, IncidentStatus } from '../../../../preload/index'

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
  const { selectedId, detail, loadingDetail } = useIncidentsStore(
    useShallow((s) => ({ selectedId: s.selectedId, detail: s.detail, loadingDetail: s.loadingDetail }))
  )
  const { session } = useAuth()
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentTokens, setAgentTokens] = useState('')
  const tokenBufRef = useRef('')
  const [pendingActions, setPendingActions] = useState<IncidentAction[]>([])
  const [actionBusy, setActionBusy] = useState<string | null>(null) // actionId being approved/rejected

  useEffect(() => {
    if (open && selectedId) {
      loadDetail(selectedId)
      setAgentTokens('')
      tokenBufRef.current = ''
      setPendingActions([])
    }
  }, [open, selectedId])

  // Sync pending actions from loaded detail.
  useEffect(() => {
    const actions = (detail?.actions ?? []).filter((a) => a.status === 'pending')
    setPendingActions(actions)
  }, [detail])

  // Subscribe to live agent events for this incident.
  useEffect(() => {
    if (!open || !selectedId) return
    const unsub = window.sqlSentinel.incidents.onAgentEvent(({ incidentId, event }) => {
      if (incidentId !== selectedId) return
      if (event.type === 'token') {
        tokenBufRef.current += event.text
        setAgentTokens(tokenBufRef.current)
      } else if (event.type === 'done' || event.type === 'error') {
        setAgentRunning(false)
        loadDetail(selectedId)
      } else if (event.type === 'tool_start') {
        setAgentRunning(true)
      }
    })
    return unsub
  }, [open, selectedId])

  // Subscribe to action push events (proposed / approved / rejected).
  useEffect(() => {
    if (!open || !selectedId) return
    const unsub = window.sqlSentinel.incidents.onAction(({ incidentId, action }) => {
      if (incidentId !== selectedId) return
      setPendingActions((prev) => {
        if (action.status === 'pending') {
          return prev.some((a) => a.id === action.id) ? prev : [...prev, action]
        }
        return prev.filter((a) => a.id !== action.id)
      })
    })
    return unsub
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

  async function handleRunAgent(): Promise<void> {
    if (!incident || agentRunning) return
    setAgentRunning(true)
    tokenBufRef.current = ''
    setAgentTokens('')
    const res = await window.sqlSentinel.incidents.runAgent(incident.id)
    if (!res.ok) {
      notify.error(res.error, 'Agent failed to start')
      setAgentRunning(false)
    }
  }

  async function handleApproveAction(actionId: string): Promise<void> {
    setActionBusy(actionId)
    const res = await window.sqlSentinel.incidents.approveAction({ actionId, approvedBy: session.username })
    setActionBusy(null)
    if (!res.ok) notify.error(res.error, 'Action failed')
    else loadDetail(selectedId!)
  }

  async function handleRejectAction(actionId: string): Promise<void> {
    setActionBusy(actionId)
    const res = await window.sqlSentinel.incidents.rejectAction({ actionId })
    setActionBusy(null)
    if (!res.ok) notify.error(res.error, 'Reject failed')
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
        <Tooltip title={agentRunning ? 'AI analysis running…' : 'Run AI analysis'}>
          <span>
            <IconButton size="small" onClick={handleRunAgent} disabled={!incident || agentRunning}>
              {agentRunning ? <CircularProgress size={16} /> : <SmartToyIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
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

            {/* Live AI stream */}
            {(agentRunning || agentTokens) && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <Typography sx={{ fontSize: 11, color: tokens.color.textMuted }}>AI Analysis</Typography>
                  {agentRunning && <CircularProgress size={10} sx={{ ml: 0.5 }} />}
                </Box>
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
                    m: 0,
                    maxHeight: 240,
                    overflowY: 'auto'
                  }}
                >
                  {agentTokens || '…'}
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

            {/* AI investigation audit */}
            {(detail?.audit ?? []).length > 0 && (
              <>
                <Divider />
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    AI Investigations
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {(detail!.audit).map((entry: IncidentAuditEntry) => (
                      <AuditRow key={entry.id} entry={entry} />
                    ))}
                  </Box>
                </Box>
              </>
            )}

            {/* Pending action proposals */}
            {pendingActions.length > 0 && (
              <>
                <Divider />
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: tokens.color.warning, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Pending Actions ({pendingActions.length})
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {pendingActions.map((action) => (
                      <ActionApprovalCard
                        key={action.id}
                        action={action}
                        busy={actionBusy === action.id}
                        onApprove={() => handleApproveAction(action.id)}
                        onReject={() => handleRejectAction(action.id)}
                      />
                    ))}
                  </Box>
                </Box>
              </>
            )}

            {/* Status buttons */}
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

function AuditRow({ entry }: { entry: IncidentAuditEntry }): React.JSX.Element {
  const ts = new Date(entry.at).toLocaleString()
  const providerColor = entry.provider === 'claude' ? tokens.color.accent : tokens.color.textMuted
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', py: 0.5 }}>
      <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, flexShrink: 0, minWidth: 130 }}>
        {ts}
      </Typography>
      <Chip
        label={entry.provider}
        size="small"
        sx={{ height: 16, fontSize: 10, bgcolor: providerColor, color: '#fff', flexShrink: 0 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.model}
        </Typography>
        {(entry.tokensIn != null || entry.tokensOut != null) && (
          <Typography sx={{ fontSize: 10, color: tokens.color.textMuted }}>
            {entry.tokensIn != null ? `↑${entry.tokensIn}` : ''}{entry.tokensOut != null ? ` ↓${entry.tokensOut}` : ''} tokens
          </Typography>
        )}
      </Box>
    </Box>
  )
}

interface ActionApprovalCardProps {
  action: IncidentAction
  busy: boolean
  onApprove: () => void
  onReject: () => void
}

function ActionApprovalCard({ action, busy, onApprove, onReject }: ActionApprovalCardProps): React.JSX.Element {
  return (
    <Box
      sx={{
        border: `1px solid ${tokens.color.warning}`,
        borderRadius: 1,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          label={action.toolName.replace(/_/g, ' ')}
          size="small"
          sx={{ bgcolor: tokens.color.warning, color: '#fff', fontWeight: 600, fontSize: 11 }}
        />
        <Typography sx={{ fontSize: 12, color: tokens.color.textMuted, wordBreak: 'break-word' }}>
          {action.explanation}
        </Typography>
      </Box>

      <Box
        component="pre"
        sx={{
          fontSize: 11,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          bgcolor: tokens.color.bgBase,
          border: `1px solid ${tokens.color.bgBorder}`,
          borderRadius: 1,
          p: 1,
          m: 0,
          maxHeight: 120,
          overflowY: 'auto'
        }}
      >
        {action.tsqlPreview}
      </Box>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          size="small"
          variant="contained"
          color="warning"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={12} /> : <CheckCircleIcon fontSize="small" />}
          onClick={onApprove}
        >
          Approve & Run
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          disabled={busy}
          onClick={onReject}
        >
          Reject
        </Button>
      </Box>
    </Box>
  )
}
