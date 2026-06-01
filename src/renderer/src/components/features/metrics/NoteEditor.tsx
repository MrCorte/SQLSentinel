import { useState, useEffect } from 'react'
import { Box, Typography, TextField, CircularProgress } from '@mui/material'
import { useServersStore } from '../store/serversStore'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { tokens } from '../styles/tokens'

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

  // Autosave with 500ms debounce — serverId in deps guards against saves to the wrong server
  const debouncedNote = useDebouncedValue(note, 500)
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
          sx={{
            color: tokens.color.textMuted,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}
        >
          Note
        </Typography>
        {saving && <CircularProgress size={11} />}
        {saved && (
          <Typography variant="caption" sx={{ color: 'success.main' }}>
            Saved
          </Typography>
        )}
      </Box>
      <TextField
        multiline
        fullWidth
        minRows={2}
        maxRows={6}
        placeholder="Add server notes… (e.g. 'Under maintenance Friday evening', 'Used by SAP')"
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
