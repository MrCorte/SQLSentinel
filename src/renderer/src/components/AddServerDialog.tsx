import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Switch,
  Stack,
  Typography
} from '@mui/material'

export interface AddServerFormData {
  ip: string
  port: number
  instanceName: string
  useWindowsAuth: boolean
  username: string
  password: string
}

interface Props {
  open: boolean
  initialIp?: string
  initialPort?: number
  onClose: () => void
  onSave: (data: AddServerFormData) => void
}

interface FormErrors {
  ip?: string
  port?: string
  username?: string
}

const EMPTY_FORM: AddServerFormData = {
  ip: '',
  port: 1433,
  instanceName: '',
  useWindowsAuth: true,
  username: '',
  password: ''
}

export function AddServerDialog({ open, initialIp, initialPort, onClose, onSave }: Props): React.JSX.Element {
  const [form, setForm] = useState<AddServerFormData>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})

  // Pre-compila ip/porta quando il dialog viene aperto da una riga della tabella
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, ip: initialIp ?? '', port: initialPort ?? 1433 })
      setErrors({})
    }
  }, [open, initialIp, initialPort])

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!form.ip.trim()) {
      newErrors.ip = 'IP o hostname obbligatorio'
    }

    const portNum = Number(form.port)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      newErrors.port = 'Porta deve essere un numero tra 1 e 65535'
    }

    if (!form.useWindowsAuth && !form.username.trim()) {
      newErrors.username = 'Username obbligatorio per autenticazione SQL Server'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = (): void => {
    if (validate()) {
      onSave({ ...form, port: Number(form.port) })
    }
  }

  const set = <K extends keyof AddServerFormData>(key: K, value: AddServerFormData[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Aggiungi Server SQL</DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="IP / Hostname"
            value={form.ip}
            onChange={(e) => set('ip', e.target.value)}
            error={!!errors.ip}
            helperText={errors.ip}
            fullWidth
            autoFocus
            placeholder="es. 192.168.1.10 oppure SQLSERVER01"
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Porta"
              type="number"
              value={form.port}
              onChange={(e) => set('port', Number(e.target.value))}
              error={!!errors.port}
              helperText={errors.port}
              sx={{ width: 140 }}
              inputProps={{ min: 1, max: 65535 }}
            />
            <TextField
              label="Nome Istanza (opzionale)"
              value={form.instanceName}
              onChange={(e) => set('instanceName', e.target.value)}
              placeholder="es. SQLEXPRESS"
              fullWidth
            />
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={form.useWindowsAuth}
                onChange={(e) => set('useWindowsAuth', e.target.checked)}
              />
            }
            label={form.useWindowsAuth ? 'Autenticazione Windows (NTLM)' : 'Autenticazione SQL Server'}
          />

          {!form.useWindowsAuth && (
            <>
              <Typography variant="caption" color="text.secondary">
                Le credenziali sono salvate localmente in forma cifrata.
              </Typography>
              <TextField
                label="Username"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                error={!!errors.username}
                helperText={errors.username}
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                fullWidth
              />
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" onClick={handleSave}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  )
}
