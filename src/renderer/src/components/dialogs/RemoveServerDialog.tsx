import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField
} from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

interface Props {
  open: boolean
  serverName: string
  onConfirm: () => void
  onClose: () => void
}

export function RemoveServerDialog({ open, serverName, onConfirm, onClose }: Props): React.JSX.Element {
  const [confirmText, setConfirmText] = useState('')

  // Reset the confirm field every time the dialog opens — otherwise reopening
  // for a different server would leave the previous answer pre-filled.
  useEffect(() => {
    if (open) setConfirmText('')
  }, [open, serverName])

  const matches = confirmText.trim() === serverName.trim()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Remove server from monitoring</DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2 }}>
          <WarningAmberIcon color="error" sx={{ mt: '2px', flexShrink: 0 }} />
          <Typography variant="body2">
            <strong>{serverName}</strong> will be removed from monitoring. All collected metrics and
            alerts for this server will be deleted.
          </Typography>
        </Box>

        <Typography variant="body2" sx={{ mb: 1 }}>
          Type <strong>{serverName}</strong> to confirm:
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={serverName}
          inputProps={{ 'aria-label': 'Type the server name to confirm removal' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches) onConfirm()
          }}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={!matches}
          aria-label={`Remove ${serverName}`}
        >
          Remove
        </Button>
      </DialogActions>
    </Dialog>
  )
}
