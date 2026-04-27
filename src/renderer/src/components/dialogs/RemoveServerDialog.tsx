import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography
} from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

interface Props {
  open: boolean
  serverName: string
  onConfirm: () => void
  onClose: () => void
}

export function RemoveServerDialog({ open, serverName, onConfirm, onClose }: Props): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Remove server from monitoring</DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <WarningAmberIcon color="error" sx={{ mt: '2px', flexShrink: 0 }} />
          <Typography variant="body2">
            <strong>{serverName}</strong> will be removed from monitoring. All collected metrics and
            alerts for this server will be deleted.
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          Remove
        </Button>
      </DialogActions>
    </Dialog>
  )
}
