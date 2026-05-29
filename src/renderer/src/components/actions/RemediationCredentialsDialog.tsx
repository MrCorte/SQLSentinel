import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Stack from '@mui/material/Stack'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import { PasswordField } from '../ui/PasswordField'
import { tokens } from '../../styles/tokens'
import type { StoredServer } from '../../../../preload/index'
import { useServersStore } from '../../store/serversStore'
import { notify } from '../../store/notifyStore'

interface Props {
  open: boolean
  server: StoredServer
  onClose: () => void
}

/**
 * Editor for a server's elevated "remediation" credential — a higher-privilege
 * login used ONLY to execute approved AI-suggested fixes, keeping the monitoring
 * credential read-only. The password is write-only here: it's never sent back to
 * the renderer, so leaving it blank keeps the stored value unchanged.
 */
export function RemediationCredentialsDialog({ open, server, onClose }: Props): React.JSX.Element {
  const updateServer = useServersStore((s) => s.updateServer)
  const [useWindowsAuth, setUseWindowsAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setUseWindowsAuth(server.remediationUseWindowsAuth ?? false)
      setUsername(server.remediationUsername ?? '')
      setPassword('')
      setSaving(false)
    }
  }, [open, server])

  const configured =
    Boolean(server.remediationUsername) || server.remediationUseWindowsAuth === true

  async function handleSave(): Promise<void> {
    setSaving(true)
    const patch: Partial<StoredServer> = {
      remediationUseWindowsAuth: useWindowsAuth,
      remediationUsername: useWindowsAuth ? '' : username.trim()
    }
    // Only send the password when SQL auth and the user typed one — an empty
    // value leaves the stored (encrypted) password untouched.
    if (!useWindowsAuth && password.length > 0) {
      patch.remediationPassword = password
    }
    await updateServer(server.id, patch)
    setSaving(false)
    notify.success('Remediation credential saved.', 'Server updated')
    onClose()
  }

  async function handleDisable(): Promise<void> {
    setSaving(true)
    await updateServer(server.id, {
      remediationUseWindowsAuth: false,
      remediationUsername: ''
    })
    setSaving(false)
    notify.success('Remediation credential disabled.', 'Server updated')
    onClose()
  }

  const canSave = useWindowsAuth || username.trim().length > 0

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Remediation credential</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
            Elevated login used only to execute approved fixes on{' '}
            <strong>
              {server.host ?? server.ip ?? ''}:{server.port}
            </strong>
            . Your monitoring credential stays read-only. Stored locally, encrypted.
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={useWindowsAuth}
                onChange={(e) => setUseWindowsAuth(e.target.checked)}
              />
            }
            label={useWindowsAuth ? 'Windows Authentication (NTLM)' : 'SQL Server Authentication'}
          />

          {!useWindowsAuth && (
            <>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                fullWidth
              />
              <PasswordField
                label={configured ? 'Password (leave blank to keep current)' : 'Password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                fullWidth
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {configured && (
          <Button color="error" onClick={handleDisable} disabled={saving} sx={{ mr: 'auto' }}>
            Disable
          </Button>
        )}
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave || saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
