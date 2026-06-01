import { Snackbar, Alert, AlertTitle, Stack } from '@mui/material'
import { useNotifyStore } from '../store/notifyStore'
import type { NotifyEntry } from '../store/notifyStore'

/**
 * Mounted once at the root of <App/>. Renders all queued notifications as a
 * vertical stack of MUI Snackbars at the bottom-right; each entry auto-hides
 * after its configured duration and can be dismissed manually.
 *
 * Use the `notify` helpers (notify.error, notify.success, …) from any store or
 * component instead of importing this component or the underlying Zustand store.
 */
export function GlobalSnackbar(): React.JSX.Element {
  const entries = useNotifyStore((s) => s.entries)
  const dismiss = useNotifyStore((s) => s.dismiss)

  return (
    <Stack
      spacing={1}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: (t) => t.zIndex.snackbar,
        maxWidth: 480
      }}
    >
      {entries.map((entry, index) => (
        <SnackbarItem
          key={entry.id}
          entry={entry}
          // Stack offset so older entries sit above newer ones
          offset={index}
          onDismiss={() => dismiss(entry.id)}
        />
      ))}
    </Stack>
  )
}

function SnackbarItem({
  entry,
  onDismiss
}: {
  entry: NotifyEntry
  offset: number
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <Snackbar
      open
      autoHideDuration={entry.autoHideMs ?? null}
      onClose={(_, reason) => {
        // Don't dismiss on click-away — only on explicit close or timer.
        if (reason === 'clickaway') return
        onDismiss()
      }}
      // Render inline so the parent <Stack> handles position; otherwise each
      // Snackbar would float independently and overlap.
      sx={{ position: 'static', transform: 'none' }}
    >
      <Alert
        severity={entry.severity}
        variant="filled"
        onClose={onDismiss}
        sx={{ width: '100%', boxShadow: 3 }}
      >
        {entry.title && <AlertTitle>{entry.title}</AlertTitle>}
        {entry.message}
      </Alert>
    </Snackbar>
  )
}
