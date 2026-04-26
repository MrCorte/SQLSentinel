import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Autocomplete
} from '@mui/material'

interface DbBulkEditDialogProps {
  open: boolean
  dbNames: string[]
  onClose: () => void
  onSave: (fields: { alias: string | undefined; referente: string | undefined }) => void
  aliasSuggestions: string[]
  ownerSuggestions: string[]
  saving: boolean
}

export function DbBulkEditDialog({
  open,
  dbNames,
  onClose,
  onSave,
  aliasSuggestions,
  ownerSuggestions,
  saving
}: DbBulkEditDialogProps): React.JSX.Element {
  const [alias, setAlias] = useState('')
  const [owner, setOwner] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    if (open) {
      setAlias('')
      setOwner('')
      setConfirmClear(false)
    }
  }, [open])

  const n = dbNames.length
  const subtitle =
    n <= 5 ? dbNames.join(', ') : `${dbNames.slice(0, 5).join(', ')} +${n - 5} more`

  const toValue = (s: string): string | undefined => s.trim() || undefined

  function handleApply(): void {
    const bothEmpty = !alias.trim() && !owner.trim()
    if (bothEmpty && !confirmClear) {
      setConfirmClear(true)
      return
    }
    onSave({ alias: toValue(alias), referente: toValue(owner) })
  }

  function handleAliasChange(value: string): void {
    setAlias(value)
    if (confirmClear) setConfirmClear(false)
  }

  function handleOwnerChange(value: string): void {
    setOwner(value)
    if (confirmClear) setConfirmClear(false)
  }

  const applyLabel = confirmClear
    ? 'Confirm — clear both fields?'
    : `Apply to ${n} database${n !== 1 ? 's' : ''}`

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        Edit {n} database{n !== 1 ? 's' : ''}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}
      >
        <Typography variant="caption" color="text.secondary">
          {subtitle}
        </Typography>

        <Autocomplete
          freeSolo
          options={aliasSuggestions}
          value={alias}
          onInputChange={(_, v) => handleAliasChange(typeof v === 'string' ? v : '')}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Alias"
              size="small"
              fullWidth
              inputProps={{ ...params.inputProps, 'data-testid': 'alias-input' }}
            />
          )}
        />

        <Autocomplete
          freeSolo
          options={ownerSuggestions}
          value={owner}
          onInputChange={(_, v) => handleOwnerChange(typeof v === 'string' ? v : '')}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Owner"
              size="small"
              fullWidth
              inputProps={{ ...params.inputProps, 'data-testid': 'owner-input' }}
            />
          )}
        />

        <Typography variant="caption" color="text.secondary">
          Values applied to all selected databases. Leave blank to clear.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          data-testid="apply-btn"
          variant="contained"
          color={confirmClear ? 'warning' : 'primary'}
          onClick={handleApply}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {applyLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
