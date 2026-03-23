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
  TextField
} from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import DownloadIcon from '@mui/icons-material/Download'
import { useWorker } from '../context/useWorker'

// ---------------------------------------------------------------------------
// Opzioni retention
// ---------------------------------------------------------------------------

interface RetentionOption {
  minutes: number
  label: string
  snapshots: number // a 30s di intervallo (worst case)
}

const RETENTION_OPTIONS: RetentionOption[] = [
  { minutes: 15, label: '15 minuti', snapshots: 30 },
  { minutes: 30, label: '30 minuti', snapshots: 60 },
  { minutes: 60, label: '1 ora', snapshots: 120 },
  { minutes: 180, label: '3 ore', snapshots: 360 },
  { minutes: 360, label: '6 ore', snapshots: 720 },
  { minutes: 720, label: '12 ore', snapshots: 1440 }
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcRetainedPoints(retentionMinutes: number, intervalSeconds: number): number {
  if (intervalSeconds <= 0) return retentionMinutes * 2 // worker disabilitato
  return Math.ceil((retentionMinutes * 60) / intervalSeconds)
}

function intervalLabel(intervalSeconds: number): string {
  if (intervalSeconds <= 0) return 'non configurato'
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
    filename = 'sqlsentinel_campi_custom.csv'
  } else if (key === 'inventory') {
    result = await window.sqlSentinel.exportInventory()
    filename = 'sqlsentinel_inventario.csv'
  } else {
    result = await window.sqlSentinel.exportAlerts()
    filename = 'sqlsentinel_alert.csv'
  }
  if (!result.ok) throw new Error((result as { error: string }).error)
  await window.sqlSentinel.saveCsv({ filename, content: result.data! })
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function Settings(): React.JSX.Element {
  const { retentionMinutes, setRetentionMinutes, intervalSeconds } = useWorker()
  const [exportLoading, setExportLoading] = useState<ExportKey | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [bgEnabled, setBgEnabled] = useState(true)
  const [bgMode, setBgMode] = useState<'light' | 'full'>('light')
  const [bgInterval, setBgInterval] = useState(30)
  const [bgNotifications, setBgNotifications] = useState(true)
  const [bgLoaded, setBgLoaded] = useState(false)

  useEffect(() => {
    window.sqlSentinel.getSettings().then((res) => {
      if (res.ok) {
        setBgEnabled(res.data.backgroundEnabled)
        setBgMode(res.data.backgroundMode)
        setBgInterval(res.data.backgroundIntervalMinutes)
        setBgNotifications(res.data.backgroundNotifications)
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
    }>
  ) => {
    window.sqlSentinel.saveSettings(patch).catch((err: unknown) => {
      console.error('[Settings] saveBgSettings failed:', err)
    })
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

  const retainedPoints = calcRetainedPoints(retentionMinutes, intervalSeconds)
  const interval = intervalLabel(intervalSeconds)

  return (
    <Box sx={{ p: 3, maxWidth: 720, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <SettingsIcon color="action" />
        <Typography variant="h5" fontWeight={700}>
          Impostazioni
        </Typography>
      </Box>

      {/* Card — Retention dati storici */}
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              Retention dati storici
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Definisce per quanto tempo vengono mantenuti in memoria i dati raccolti dal worker
              per ogni server monitorato.
            </Typography>
          </Box>

          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel>Periodo di retention</InputLabel>
            <Select
              label="Periodo di retention"
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
                Stai raccogliendo metriche ogni <strong>{interval}</strong> → con questa retention
                conservi circa <strong>{retainedPoints}</strong> punti per server.
              </>
            ) : (
              <>
                Auto-refresh <strong>non configurato</strong> → con questa retention conserverai
                circa <strong>{retainedPoints}</strong> punti per server (calcolato a 30 s di
                intervallo).
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
              Export dati
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Esporta i dati in formato CSV. Il file viene salvato nella posizione scelta.
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
                Campi custom database
              </Button>
              <Typography variant="body2" color="text.secondary">
                Alias, referente e stato dismesso per tutti i DB configurati
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
                Inventario server
              </Button>
              <Typography variant="body2" color="text.secondary">
                Lista completa dei server monitorati con dettagli di connessione
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
                Alert storici
              </Button>
              <Typography variant="body2" color="text.secondary">
                Tutti gli alert rilevati, con categoria, severità e data
              </Typography>
            </Box>
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
              label="Mantieni attivo in background alla chiusura"
            />
            <Box
              sx={{
                ml: 2,
                opacity: bgEnabled ? 1 : 0.4,
                pointerEvents: bgEnabled ? 'auto' : 'none',
              }}
            >
              <Typography variant="body2" sx={{ mb: 1 }}>
                Modalità polling background
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
                  label="Full — stesso intervallo del foreground"
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
              label="Notifiche sistema per alert critici"
            />
          </CardContent>
        </Card>
      )}
    </Box>
  )
}
