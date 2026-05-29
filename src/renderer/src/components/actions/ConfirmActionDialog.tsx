import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { tokens } from '../../styles/tokens'

interface Props {
  open: boolean
  /** Tool name being confirmed (shown to the user). */
  toolName: string
  /** Exact token the user must type to confirm — usually the server "host:port". */
  expectedToken: string
  /** The T-SQL that will run, for a final review. */
  tsqlPreview?: string
  onConfirm: (token: string) => void
  onClose: () => void
}

/**
 * Typed-confirmation gate for destructive remediation actions. The user must
 * type the exact server token before the Run button enables. The token is
 * passed back to the caller and forwarded to the main process, which re-checks
 * it server-side — this dialog is the UI half of that gate.
 */
export function ConfirmActionDialog({
  open,
  toolName,
  expectedToken,
  tsqlPreview,
  onConfirm,
  onClose
}: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const matches = text.trim() === expectedToken.trim()

  useEffect(() => {
    if (open) setText('')
  }, [open])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Confirm destructive action</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2 }}>
          <WarningAmberIcon color="error" sx={{ mt: '2px', flexShrink: 0 }} />
          <Typography sx={{ fontSize: 13 }}>
            <strong>{toolName}</strong> will run directly on the server using the elevated
            remediation credential. This action can affect production. To proceed, type the
            server&nbsp;
            <Box component="code" sx={{ fontFamily: 'monospace' }}>
              {expectedToken}
            </Box>{' '}
            below.
          </Typography>
        </Box>

        {tsqlPreview && (
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
              mb: 2,
              maxHeight: 140,
              overflowY: 'auto'
            }}
          >
            {tsqlPreview}
          </Box>
        )}

        <TextField
          autoFocus
          fullWidth
          size="small"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={expectedToken}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches) onConfirm(text.trim())
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          disabled={!matches}
          onClick={() => onConfirm(text.trim())}
        >
          Run on server
        </Button>
      </DialogActions>
    </Dialog>
  )
}
