import { useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material'
import { PasswordField } from '../components/ui/PasswordField'
import type { AuthSession } from '../../../preload/index'
import { tokens } from '../styles/tokens'

// ---------------------------------------------------------------------------
// ChangePasswordDialog — shown when must_change_password === 1
// ---------------------------------------------------------------------------

interface ChangePasswordDialogProps {
  userId: string
  onDone: () => void
}

// Live policy checks — same rules enforced server-side in authService.changePassword.
// We surface them as live indicators so the user knows what's missing without
// having to submit and read the error.
interface PasswordChecks {
  minLen: boolean
  uppercase: boolean
  digit: boolean
  match: boolean
}

function evaluatePolicy(newPwd: string, confirm: string): PasswordChecks {
  return {
    minLen: newPwd.length >= 8,
    uppercase: /[A-Z]/.test(newPwd),
    digit: /[0-9]/.test(newPwd),
    match: newPwd.length > 0 && newPwd === confirm
  }
}

function PolicyHint({ ok, label }: { ok: boolean; label: string }): React.JSX.Element {
  return (
    <Typography
      variant="caption"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        color: ok ? 'success.main' : 'text.secondary',
        fontSize: 11,
        lineHeight: 1.2
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{
          display: 'inline-block',
          width: 12,
          textAlign: 'center'
        }}
      >
        {ok ? '✓' : '·'}
      </Box>
      {label}
    </Typography>
  )
}

function ChangePasswordDialog({ userId, onDone }: ChangePasswordDialogProps): React.JSX.Element {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const checks = evaluatePolicy(newPwd, confirm)
  const allChecksPass = checks.minLen && checks.uppercase && checks.digit && checks.match

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    if (!allChecksPass) {
      // Should not happen — submit button is disabled — but defensive.
      setError('Password does not meet the policy')
      return
    }
    setLoading(true)
    const result = await window.sqlSentinel.changePassword(userId, oldPwd, newPwd)
    setLoading(false)
    if (!result.success) {
      setError(result.error ?? 'Password change failed')
    } else {
      onDone()
    }
  }

  return (
    <Dialog open disableEscapeKeyDown maxWidth="xs" fullWidth>
      <DialogTitle>Password change required</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          For security reasons you must set a new password before logging in.
        </Typography>
        <Box
          component="form"
          id="change-pwd-form"
          onSubmit={handleSubmit}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <PasswordField
            label="Current password"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            size="small"
            fullWidth
            autoFocus
          />
          <PasswordField
            label="New password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            size="small"
            fullWidth
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: -1 }}>
            <PolicyHint ok={checks.minLen} label="At least 8 characters" />
            <PolicyHint ok={checks.uppercase} label="At least 1 uppercase letter" />
            <PolicyHint ok={checks.digit} label="At least 1 number" />
          </Box>
          <PasswordField
            label="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            size="small"
            fullWidth
            error={confirm.length > 0 && !checks.match}
            helperText={
              confirm.length > 0 && !checks.match ? 'Passwords do not match' : undefined
            }
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          type="submit"
          form="change-pwd-form"
          variant="contained"
          disabled={loading || !oldPwd || !allChecksPass}
        >
          {loading ? <CircularProgress size={18} /> : 'Set password'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------

interface LoginPageProps {
  onLogin: (session: AuthSession) => void
}

export function LoginPage({ onLogin }: LoginPageProps): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Set after successful login when must_change_password === 1
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await window.sqlSentinel.login(username.trim(), password)
    setLoading(false)

    if (!result.success) {
      setError(result.error ?? 'Invalid credentials')
      return
    }

    if (result.mustChangePassword) {
      // Get userId from session — login succeeded so session exists
      const { session } = await window.sqlSentinel.checkAuth()
      setPendingUserId(session?.userId ?? null)
      return
    }

    const { session } = await window.sqlSentinel.checkAuth()
    if (session) onLogin(session)
  }

  async function handlePasswordChanged(): Promise<void> {
    setPendingUserId(null)
    const { session } = await window.sqlSentinel.checkAuth()
    if (session) onLogin(session)
  }

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default'
      }}
    >
      <Paper sx={{ p: 4, width: 380, borderRadius: 2 }} elevation={4}>
        {/* Logo */}
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
            <svg viewBox="0 0 56 56" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="ss-login-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2b8bd6" />
                  <stop offset="100%" stopColor="#005a9e" />
                </linearGradient>
              </defs>
              <g transform="translate(4,4)">
                <path d="M24 0 L48 6 V26 C48 37 38 45 24 48 C10 45 0 37 0 26 V6 Z" fill="url(#ss-login-grad)" />
                <g fill="#ffffff" transform="translate(0,10)">
                  <ellipse cx="24" cy="5" rx="11" ry="2.6" />
                  <path d="M13 5 V9 C13 10.6 18 12 24 12 C30 12 35 10.6 35 9 V5" fill="rgba(255,255,255,0.85)" />
                  <ellipse cx="24" cy="14" rx="11" ry="2.6" opacity="0.9" />
                  <path d="M13 14 V18 C13 19.6 18 21 24 21 C30 21 35 19.6 35 18 V14" fill="rgba(255,255,255,0.7)" />
                  <ellipse cx="24" cy="23" rx="11" ry="2.6" opacity="0.8" />
                  <path d="M13 23 V27 C13 28.6 18 30 24 30 C30 30 35 28.6 35 27 V23" fill="rgba(255,255,255,0.55)" />
                </g>
              </g>
            </svg>
          </Box>
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ color: tokens.color.primary, letterSpacing: '-0.01em' }}
          >
            SQL Sentinel
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sign in to continue
          </Typography>
        </Box>

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            size="small"
            fullWidth
            autoFocus
            autoComplete="username"
          />
          <PasswordField
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            size="small"
            fullWidth
            autoComplete="current-password"
          />

          {error && (
            <Alert severity="error" sx={{ py: 0 }}>
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={loading || !username || !password}
            sx={{ mt: 0.5 }}
          >
            {loading ? <CircularProgress size={20} color="inherit" /> : 'Sign in'}
          </Button>
        </Box>

        <Typography
          variant="caption"
          sx={{ display: 'block', textAlign: 'center', mt: 2.5, color: 'text.disabled' }}
        >
          SQL Sentinel — Authorized access only
        </Typography>
      </Paper>

      {pendingUserId && (
        <ChangePasswordDialog userId={pendingUserId} onDone={handlePasswordChanged} />
      )}
    </Box>
  )
}
