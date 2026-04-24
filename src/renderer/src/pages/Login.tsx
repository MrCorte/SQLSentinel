import { useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import type { AuthSession } from '../../../preload/index'
import { tokens } from '../styles/tokens'

// ---------------------------------------------------------------------------
// ChangePasswordDialog — shown when must_change_password === 1
// ---------------------------------------------------------------------------

interface ChangePasswordDialogProps {
  userId: string
  onDone: () => void
}

function ChangePasswordDialog({ userId, onDone }: ChangePasswordDialogProps): React.JSX.Element {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    if (newPwd !== confirm) {
      setError('Le password non coincidono')
      return
    }
    setLoading(true)
    const result = await window.sqlSentinel.changePassword(userId, oldPwd, newPwd)
    setLoading(false)
    if (!result.success) {
      setError(result.error ?? 'Errore durante il cambio password')
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
          <TextField
            label="Current password"
            type="password"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            size="small"
            fullWidth
            autoFocus
          />
          <TextField
            label="New password"
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            size="small"
            fullWidth
            helperText="Minimum 8 characters, at least 1 uppercase and 1 number"
          />
          <TextField
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            size="small"
            fullWidth
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          type="submit"
          form="change-pwd-form"
          variant="contained"
          disabled={loading || !oldPwd || !newPwd || !confirm}
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
  const [showPassword, setShowPassword] = useState(false)
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
      setError(result.error ?? 'Credenziali non valide')
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
            Accedi per continuare
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
          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            size="small"
            fullWidth
            autoComplete="current-password"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setShowPassword((v) => !v)}
                    edge="end"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <VisibilityOffIcon fontSize="small" />
                    ) : (
                      <VisibilityIcon fontSize="small" />
                    )}
                  </IconButton>
                </InputAdornment>
              )
            }}
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
            {loading ? <CircularProgress size={20} color="inherit" /> : 'Accedi'}
          </Button>
        </Box>

        <Typography
          variant="caption"
          sx={{ display: 'block', textAlign: 'center', mt: 2.5, color: 'text.disabled' }}
        >
          SQL Sentinel — Accesso riservato
        </Typography>
      </Paper>

      {pendingUserId && (
        <ChangePasswordDialog userId={pendingUserId} onDone={handlePasswordChanged} />
      )}
    </Box>
  )
}
