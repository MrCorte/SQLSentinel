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
  Typography,
  Box,
  Select,
  MenuItem,
  FormControl,
  InputLabel
} from '@mui/material'
import { useGroupsStore } from '../store/groupsStore'
import { HOSTING_OPTIONS } from '../constants/hosting'
import type { ServerHostingType } from '../constants/hosting'

export interface AddServerFormData {
  ip: string
  port: number
  instanceName: string
  useWindowsAuth: boolean
  username: string
  password: string
  groupId?: string
  alias?: string
  hostingType: ServerHostingType
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
  password: '',
  groupId: undefined,
  alias: undefined,
  hostingType: 'on-premise'
}

export function AddServerDialog({
  open,
  initialIp,
  initialPort,
  onClose,
  onSave
}: Props): React.JSX.Element {
  const [form, setForm] = useState<AddServerFormData>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})

  const groups = useGroupsStore((state) => state.groups)
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order)

  useEffect(() => {
    if (open) {
      setForm({
        ...EMPTY_FORM,
        ip: initialIp ?? '',
        port: initialPort ?? 1433,
        groupId: sortedGroups[0]?.id
      })
      setErrors({})
    }
  }, [open, initialIp, initialPort]) // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (): boolean => {
    const newErrors: FormErrors = {}
    if (!form.ip.trim()) newErrors.ip = 'IP o hostname obbligatorio'
    const portNum = Number(form.port)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      newErrors.port = 'Porta deve essere un numero tra 1 e 65535'
    if (!form.useWindowsAuth && !form.username.trim())
      newErrors.username = 'Username obbligatorio per autenticazione SQL Server'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = (): void => {
    if (validate()) onSave({ ...form, port: Number(form.port) })
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

          <TextField
            label="Nome (opzionale)"
            value={form.alias ?? ''}
            onChange={(e) => set('alias', e.target.value || undefined)}
            placeholder="es. SQL-PROD-01"
            helperText="Se vuoto, verrà mostrato IP:Porta"
            fullWidth
          />

          <FormControl size="small" fullWidth>
            <InputLabel>Gruppo</InputLabel>
            <Select
              label="Gruppo"
              value={form.groupId ?? ''}
              onChange={(e) => set('groupId', e.target.value || undefined)}
            >
              <MenuItem value="">Nessun gruppo</MenuItem>
              {sortedGroups.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  <Box
                    component="span"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
                  >
                    <Box
                      component="span"
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: g.color,
                        display: 'inline-block'
                      }}
                    />
                    {g.name}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel>Tipo infrastruttura</InputLabel>
            <Select
              label="Tipo infrastruttura"
              value={form.hostingType}
              onChange={(e) => set('hostingType', e.target.value as ServerHostingType)}
            >
              {HOSTING_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {opt.icon}
                    {opt.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={form.useWindowsAuth}
                onChange={(e) => set('useWindowsAuth', e.target.checked)}
              />
            }
            label={
              form.useWindowsAuth
                ? 'Autenticazione Windows (NTLM)'
                : 'Autenticazione SQL Server'
            }
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
