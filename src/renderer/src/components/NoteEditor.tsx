import { useState, useEffect } from 'react'
import { Box, Typography, TextField, CircularProgress } from '@mui/material'
import { useServersStore } from '../store/serversStore'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

interface NoteEditorProps {
  serverId: string
  initialNote: string
}

export function NoteEditor({ serverId, initialNote }: NoteEditorProps): React.JSX.Element {
  const [note, setNote] = useState(initialNote)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const updateServer = useServersStore((s) => s.updateServer)

  // Reset note whenever the active server changes (serverId is the key discriminator)
  useEffect(() => {
    setNote(initialNote)
    setSaved(false)
  }, [serverId, initialNote])

  // Autosave with 1s debounce — serverId in deps guards against saves to the wrong server
  const debouncedNote = useDebouncedValue(note, 1000)
  useEffect(() => {
    if (debouncedNote === initialNote) return
    setSaved(false)
    ;(async () => {
      setSaving(true)
      await updateServer(serverId, { notes: debouncedNote })
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })()
  }, [debouncedNote, serverId, initialNote, updateServer])

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
