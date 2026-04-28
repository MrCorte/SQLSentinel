// src/renderer/src/pages/StorageSetupPage.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { Box, Button, CircularProgress, TextField, Typography, Alert, Stack } from '@mui/material'

interface FormState {
  host: string
  port: string
  database: string
  username: string
  password: string
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
    password: ''
  })
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [tested, setTested] = useState(false)

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  function field(key: keyof FormState) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }))
        setTested(false)
        setError(null)
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
      password: form.password
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
      password: form.password
    })
    if (!alive.current) return
    setSaving(false)
    if (result.ok) {
      onConfigured()
    } else {
      setError(result.error ?? 'Save failed')
    }
  }, [form, onConfigured])

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
