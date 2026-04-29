import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  TextField,
  Typography,
  Alert,
  Stack,
  Chip
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { SchemaInitResult } from '../../../preload/index'

interface FormState {
  host: string
  port: string
  database: string
  username: string
  password: string
  encrypt: boolean
  trustServerCertificate: boolean
}

interface Props {
  initialError?: string
  onConfigured: () => void
}

export function StorageSetupPage({ initialError, onConfigured }: Props): React.JSX.Element {
  const [form, setForm] = useState<FormState>({
    host: 'localhost',
    port: '1437', // non-default port — avoids collision with monitored SQL Server instances
    database: 'SQLSentinelDB',
    username: 'sqlsentinel_app',
    password: '',
    encrypt: false,
    trustServerCertificate: true
  })
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [tested, setTested] = useState(false)
  const [setupResult, setSetupResult] = useState<SchemaInitResult | null>(null)

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // Auto-navigate 2 seconds after successful setup
  useEffect(() => {
    if (!setupResult) return
    const t = setTimeout(() => { if (alive.current) onConfigured() }, 2000)
    return () => clearTimeout(t)
  }, [setupResult, onConfigured])

  function field(key: 'host' | 'port' | 'database' | 'username' | 'password') {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }))
        setTested(false)
        setError(null)
      }
    }
  }

  function checkField(key: 'encrypt' | 'trustServerCertificate') {
    return {
      checked: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.checked }))
        setTested(false)
      }
    }
  }

  const handleTest = useCallback(async () => {
    setTesting(true)
    setError(null)
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('Port must be a number between 1 and 65535')
      setTesting(false)
      return
    }
    const result = await window.sqlSentinel.storage.testConnection({
      host: form.host,
      port,
      database: form.database,
      username: form.username,
      password: form.password,
      encrypt: form.encrypt,
      trustServerCertificate: form.trustServerCertificate
    })
    setTesting(false)
    if (result.ok) {
      setTested(true)
    } else {
      setError(result.error ?? 'Connection failed')
    }
  }, [form])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('Port must be a number between 1 and 65535')
      setSaving(false)
      return
    }
    const result = await window.sqlSentinel.storage.saveConfig({
      host: form.host,
      port,
      database: form.database,
      username: form.username,
      password: form.password,
      encrypt: form.encrypt,
      trustServerCertificate: form.trustServerCertificate
    })
    setSaving(false)
    if (result.ok) {
      setSetupResult(result.data)
    } else {
      setError(result.error ?? 'Save failed')
    }
  }, [form])

  // ── Setup complete screen ────────────────────────────────────────────────
  if (setupResult) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default'
        }}
      >
        <Box sx={{ width: 460, p: 4 }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
            <CheckCircleOutlineIcon color="success" />
            <Typography variant="h5" fontWeight={700}>
              Database configured
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {form.host}:{form.port} / {form.database} — navigating in a moment…
          </Typography>

          <Stack spacing={1.5}>
            <SetupRow
              label="Tables"
              items={setupResult.tables}
              color="default"
            />
            <SetupRow
              label="Indexes"
              items={setupResult.indexes}
              color="default"
            />
            <SetupRow
              label="Statistics"
              items={setupResult.statistics}
              color="default"
            />
            <SetupRow
              label="Admin account"
              items={['admin (must change password on first login)']}
              color="default"
            />
            {setupResult.warnings.length > 0 && (
              <Box>
                <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                  <WarningAmberIcon fontSize="small" color="warning" />
                  <Typography variant="caption" color="warning.main">
                    {setupResult.warnings.length} optional step(s) skipped
                  </Typography>
                </Stack>
                {setupResult.warnings.map((w: string, i: number) => (
                  <Typography key={i} variant="caption" color="text.secondary" display="block" sx={{ pl: 3 }}>
                    {w}
                  </Typography>
                ))}
              </Box>
            )}
          </Stack>

          <Button
            variant="contained"
            sx={{ mt: 3 }}
            onClick={onConfigured}
          >
            Continue
          </Button>
        </Box>
      </Box>
    )
  }

  // ── Setup form ────────────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default'
      }}
    >
      <Box sx={{ width: 420, p: 4 }}>
        <Typography variant="h5" fontWeight={700} mb={1}>
          Storage Database
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          SQLSentinel needs a SQL Server 2025 database to store metrics, settings, and user data.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          <Stack direction="row" spacing={1}>
            <TextField label="Host" fullWidth {...field('host')} />
            <TextField label="Port" sx={{ width: 100 }} {...field('port')} />
          </Stack>
          <TextField label="Database" fullWidth {...field('database')} />
          <TextField label="Username" fullWidth {...field('username')} />
          <TextField label="Password" type="password" fullWidth {...field('password')} />

          <FormControlLabel
            control={<Checkbox {...checkField('encrypt')} size="small" />}
            label={<Typography variant="body2">Encrypt connection (TLS)</Typography>}
          />
          <FormControlLabel
            control={<Checkbox {...checkField('trustServerCertificate')} size="small" />}
            label={<Typography variant="body2">Trust self-signed certificate</Typography>}
          />

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="outlined" onClick={handleTest} disabled={testing || saving}>
              {testing ? <CircularProgress size={16} /> : 'Test Connection'}
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={!tested || saving}>
              {saving ? <CircularProgress size={16} /> : 'Save & Continue'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  )
}

// ── Helper: labelled chip-list row ──────────────────────────────────────────

function SetupRow({
  label,
  items,
  color
}: {
  label: string
  items: string[]
  color: 'default' | 'success' | 'warning'
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {label} ({items.length})
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {items.map((item) => (
          <Chip key={item} label={item} size="small" color={color} variant="outlined" />
        ))}
      </Box>
    </Box>
  )
}
