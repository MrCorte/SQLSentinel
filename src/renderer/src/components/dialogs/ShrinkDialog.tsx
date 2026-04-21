import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Stack,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  TextField,
  Select,
  MenuItem,
  InputLabel,
  CircularProgress,
  Divider
} from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import type { DatabaseFile, ShrinkEstimate, ShrinkResult, CollectMetricsRequest } from '../../../../preload/index'
import { tokens } from '../../styles/tokens'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShrinkMode = 'database' | 'file' | 'log'

interface Props {
  open: boolean
  onClose: () => void
  dbName: string
  files: DatabaseFile[]
  connection: CollectMetricsRequest
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

// ---------------------------------------------------------------------------
// ShrinkDialog
// ---------------------------------------------------------------------------

export function ShrinkDialog({ open, onClose, dbName, files, connection }: Props): React.JSX.Element {
  const [mode, setMode] = useState<ShrinkMode>('database')
  const [targetPercent, setTargetPercent] = useState(10)
  const [selectedFile, setSelectedFile] = useState('')
  const [targetSizeMb, setTargetSizeMb] = useState(0)
  const [estimates, setEstimates] = useState<ShrinkEstimate[]>([])
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ShrinkResult | null>(null)
  const [resultError, setResultError] = useState<string | null>(null)

  const dataFiles = files.filter((f) => f.type_desc === 'ROWS')
  const logFiles = files.filter((f) => f.type_desc === 'LOG')

  // Auto-select first file when mode changes
  useEffect(() => {
    if (mode === 'file' && dataFiles.length > 0) {
      const first = dataFiles[0]
      setSelectedFile(first.file_name)
      setTargetSizeMb(first.used_mb)
    }
    if (mode === 'log' && logFiles.length > 0) {
      const first = logFiles[0]
      setSelectedFile(first.file_name)
      setTargetSizeMb(first.used_mb)
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load estimate when dialog opens
  useEffect(() => {
    if (!open) {
      setResult(null)
      setResultError(null)
      setMode('database')
      return
    }
    if (!window.sqlSentinel?.db?.shrinkEstimate) {
      console.warn('[ShrinkDialog] sqlSentinel.db non disponibile')
      return
    }
    setEstimateLoading(true)
    window.sqlSentinel.db
      .shrinkEstimate({ connection, dbName })
      .then((res) => {
        if (res.ok) setEstimates(res.data)
      })
      .finally(() => setEstimateLoading(false))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileSelect = (fileName: string): void => {
    setSelectedFile(fileName)
    const f = files.find((x) => x.file_name === fileName)
    if (f) setTargetSizeMb(f.used_mb)
  }

  const handleExecute = async (): Promise<void> => {
    setRunning(true)
    setResult(null)
    setResultError(null)
    try {
      let res
      if (mode === 'database') {
        res = await window.sqlSentinel.db.shrink({ connection, dbName, targetPercent })
      } else {
        const isLog = mode === 'log'
        res = await window.sqlSentinel.db.shrinkFile({
          connection,
          dbName,
          fileName: selectedFile,
          targetSizeMb,
          isLog
        })
      }
      if (res.ok) {
        setResult(res.data)
        if (!res.data.success) setResultError(res.data.error ?? 'Operation failed')
      } else {
        setResultError(res.error)
      }
    } finally {
      setRunning(false)
    }
  }

  // Totals for estimate banner
  const totalReclaimable = estimates.reduce((sum, e) => sum + e.reclaimable_mb, 0)

  return (
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600, pb: 1 }}>
        Shrink: {dbName}
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {/* Warning banner */}
        <Box
          sx={{
            bgcolor: '#fff4ce',
            border: '1px solid #ffb900',
            borderRadius: 1,
            px: 2,
            py: 1.25,
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start'
          }}
        >
          <WarningAmberIcon sx={{ fontSize: 16, color: '#7a4f00', mt: 0.25, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12, color: '#7a4f00', lineHeight: 1.5 }}>
            Shrink fragments indexes. Plan an{' '}
            <strong>index REBUILD</strong> after this operation.
          </Typography>
        </Box>

        {/* Estimate */}
        <Box
          sx={{
            bgcolor: tokens.color.bgApp,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: 1,
            px: 2,
            py: 1.25
          }}
        >
          <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: tokens.color.textSecondary, mb: 1 }}>
            Reclaimable space estimate
          </Typography>
          {estimateLoading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={12} />
              <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>Calculating...</Typography>
            </Stack>
          ) : estimates.length === 0 ? (
            <Typography variant="caption" sx={{ color: tokens.color.textSecondary }}>No data available</Typography>
          ) : (
            <Stack spacing={0.5}>
              {estimates.map((e) => (
                <Stack key={e.file_name} direction="row" justifyContent="space-between">
                  <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: tokens.color.textPrimary }}>
                    {e.file_name}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: tokens.color.textSecondary }}>
                    {e.used_mb}/{e.current_mb} MB{' '}
                    <strong style={{ color: e.reclaimable_mb > 0 ? tokens.color.success : tokens.color.textSecondary }}>
                      → {e.reclaimable_mb} MB reclaimable
                    </strong>
                  </Typography>
                </Stack>
              ))}
              {totalReclaimable > 0 && (
                <>
                  <Divider sx={{ my: 0.5 }} />
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: tokens.color.textPrimary, textAlign: 'right' }}>
                    Total: {totalReclaimable} MB
                  </Typography>
                </>
              )}
            </Stack>
          )}
        </Box>

        {/* Mode selector */}
        <FormControl>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: tokens.color.textPrimary, mb: 0.5 }}>
            Mode
          </Typography>
          <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as ShrinkMode)}>
            {/* Database mode */}
            <FormControlLabel
              value="database"
              control={<Radio size="small" />}
              label={<Typography sx={{ fontSize: 13 }}>Shrink Database (tutti i file)</Typography>}
            />
            {mode === 'database' && (
              <Box sx={{ ml: 4, mb: 1 }}>
                <TextField
                  label="Target free space (%)"
                  type="number"
                  size="small"
                  value={targetPercent}
                  onChange={(e) => setTargetPercent(Math.max(0, Math.min(99, Number(e.target.value))))}
                  inputProps={{ min: 0, max: 99 }}
                  sx={{ width: 200 }}
                />
              </Box>
            )}

            {/* File mode */}
            <FormControlLabel
              value="file"
              control={<Radio size="small" />}
              label={<Typography sx={{ fontSize: 13 }}>Shrink specific file</Typography>}
              disabled={dataFiles.length === 0}
            />
            {mode === 'file' && (
              <Stack direction="row" spacing={1.5} sx={{ ml: 4, mb: 1 }}>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>File</InputLabel>
                  <Select
                    label="File"
                    value={selectedFile}
                    onChange={(e) => handleFileSelect(e.target.value)}
                  >
                    {dataFiles.map((f) => (
                      <MenuItem key={f.file_name} value={f.file_name}>
                        {f.file_name} ({f.size_mb} MB)
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Target size (MB)"
                  type="number"
                  size="small"
                  value={targetSizeMb}
                  onChange={(e) => setTargetSizeMb(Math.max(0, Number(e.target.value)))}
                  inputProps={{ min: 0 }}
                  sx={{ width: 140 }}
                />
              </Stack>
            )}

            {/* Log mode */}
            <FormControlLabel
              value="log"
              control={<Radio size="small" />}
              label={
                <Typography sx={{ fontSize: 13 }}>
                  Log only{' '}
                  <Typography component="span" sx={{ fontSize: 11, color: tokens.color.textSecondary }}>
                    (includes BACKUP LOG TO NUL if recovery is FULL)
                  </Typography>
                </Typography>
              }
              disabled={logFiles.length === 0}
            />
            {mode === 'log' && (
              <Stack direction="row" spacing={1.5} sx={{ ml: 4, mb: 1 }}>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>File log</InputLabel>
                  <Select
                    label="File log"
                    value={selectedFile}
                    onChange={(e) => handleFileSelect(e.target.value)}
                  >
                    {logFiles.map((f) => (
                      <MenuItem key={f.file_name} value={f.file_name}>
                        {f.file_name} ({f.size_mb} MB)
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Target size (MB)"
                  type="number"
                  size="small"
                  value={targetSizeMb}
                  onChange={(e) => setTargetSizeMb(Math.max(0, Number(e.target.value)))}
                  inputProps={{ min: 0 }}
                  sx={{ width: 140 }}
                />
              </Stack>
            )}
          </RadioGroup>
        </FormControl>

        {/* Running indicator */}
        {running && (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={18} />
            <Typography sx={{ fontSize: 13, color: tokens.color.textSecondary }}>
              Shrink in progress... (may take several minutes)
            </Typography>
          </Stack>
        )}

        {/* Result */}
        {result && result.success && !running && (
          <Box
            sx={{
              bgcolor: '#dff6dd',
              border: '1px solid #107c10',
              borderRadius: 1,
              px: 2,
              py: 1.25
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <CheckCircleOutlineIcon sx={{ fontSize: 16, color: '#107c10' }} />
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#107c10' }}>
                Shrink completed in {formatDuration(result.duration_ms)}
              </Typography>
            </Stack>
            {result.reclaimedMb !== undefined && result.reclaimedMb > 0 && (
              <Typography sx={{ fontSize: 12, color: '#107c10', ml: 3 }}>
                Space reclaimed: <strong>{result.reclaimedMb} MB</strong>
              </Typography>
            )}
            <Typography sx={{ fontSize: 11, color: '#107c10', ml: 3, mt: 0.5, fontStyle: 'italic' }}>
              Remember to run index REBUILD.
            </Typography>
          </Box>
        )}

        {resultError && !running && (
          <Box
            sx={{
              bgcolor: '#fde7e9',
              border: `1px solid ${tokens.color.error}`,
              borderRadius: 1,
              px: 2,
              py: 1.25,
              display: 'flex',
              gap: 1,
              alignItems: 'flex-start'
            }}
          >
            <ErrorOutlineIcon sx={{ fontSize: 16, color: tokens.color.error, mt: 0.25, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 12, color: tokens.color.error }}>{resultError}</Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={running} size="small">
          {result?.success ? 'Close' : 'Cancel'}
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={handleExecute}
          disabled={running || !!result?.success}
          startIcon={running ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{
            bgcolor: '#d83b01',
            '&:hover': { bgcolor: '#b5320a' },
            '&:disabled': { bgcolor: '#f4b8a0', color: '#fff' }
          }}
        >
          {running ? 'Running...' : 'Run Shrink ⚠'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
