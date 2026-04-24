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
  InputLabel,
  CircularProgress,
  Chip
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { useGroupsStore } from '../store/groupsStore'
import { HOSTING_OPTIONS } from '../constants/hosting'
import type { ServerHostingType } from '../constants/hosting'
import { tokens } from '../styles/tokens'

export interface AddServerFormData {
  ip: string
  port: number
  instanceName: string
  machineName?: string
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
  const [testState, setTestState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [testLabel, setTestLabel] = useState('')

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
      setTestState('idle')
      setTestLabel('')
    }
  }, [open, initialIp, initialPort]) // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (): boolean => {
    const newErrors: FormErrors = {}
    if (!form.ip.trim()) newErrors.ip = 'IP or hostname required'
    const portNum = Number(form.port)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      newErrors.port = 'Port must be a number between 1 and 65535'
    if (!form.useWindowsAuth && !form.username.trim())
      newErrors.username = 'Username required for SQL Server authentication'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleTestConnection = async (): Promise<void> => {
    if (!form.ip.trim()) {
      setErrors((e) => ({ ...e, ip: 'IP or hostname required' }))
      return
    }
    setTestState('loading')
    setTestLabel('')
    try {
      const result = await window.sqlSentinel.detectServerInfo({
        ip: form.ip.trim(),
        port: Number(form.port),
        instanceName: form.instanceName || undefined,
        useWindowsAuth: form.useWindowsAuth,
        username: form.username || undefined,
        password: form.password || undefined
      })
      if (!result.ok) {
        setTestState('error')
        setTestLabel(result.error)
        return
      }
      const { machineName, instanceName } = result.data
      // Auto-fill alias only if the field is empty; always capture machineName
      setForm((prev) => ({
        ...prev,
        machineName,
        instanceName: instanceName ?? '',
        alias: prev.alias?.trim() ? prev.alias : machineName
      }))
      const label = instanceName ? `${machineName}\\${instanceName}` : machineName
      setTestState('success')
      setTestLabel(label)
    } catch (err) {
      setTestState('error')
      setTestLabel(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSave = (): void => {
    if (validate()) onSave({ ...form, port: Number(form.port) })
  }

  const set = <K extends keyof AddServerFormData>(key: K, value: AddServerFormData[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add SQL Server</DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <TextField
              label="IP / Hostname"
              value={form.ip}
              onChange={(e) => set('ip', e.target.value)}
              error={!!errors.ip}
              helperText={errors.ip}
              fullWidth
              autoFocus
              placeholder="e.g. 192.168.1.10 or SQLSERVER01"
            />
            <TextField
              label="Port"
              type="number"
              value={form.port}
              onChange={(e) => set('port', Number(e.target.value))}
              error={!!errors.port}
              helperText={
                errors.port ||
                'For named instances with SQL Browser disabled, specify the static port (SQL Server Configuration Manager → TCP/IP → IPAll → TCP Port)'
              }
              sx={{ width: 140, flexShrink: 0 }}
              inputProps={{ min: 1, max: 65535 }}
            />
          </Stack>

          <TextField
            label="Instance Name (optional)"
            value={form.instanceName}
            onChange={(e) => set('instanceName', e.target.value)}
            placeholder="e.g. SQLEXPRESS"
            fullWidth
          />

          {/* Test connection status */}
          {testState !== 'idle' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {testState === 'loading' && (
                <>
                  <CircularProgress size={16} />
                  <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
                    Connecting…
                  </Typography>
                </>
              )}
              {testState === 'success' && (
                <Chip
                  icon={<CheckCircleIcon />}
                  label={`Connected — ${testLabel}`}
                  size="small"
                  color="success"
                  variant="outlined"
                />
              )}
              {testState === 'error' && (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                  <ErrorIcon fontSize="small" color="error" sx={{ mt: '2px', flexShrink: 0 }} />
                  <Typography variant="caption" color="error.main">
                    {testLabel}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          <TextField
            label="Name (optional)"
            value={form.alias ?? ''}
            onChange={(e) => set('alias', e.target.value || undefined)}
            placeholder="e.g. SQL-PROD-01"
            helperText={
              testState === 'success'
                ? 'Auto-filled from MachineName — editable'
                : 'If empty, IP:Port will be shown'
            }
            fullWidth
          />

          <FormControl size="small" fullWidth>
            <InputLabel>Group</InputLabel>
            <Select
              label="Group"
              value={form.groupId ?? ''}
              onChange={(e) => set('groupId', e.target.value || undefined)}
            >
              <MenuItem value="">No group</MenuItem>
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
            <InputLabel>Infrastructure type</InputLabel>
            <Select
              label="Infrastructure type"
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
              form.useWindowsAuth ? 'Windows Authentication (NTLM)' : 'SQL Server Authentication'
            }
          />

          {!form.useWindowsAuth && (
            <>
              <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
                Credentials are stored locally in encrypted form.
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
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleTestConnection}
          disabled={testState === 'loading'}
          startIcon={
            testState === 'loading' ? <CircularProgress size={14} color="inherit" /> : undefined
          }
        >
          Test connection
        </Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
