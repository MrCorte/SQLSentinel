import { useState, useEffect } from 'react'
import { Box, Typography, TextField, CircularProgress } from '@mui/material'
import { useServersStore } from '../store/serversStore'

interface NoteEditorProps {
  serverId: string
  initialNote: string
}

export function NoteEditor({ serverId, initialNote }: NoteEditorProps): React.JSX.Element {
  const [note, setNote] = useState(initialNote)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const updateServer = useServersStore((s) => s.updateServer)

  // Sync if the server's note changes from outside (e.g. store refresh)
  useEffect(() => {
    setNote(initialNote)
  }, [initialNote])

  // Autosave with 1s debounce
  useEffect(() => {
    if (note === initialNote) return
    setSaved(false)
    const timer = setTimeout(async () => {
      setSaving(true)
      await updateServer(serverId, { notes: note })
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }, 1000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
        >
          Note
        </Typography>
        {saving && <CircularProgress size={11} />}
        {saved && (
          <Typography variant="caption" sx={{ color: 'success.main' }}>
            Salvato
          </Typography>
        )}
      </Box>
      <TextField
        multiline
        fullWidth
        minRows={2}
        maxRows={6}
        placeholder="Aggiungi note sul server… (es. 'In manutenzione venerdì sera', 'Usato da SAP')"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        inputProps={{ maxLength: 1000 }}
        size="small"
        sx={{
          '& .MuiInputBase-root': {
            fontSize: '0.8125rem'
          }
        }}
      />
      <Typography variant="caption" sx={{ color: 'text.disabled', float: 'right', mt: 0.25 }}>
        {note.length}/1000
      </Typography>
    </Box>
  )
}
