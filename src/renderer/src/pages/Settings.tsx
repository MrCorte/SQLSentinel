import { useState, useEffect } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Stack,
  Alert,
  CircularProgress,
  FormControlLabel,
  Switch,
  RadioGroup,
  Radio,
  TextField,
  Tooltip,
  IconButton,
  Chip
} from '@mui/material'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import SettingsIcon from '@mui/icons-material/Settings'
import DownloadIcon from '@mui/icons-material/Download'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DeleteIcon from '@mui/icons-material/Delete'
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined'
import { useWorker } from '../context/useWorker'
import { useThemeContext } from '../context/ThemeContext'
import type { ThemeMode } from '../context/ThemeContext'
import { createLogger } from '../utils/logger'

const log = createLogger('settings')

// ---------------------------------------------------------------------------
// Opzioni retention
// ---------------------------------------------------------------------------

interface RetentionOption {
  minutes: number
  label: string
  snapshots: number // at 30s interval (worst case)
}

const RETENTION_OPTIONS: RetentionOption[] = [
  { minutes: 180, label: '3 hours', snapshots: 360 },
  { minutes: 360, label: '6 hours', snapshots: 720 },
  { minutes: 720, label: '12 hours', snapshots: 1440 },
  { minutes: 1440, label: '1 day', snapshots: 2880 },
  { minutes: 4320, label: '3 days', snapshots: 8640 },
  { minutes: 10080, label: '7 days', snapshots: 20160 },
  { minutes: 43200, label: '30 days', snapshots: 86400 }
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcRetainedPoints(retentionMinutes: number, intervalSeconds: number): number {
  if (intervalSeconds <= 0) return retentionMinutes * 2 // worker disabilitato
  return Math.ceil((retentionMinutes * 60) / intervalSeconds)
}

function intervalLabel(intervalSeconds: number): string {
  if (intervalSeconds <= 0) return 'not configured'
  if (intervalSeconds < 60) return `${intervalSeconds}s`
  return `${intervalSeconds / 60} min`
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

type ExportKey = 'customFields' | 'inventory' | 'alerts'

async function runExport(key: ExportKey): Promise<void> {
  let result: { ok: boolean; data?: string; error?: string }
  let filename: string
  if (key === 'customFields') {
    result = await window.sqlSentinel.exportCustomFields()
    filename = 'sqlsentinel_custom_fields.csv'
  } else if (key === 'inventory') {
    result = await window.sqlSentinel.exportInventory()
    filename = 'sqlsentinel_inventory.csv'
  } else {
    result = await window.sqlSentinel.exportAlerts()
    filename = 'sqlsentinel_alert.csv'
  }
  if (!result.ok) throw new Error((result as { error: string }).error)
  await window.sqlSentinel.saveCsv({ filename, content: result.data! })
}

// ---------------------------------------------------------------------------
// Service Status card
// ---------------------------------------------------------------------------

function ServiceStatusCard(): React.JSX.Element {
  const [serviceStatus, setServiceStatus] = useState<string>('unknown')

  useEffect(() => {
    window.sqlSentinel.getServiceStatus().then((res) => {
      if (res.ok) setServiceStatus(res.data.status)
    })
  }, [])

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Background Service
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Status:
          </Typography>
          <Chip
            size="small"
            label={serviceStatus}
            color={
              serviceStatus === 'connected'
                ? 'success'
                : serviceStatus === 'connecting'
                  ? 'warning'
                  : 'error'
            }
          />
        </Box>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function Settings(): React.JSX.Element {
  const { themeMode, setThemeMode } = useThemeContext()
  const { retentionMinutes, setRetentionMinutes, intervalSeconds } = useWorker()
  const [exportLoading, setExportLoading] = useState<ExportKey | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [backupState, setBackupState] = useState<'idle' | 'busy'>('idle')
  const [backupFeedback, setBackupFeedback] = useState<{
    severity: 'success' | 'error' | 'info'
    message: string
  } | null>(null)

  const [bgEnabled, setBgEnabled] = useState(true)
  const [bgMode, setBgMode] = useState<'light' | 'full'>('light')
  const [bgInterval, setBgInterval] = useState(30)
  const [bgNotifications, setBgNotifications] = useState(true)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [bgLoaded, setBgLoaded] = useState(false)

  // true only in the installed exe — in dev setLoginItemSettings would register electron.exe
  const isPackaged: boolean = !import.meta.env.DEV

  useEffect(() => {
    window.sqlSentinel.getSettings().then((res) => {
      if (res.ok) {
        setBgEnabled(res.data.backgroundEnabled)
        setBgMode(res.data.backgroundMode)
        setBgInterval(res.data.backgroundIntervalMinutes)
        setBgNotifications(res.data.backgroundNotifications)
        setAutostartEnabled(res.data.autostartEnabled)
        setBgLoaded(true)
      }
    })
  }, [])

  const saveBgSettings = (
    patch: Partial<{
      backgroundEnabled: boolean
      backgroundMode: 'light' | 'full'
      backgroundIntervalMinutes: number
      backgroundNotifications: boolean
      autostartEnabled: boolean
    }>
  ) => {
    window.sqlSentinel.saveSettings(patch).catch((err: unknown) => {
      log.error('saveBgSettings failed:', err)
    })
  }

  // --- Email settings state ---
  const [emailLoaded, setEmailLoaded] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(587)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpTls, setSmtpTls] = useState(true)
  const [emailRecipients, setEmailRecipients] = useState<string[]>([])
  const [recipientInput, setRecipientInput] = useState('')
  const [recipientError, setRecipientError] = useState('')
  const [testEmailStatus, setTestEmailStatus] = useState<'idle' | 'sending' | 'success' | 'error'>(
    'idle'
  )
  const [testEmailError, setTestEmailError] = useState('')

  useEffect(() => {
    window.sqlSentinel.getEmailSettings().then((res) => {
      if (res.ok) {
        setEmailEnabled(res.data.emailEnabled)
        setSmtpHost(res.data.smtpHost)
        setSmtpPort(res.data.smtpPort)
        setSmtpUser(res.data.smtpUser)
        setSmtpPassword(res.data.smtpPassword)
        setSmtpTls(res.data.smtpTls)
        setEmailRecipients(res.data.emailRecipients)
        setEmailLoaded(true)
      }
    })
  }, [])

  const saveEmail = (patch: Parameters<typeof window.sqlSentinel.saveEmailSettings>[0]) => {
    window.sqlSentinel.saveEmailSettings(patch).catch((err: unknown) => {
      log.error('saveEmailSettings failed:', err)
    })
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  const addRecipient = () => {
    const email = recipientInput.trim()
    if (!EMAIL_REGEX.test(email)) {
      setRecipientError('Invalid email')
      return
    }
    if (emailRecipients.includes(email)) {
      setRecipientError('Email already added')
      return
    }
    if (emailRecipients.length >= 20) {
      setRecipientError('Maximum 20 recipients')
      return
    }
    const next = [...emailRecipients, email]
    setEmailRecipients(next)
    setRecipientInput('')
    setRecipientError('')
    saveEmail({ emailRecipients: next })
  }

  const removeRecipient = (email: string) => {
    const next = emailRecipients.filter((r) => r !== email)
    setEmailRecipients(next)
    saveEmail({ emailRecipients: next })
  }

  const handleTestEmail = async () => {
    setTestEmailStatus('sending')
    setTestEmailError('')
    const result = await window.sqlSentinel.sendTestEmail()
    if (result.ok) {
      setTestEmailStatus('success')
    } else {
      setTestEmailStatus('error')
      setTestEmailError(result.error)
    }
  }

  function handleRetentionChange(minutes: number): void {
    setRetentionMinutes(minutes)
    window.sqlSentinel.saveSettings({ retentionMinutes: minutes })
  }

  async function handleExport(key: ExportKey): Promise<void> {
    setExportLoading(key)
    setExportError(null)
    try {
      await runExport(key)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExportLoading(null)
    }
  }

  async function handleExportBackup(): Promise<void> {
    setBackupState('busy')
    setBackupFeedback(null)
    try {
      const result = await window.sqlSentinel.servers.exportBackup()
      if (!result.ok) {
        setBackupFeedback({ severity: 'error', message: result.error })
      } else if (result.data.saved) {
        setBackupFeedback({ severity: 'success', message: 'Backup saved successfully.' })
      }
    } catch (err) {
      setBackupFeedback({ severity: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBackupState('idle')
    }
  }

  async function handleImportBackup(): Promise<void> {
    setBackupState('busy')
    setBackupFeedback(null)
    try {
      const result = await window.sqlSentinel.servers.importBackup()
      if (!result.ok) {
        setBackupFeedback({ severity: 'error', message: result.error })
      } else {
        const { imported, skipped, errors } = result.data
        if (errors.length > 0) {
          setBackupFeedback({ severity: 'error', message: `Import completed with errors: ${errors.join('; ')}` })
        } else if (imported === 0 && skipped === 0) {
          setBackupFeedback({ severity: 'info', message: 'No file selected.' })
        } else {
          setBackupFeedback({
            severity: 'success',
            message: `Imported ${imported} server${imported !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} already present` : ''}.`
          })
        }
      }
    } catch (err) {
      setBackupFeedback({ severity: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBackupState('idle')
    }
  }

  const retainedPoints = calcRetainedPoints(retentionMinutes, intervalSeconds)
  const interval = intervalLabel(intervalSeconds)

  return (
    <Box sx={{ p: 3, maxWidth: 720, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <SettingsIcon color="action" />
        <Typography variant="h5" fontWeight={700}>
          Settings
        </Typography>
      </Box>

      {/* ---- Aspetto ---- */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Appearance
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Choose the application theme
          </Typography>
          <ToggleButtonGroup
            value={themeMode}
            exclusive
            onChange={(_e, value: ThemeMode | null) => {
              if (value != null) void setThemeMode(value)
            }}
            size="small"
          >
            <ToggleButton value="light" aria-label="light theme">
              <WbSunnyOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />
              Light
            </ToggleButton>
            <ToggleButton value="dark" aria-label="dark theme">
              <DarkModeOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />
              Dark
            </ToggleButton>
            <ToggleButton value="system" aria-label="system theme">
              <DesktopWindowsOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />
              System
            </ToggleButton>
          </ToggleButtonGroup>
        </CardContent>
      </Card>

      {/* Card — Retention dati storici */}
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              Historical data retention
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Defines how long the data collected by the worker is kept in memory for each monitored
              server.
            </Typography>
          </Box>

          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel>Retention period</InputLabel>
            <Select
              label="Retention period"
              value={retentionMinutes}
              onChange={(e) => handleRetentionChange(e.target.value as number)}
            >
              {RETENTION_OPTIONS.map((opt) => (
                <MenuItem key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography variant="body2" color="text.secondary">
            {intervalSeconds > 0 ? (
              <>
                You are collecting metrics every <strong>{interval}</strong> → with this retention
                you keep approximately <strong>{retainedPoints}</strong> points per server.
              </>
            ) : (
              <>
                Auto-refresh <strong>not configured</strong> → with this retention you will keep
                approximately <strong>{retainedPoints}</strong> points per server (calculated at 30
                s interval).
              </>
            )}
          </Typography>
        </CardContent>
      </Card>

      {/* Card — Export dati */}
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              Data export
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Export data in CSV format. The file is saved to the chosen location.
            </Typography>
          </Box>

          {exportError && (
            <Alert severity="error" onClose={() => setExportError(null)}>
              {exportError}
            </Alert>
          )}

          <Stack spacing={1.5}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={
                  exportLoading === 'customFields' ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <DownloadIcon />
                  )
                }
                disabled={exportLoading !== null}
                onClick={() => handleExport('customFields')}
                sx={{ minWidth: 220 }}
              >
                Custom database fields
              </Button>
              <Typography variant="body2" color="text.secondary">
                Alias, owner and decommissioned status for all configured DBs
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={
                  exportLoading === 'inventory' ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <DownloadIcon />
                  )
                }
                disabled={exportLoading !== null}
                onClick={() => handleExport('inventory')}
                sx={{ minWidth: 220 }}
              >
                Server inventory
              </Button>
              <Typography variant="body2" color="text.secondary">
                Complete list of monitored servers with connection details
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={
                  exportLoading === 'alerts' ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <DownloadIcon />
                  )
                }
                disabled={exportLoading !== null}
                onClick={() => handleExport('alerts')}
                sx={{ minWidth: 220 }}
              >
                Historical alerts
              </Button>
              <Typography variant="body2" color="text.secondary">
                All detected alerts, with category, severity and date
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Card — Server configuration backup */}
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              Server configuration backup
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Export and import the list of monitored servers. Passwords are not included in backups.
              An automatic backup is also written next to the configuration file after every change.
            </Typography>
          </Box>

          {backupFeedback && (
            <Alert severity={backupFeedback.severity} onClose={() => setBackupFeedback(null)}>
              {backupFeedback.message}
            </Alert>
          )}

          <Stack direction="row" spacing={2}>
            <Button
              variant="outlined"
              size="small"
              startIcon={
                backupState === 'busy' ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <DownloadIcon />
                )
              }
              disabled={backupState === 'busy'}
              onClick={handleExportBackup}
            >
              Export backup
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={
                backupState === 'busy' ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <UploadFileIcon />
                )
              }
              disabled={backupState === 'busy'}
              onClick={handleImportBackup}
            >
              Import backup
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Card — Background & Tray */}
      {bgLoaded && (
        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Background & Tray
              </Typography>
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={bgEnabled}
                  onChange={(e) => {
                    setBgEnabled(e.target.checked)
                    saveBgSettings({ backgroundEnabled: e.target.checked })
                  }}
                />
              }
              label="Keep active in background on close"
            />
            <Box
              sx={{
                ml: 2,
                opacity: bgEnabled ? 1 : 0.4,
                pointerEvents: bgEnabled ? 'auto' : 'none'
              }}
            >
              <Typography variant="body2" sx={{ mb: 1 }}>
                Background polling mode
              </Typography>
              <RadioGroup
                value={bgMode}
                onChange={(e) => {
                  const v = e.target.value as 'light' | 'full'
                  setBgMode(v)
                  saveBgSettings({ backgroundMode: v })
                }}
              >
                <FormControlLabel
                  value="light"
                  control={<Radio />}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>Light — intervallo:</span>
                      <TextField
                        type="number"
                        size="small"
                        value={bgInterval}
                        disabled={bgMode !== 'light'}
                        inputProps={{ min: 1, max: 240 }}
                        sx={{ width: 80 }}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(240, Number(e.target.value)))
                          setBgInterval(v)
                          saveBgSettings({ backgroundIntervalMinutes: v })
                        }}
                      />
                      <span>min</span>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="full"
                  control={<Radio />}
                  label="Full — same interval as foreground"
                />
              </RadioGroup>
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={bgNotifications}
                  onChange={(e) => {
                    setBgNotifications(e.target.checked)
                    saveBgSettings({ backgroundNotifications: e.target.checked })
                  }}
                />
              }
              label="System notifications for critical alerts"
            />
            <Tooltip
              title={!isPackaged ? 'Available only in the installed version (.exe)' : ''}
              placement="right"
            >
              <span>
                <FormControlLabel
                  control={
                    <Switch
                      checked={autostartEnabled}
                      disabled={!isPackaged}
                      onChange={(e) => {
                        setAutostartEnabled(e.target.checked)
                        saveBgSettings({ autostartEnabled: e.target.checked })
                      }}
                    />
                  }
                  label="Start with Windows"
                />
              </span>
            </Tooltip>
          </CardContent>
        </Card>
      )}

      {/* Card — Service Status */}
      <ServiceStatusCard />

      {/* Card — Notifiche Email */}
      {emailLoaded && (
        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Email Notifications
              </Typography>
            </Box>

            <FormControlLabel
              control={
                <Switch
                  checked={emailEnabled}
                  onChange={(e) => {
                    setEmailEnabled(e.target.checked)
                    saveEmail({ emailEnabled: e.target.checked })
                  }}
                />
              }
              label="Enable email notifications"
            />

            <Box
              sx={{
                ml: 2,
                opacity: emailEnabled ? 1 : 0.4,
                pointerEvents: emailEnabled ? 'auto' : 'none'
              }}
            >
              <Stack spacing={2}>
                <TextField
                  label="SMTP Host"
                  size="small"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  onBlur={() => saveEmail({ smtpHost })}
                  placeholder="smtp.office365.com"
                />
                <Stack direction="row" spacing={2} alignItems="center">
                  <TextField
                    label="SMTP Port"
                    size="small"
                    type="number"
                    value={smtpPort}
                    inputProps={{ min: 1, max: 65535 }}
                    sx={{ width: 120 }}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    onBlur={() => saveEmail({ smtpPort })}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={smtpTls}
                        onChange={(e) => {
                          setSmtpTls(e.target.checked)
                          saveEmail({ smtpTls: e.target.checked })
                        }}
                      />
                    }
                    label="TLS/STARTTLS"
                  />
                </Stack>
                <TextField
                  label="SMTP User (sender)"
                  size="small"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  onBlur={() => saveEmail({ smtpUser })}
                  placeholder="alerts@company.com"
                />
                <TextField
                  label="SMTP Password"
                  size="small"
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  onBlur={() => saveEmail({ smtpPassword })}
                />

                {/* Recipient list */}
                <Box>
                  <Typography variant="body2" gutterBottom>
                    Recipients ({emailRecipients.length}/20)
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                    <TextField
                      size="small"
                      placeholder="recipient@company.com"
                      value={recipientInput}
                      onChange={(e) => {
                        setRecipientInput(e.target.value)
                        setRecipientError('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addRecipient()
                        }
                      }}
                      error={!!recipientError}
                      helperText={recipientError}
                      sx={{ flexGrow: 1 }}
                    />
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={addRecipient}
                      disabled={emailRecipients.length >= 20}
                    >
                      Add
                    </Button>
                  </Stack>
                  <Stack spacing={0.5}>
                    {emailRecipients.map((email) => (
                      <Stack key={email} direction="row" alignItems="center" spacing={1}>
                        <Typography variant="body2" sx={{ flexGrow: 1 }}>
                          {email}
                        </Typography>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => removeRecipient(email)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ))}
                  </Stack>
                </Box>

                {/* Test email */}
                <Box>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleTestEmail}
                    disabled={
                      testEmailStatus === 'sending' || !smtpHost || emailRecipients.length === 0
                    }
                  >
                    {testEmailStatus === 'sending' ? 'Sending…' : 'Send test email'}
                  </Button>
                  {testEmailStatus === 'success' && (
                    <Alert severity="success" sx={{ mt: 1 }}>
                      Test email sent successfully
                    </Alert>
                  )}
                  {testEmailStatus === 'error' && (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      Send error: {testEmailError}
                    </Alert>
                  )}
                </Box>
              </Stack>
            </Box>
          </CardContent>
        </Card>
      )}

      <Typography
        variant="caption"
        sx={{ display: 'block', textAlign: 'center', mt: 4, mb: 1, color: 'text.disabled' }}
      >
        Made with ❤️ in Italy 🇮🇹
        <br />
        ac
      </Typography>
    </Box>
  )
}
