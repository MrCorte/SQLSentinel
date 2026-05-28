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
  Chip,
  Alert
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { PasswordField } from './ui/PasswordField'
import { useGroupsStore } from '../store/groupsStore'
import { HOSTING_OPTIONS } from '../constants/hosting'
import type { ServerHostingType } from '../constants/hosting'
import { tokens } from '../styles/tokens'

interface ParsedError {
  title: string
  hints: string[]
}

function parseConnectionError(raw: string): ParsedError {
  const r = raw.toLowerCase()

  if (r.includes('untrusted domain') || r.includes('cannot be used with integrated')) {
    return {
      title: 'Windows Authentication rejected',
      hints: [
        'The server is in a different domain or workgroup.',
        'Switch to SQL Server Authentication and use a SQL login.',
      ]
    }
  }
  if (r.includes('login failed')) {
    if (r.includes("login failed for user ''") || r.includes('windows')) {
      return {
        title: 'Windows Authentication failed',
        hints: [
          'The current Windows account has no SQL Server access.',
          "Ask the DBA to run: CREATE LOGIN [DOMAIN\\\\user] FROM WINDOWS; GRANT CONNECT SQL TO [DOMAIN\\\\user]",
          'Or switch to SQL Server Authentication.',
        ]
      }
    }
    return {
      title: 'Authentication failed',
      hints: [
        'Wrong username or password.',
        'The SQL login may be disabled or locked.',
      ]
    }
  }
  if (r.includes('econnrefused') || r.includes('connection refused')) {
    return {
      title: 'Connection refused',
      hints: [
        'SQL Server is not listening on this port.',
        'Enable TCP/IP in SQL Server Configuration Manager → Protocols → TCP/IP.',
        'Verify the port under TCP/IP → IP Addresses → IPAll → TCP Port.',
      ]
    }
  }
  if (
    r.includes('etimedout') ||
    r.includes('timed out') ||
    r.includes('failed to connect') ||
    r.includes('could not connect')
  ) {
    return {
      title: 'Connection timed out — server unreachable',
      hints: [
        'Verify the SQL Server service is running (services.msc → SQL Server).',
        'Check that the firewall allows the port (Windows Firewall + network firewall).',
        'Confirm the IP address and port are correct.',
      ]
    }
  }
  if (r.includes('enotfound') || r.includes('getaddrinfo')) {
    return {
      title: 'Hostname not found',
      hints: [
        'DNS cannot resolve this hostname.',
        'Use the IP address instead, or check the spelling.',
      ]
    }
  }
  if (r.includes('ssl') || r.includes('tls') || r.includes('certificate') || r.includes('wrong version')) {
    return {
      title: 'SSL / TLS error',
      hints: [
        'SQL Server certificate issue.',
        'In SQL Server Configuration Manager set "Force Encryption" to No.',
      ]
    }
  }
  if (r.includes('cannot open database')) {
    return {
      title: 'Default database not accessible',
      hints: [
        "Run: ALTER LOGIN [loginname] WITH DEFAULT_DATABASE = master",
      ]
    }
  }
  return { title: 'Connection failed', hints: [raw] }
}

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
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  agName?: string
  agGroupId?: string
}

interface Props {
  open: boolean
  initialIp?: string
  initialPort?: number
  initialInstanceName?: string
  initialUseWindowsAuth?: boolean
  initialUsername?: string
  initialPassword?: string
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
  initialInstanceName,
  initialUseWindowsAuth,
  initialUsername,
  initialPassword,
  onClose,
  onSave
}: Props): React.JSX.Element {
  const [form, setForm] = useState<AddServerFormData>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  const [testState, setTestState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [testLabel, setTestLabel] = useState('')
  const [agBadge, setAgBadge] = useState<{
    role: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
    agName: string
    agGroupId: string
  } | null>(null)

  const groups = useGroupsStore((state) => state.groups)
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order)

  useEffect(() => {
    if (open) {
      setForm({
        ...EMPTY_FORM,
        ip: initialIp ?? '',
        port: initialPort ?? 1433,
        instanceName: initialInstanceName ?? '',
        useWindowsAuth: initialUseWindowsAuth ?? true,
        username: initialUsername ?? '',
        password: initialPassword ?? '',
        groupId: sortedGroups[0]?.id
      })
      setErrors({})
      setTestState('idle')
      setTestLabel('')
      setAgBadge(null)
      if (initialIp && /^\d{1,3}(\.\d{1,3}){3}$/.test(initialIp.trim())) {
        const ip = initialIp.trim()
        const port = initialPort ?? 1433
        // DNS — fast, no credentials
        window.sqlSentinel.resolveHostname(ip).then((result) => {
          if (result.ok) {
            setForm((prev) => ({ ...prev, alias: prev.alias?.trim() ? prev.alias : result.data }))
          }
        })
        // SQL detection — fills instanceName and overrides alias with machineName if available
        window.sqlSentinel
          .detectServerInfo({ ip, port, useWindowsAuth: true })
          .then((result) => {
            if (!result.ok) return
            const { machineName, instanceName } = result.data
            setForm((prev) => ({
              ...prev,
              machineName,
              instanceName: prev.instanceName?.trim() ? prev.instanceName : (instanceName ?? ''),
              alias: prev.alias?.trim() ? prev.alias : machineName
            }))
          })
          .catch(() => {})
      }
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
      const { machineName, instanceName, agRole, agName, agGroupId } = result.data
      setForm((prev) => ({
        ...prev,
        machineName,
        instanceName: prev.instanceName?.trim() ? prev.instanceName : (instanceName ?? ''),
        alias: prev.alias?.trim() ? prev.alias : machineName,
        agRole,
        agName,
        agGroupId
      }))
      if (agRole && agName && agGroupId) {
        setAgBadge({ role: agRole, agName, agGroupId })
      } else {
        setAgBadge(null)
      }
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
              onBlur={(e) => {
                const ip = e.target.value.trim()
                if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return
                window.sqlSentinel.resolveHostname(ip).then((result) => {
                  if (result.ok) {
                    setForm((prev) => ({
                      ...prev,
                      alias: prev.alias?.trim() ? prev.alias : result.data
                    }))
                  }
                })
              }}
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
            helperText={
              testState === 'success'
                ? form.instanceName
                  ? 'Auto-filled from server — editable'
                  : 'Default instance (no named instance on this server)'
                : undefined
            }
            fullWidth
          />

          {/* Test connection status */}
          {testState === 'loading' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
                Connecting…
              </Typography>
            </Box>
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
          {testState === 'success' && agBadge && (
            <Chip
              label={
                agBadge.role === 'PRIMARY'
                  ? `AG Primary — ${agBadge.agName}`
                  : agBadge.role === 'SECONDARY'
                    ? `AG Secondary — ${agBadge.agName}`
                    : `AG Resolving — ${agBadge.agName}`
              }
              size="small"
              color={agBadge.role === 'PRIMARY' ? 'primary' : agBadge.role === 'SECONDARY' ? 'warning' : 'default'}
              variant="outlined"
            />
          )}
          {testState === 'success' && !agBadge && (
            <Chip label="Standalone" size="small" variant="outlined" />
          )}
          {testState === 'error' && (() => {
            const { title, hints } = parseConnectionError(testLabel)
            return (
              <Alert severity="error" sx={{ py: 0.5 }}>
                <Typography variant="caption" fontWeight={600} display="block">
                  {title}
                </Typography>
                {hints.length > 0 && (
                  <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                    {hints.map((h, i) => (
                      <Typography component="li" variant="caption" key={i}>
                        {h}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Alert>
            )
          })()}

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
              <PasswordField
                label="Password"
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
