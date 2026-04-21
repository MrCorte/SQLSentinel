import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography
} from '@mui/material'
import { tokens } from '../../../styles/tokens'

// ---------------------------------------------------------------------------
// RenameAliasDialog
// ---------------------------------------------------------------------------

interface RenameAliasDialogProps {
  open: boolean
  serverId: string
  currentAlias: string
  onClose: () => void
  onSave: (alias: string) => void
}

export function RenameAliasDialog({
  open,
  serverId,
  currentAlias,
  onClose,
  onSave
}: RenameAliasDialogProps): React.JSX.Element {
  const [value, setValue] = useState(currentAlias)

  useEffect(() => {
    if (open) setValue(currentAlias)
  }, [open, currentAlias])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename server</DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TextField
          label="Display name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={serverId}
          fullWidth
          size="small"
          autoFocus
          helperText="Leave empty to show IP:Port"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(value)
            if (e.key === 'Escape') onClose()
          }}
        />
        <Typography
          variant="caption"
          sx={{ mt: 1, display: 'block', color: tokens.color.textSecondary }}
        >
          IP: {serverId}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onSave(value)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
