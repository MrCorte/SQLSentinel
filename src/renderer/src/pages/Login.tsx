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
