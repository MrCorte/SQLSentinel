import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { tokens } from '../../styles/tokens'
import type { IncidentAction } from '../../../../preload/index'
import { notify } from '../../store/notifyStore'
import { isDestructiveAction, confirmTokenForAction } from './actionMeta'
import { ConfirmActionDialog } from './ConfirmActionDialog'

interface Props {
  action: IncidentAction
  /** Called with the updated action after approve/reject so the caller can re-render. */
  onUpdated: (action: IncidentAction) => void
}

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'warning',
  executed: 'success',
  rejected: 'default',
  failed: 'error'
}

/**
 * Renders one AI-proposed remediation action with its T-SQL preview, a risk
 * badge, and Approve/Reject controls. Destructive actions route the approval
 * through a typed-confirmation dialog. Used by the AI chat panel.
 */
export function ActionCard({ action, onUpdated }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isPending = action.status === 'pending'
  const destructive = isDestructiveAction(action.toolName)

  async function runApprove(confirmation?: string): Promise<void> {
    setBusy(true)
    const res = await window.sqlSentinel.actions.approve({ actionId: action.id, confirmation })
    setBusy(false)
    if (!res.ok) {
      notify.error(res.error, 'Fix failed')
      return
    }
    onUpdated(res.data)
    notify.success(`${action.toolName} executed on the server.`, 'Fix applied')
  }

  function handleApprove(): void {
    if (destructive) {
      setConfirmOpen(true)
      return
    }
    void runApprove()
  }

  async function handleReject(): Promise<void> {
    setBusy(true)
    const res = await window.sqlSentinel.actions.reject({ actionId: action.id })
    setBusy(false)
    if (!res.ok) {
      notify.error(res.error, 'Reject failed')
      return
    }
    onUpdated(res.data)
  }

  const expectedToken = confirmTokenForAction(action) ?? 'CONFIRM'

  return (
    <Box
      sx={{
        border: `1px solid ${isPending ? tokens.color.warning : tokens.color.bgBorder}`,
        borderRadius: 1,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        bgcolor: tokens.color.bgSurface
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          label={action.toolName}
          size="small"
          sx={{
            bgcolor: isPending ? tokens.color.warning : tokens.color.accent,
            color: '#fff',
            fontWeight: 600,
            fontSize: 11
          }}
        />
        <Chip
          label={action.status}
          size="small"
          color={STATUS_COLOR[action.status] ?? 'default'}
          sx={{ height: 20, fontSize: 10 }}
        />
        {destructive && (
          <Chip
            label="destructive"
            size="small"
            color="error"
            variant="outlined"
            sx={{ height: 20, fontSize: 10 }}
          />
        )}
      </Box>

      <Typography sx={{ fontSize: 12, color: tokens.color.textMuted, wordBreak: 'break-word' }}>
        {action.explanation}
      </Typography>

      {action.tsqlPreview && (
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
      )}

      {action.status === 'failed' && action.rejectionReason && (
        <Typography sx={{ fontSize: 11, color: tokens.color.danger, wordBreak: 'break-word' }}>
          {action.rejectionReason}
        </Typography>
      )}

      {isPending && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            variant="contained"
            color="warning"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={12} /> : <CheckCircleIcon fontSize="small" />}
            onClick={handleApprove}
          >
            Approve &amp; Run
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disabled={busy}
            onClick={handleReject}
          >
            Reject
          </Button>
        </Box>
      )}

      <ConfirmActionDialog
        open={confirmOpen}
        toolName={action.toolName}
        expectedToken={expectedToken}
        tsqlPreview={action.tsqlPreview}
        onClose={() => setConfirmOpen(false)}
        onConfirm={(token) => {
          setConfirmOpen(false)
          void runApprove(token)
        }}
      />
    </Box>
  )
}
