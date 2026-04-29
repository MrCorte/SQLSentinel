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

const AUTO_NAVIGATE_MS = 5000

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
  const [safeStorageWarning, setSafeStorageWarning] = useState(false)

  const alive = useRef(true)
  // Stable ref for onConfigured so the auto-navigate effect doesn't re-fire
  // when the parent passes a fresh callback reference on each render.
  const onConfiguredRef = useRef(onConfigured)
  useEffect(() => {
    onConfiguredRef.current = onConfigured
  })

  useEffect(() => {
    return () => {
      alive.current = false
    }
  }, [])

  // Probe safeStorage availability once at mount — surface plaintext-fallback risk to user.
  useEffect(() => {
    let cancelled = false
    void window.sqlSentinel.storage.getSafeStorageStatus().then((res) => {
      if (cancelled) return
      if (res.ok && !res.data.available) setSafeStorageWarning(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-navigate after successful setup. Depends only on setupResult so it
  // fires exactly once even if onConfigured identity changes.
  useEffect(() => {
    if (!setupResult) return
    const t = setTimeout(() => {
      if (alive.current) onConfiguredRef.current()
    }, AUTO_NAVIGATE_MS)
    return () => clearTimeout(t)
  }, [setupResult])

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
    if (!alive.current) return
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
    if (!alive.current) return
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
            {form.host}:{form.port} / {form.database}
          </Typography>

          <Stack spacing={1.5}>
            <SetupRow label="Tables" items={setupResult.tables} />
            <SetupRow label="Indexes" items={setupResult.indexes} />
            <SetupRow label="Statistics" items={setupResult.statistics} />
            <SetupRow
              label="Admin account"
              items={['admin (must change password on first login)']}
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
                  <Typography
                    key={i}
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ pl: 3 }}
                  >
                    {w}
                  </Typography>
                ))}
              </Box>
            )}
          </Stack>

          <Button variant="contained" sx={{ mt: 3 }} onClick={onConfigured}>
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
          SQLSentinel needs a SQL Server database (2025 recommended) to store metrics, settings,
          and user data.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {safeStorageWarning && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            OS keyring (DPAPI / Keychain / Secret Service) is not available on this machine.
            The storage password will be saved in plaintext to the local config file. Continue
            only if you understand the risk.
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

function SetupRow({ label, items }: { label: string; items: string[] }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {label} ({items.length})
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {items.map((item) => (
          <Chip key={item} label={item} size="small" variant="outlined" />
        ))}
      </Box>
    </Box>
  )
}
