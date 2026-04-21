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
      <DialogTitle>Rinomina server</DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TextField
          label="Nome visualizzato"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={serverId}
          fullWidth
          size="small"
          autoFocus
          helperText="Lascia vuoto per mostrare IP:Porta"
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
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" onClick={() => onSave(value)}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  )
}
