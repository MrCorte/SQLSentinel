import { useState, useMemo, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  Chip,
  Divider
} from '@mui/material'
import StorageIcon from '@mui/icons-material/Storage'
import { AddServerDialog } from './AddServerDialog'
import type { AddServerFormData } from './AddServerDialog'
import { useAgStore } from '../store/agStore'
import { useServersStore } from '../store/serversStore'
import { useGroupsStore } from '../store/groupsStore'
import { tokens } from '../styles/tokens'

function parseReplicaName(name: string): { host: string; instance: string } {
  const [host, instance = ''] = name.split('\\')
  return { host, instance }
}

export function AgReplicaSuggestionDialog(): React.JSX.Element | null {
  const suggestions = useAgStore((s) => s.pendingAgSuggestions)
  const clearAgSuggestion = useAgStore((s) => s.clearAgSuggestion)
  const addServer = useServersStore((s) => s.addServer)
  const setServerAlias = useGroupsStore((s) => s.setServerAlias)

  const [addedNames, setAddedNames] = useState<Set<string>>(new Set())
  const [addTarget, setAddTarget] = useState<string | null>(null)

  const current = suggestions[0]

  // Reset local tracking when the displayed suggestion changes
  useEffect(() => {
    setAddedNames(new Set())
  }, [current?.agName])

  const visibleReplicas = useMemo(
    () => current?.missingReplicas.filter((r) => !addedNames.has(r.replica_server_name)) ?? [],
    [current, addedNames]
  )

  // Auto-clear when the user has added all missing replicas
  useEffect(() => {
    if (current && addedNames.size > 0 && visibleReplicas.length === 0) {
      clearAgSuggestion(current.agName)
    }
  }, [visibleReplicas.length, current?.agName, addedNames.size, clearAgSuggestion])

  if (!current || visibleReplicas.length === 0) return null

  const handleAddSave = async (data: AddServerFormData): Promise<void> => {
    const result = await addServer({
      host: data.ip,
      port: data.port,
      instanceName: data.instanceName || undefined,
      machineName: data.machineName || undefined,
      useWindowsAuth: data.useWindowsAuth,
      username: data.username || undefined,
      password: data.password || undefined,
      hostingType: data.hostingType,
      agRole: data.agRole,
      agName: data.agName,
      agGroupId: data.agGroupId
    })
    if (data.alias?.trim() && result?.server) {
      setServerAlias(result.server.id, data.alias.trim())
    }
    if (addTarget) {
      setAddedNames((prev) => new Set([...prev, addTarget]))
    }
    setAddTarget(null)
  }

  const parsed = addTarget ? parseReplicaName(addTarget) : null

  return (
    <>
      <Dialog open maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6" component="span">
              AG replica detected
            </Typography>
            <Chip
              label={current.agName}
              size="small"
              sx={{ fontWeight: tokens.font.weightSemibold }}
            />
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This server is part of the Availability Group <strong>{current.agName}</strong>. The
            following replicas are not yet monitored:
          </Typography>
          <Stack divider={<Divider />}>
            {visibleReplicas.map((r) => (
              <Stack
                key={r.replica_server_name}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ py: 1 }}
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  <StorageIcon fontSize="small" sx={{ color: tokens.color.textMuted }} />
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {r.replica_server_name}
                  </Typography>
                  <Chip
                    label={r.role_desc}
                    size="small"
                    color={r.role_desc === 'PRIMARY' ? 'primary' : 'default'}
                    variant="outlined"
                    sx={{ fontSize: tokens.font.sizeXs }}
                  />
                </Stack>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => setAddTarget(r.replica_server_name)}
                >
                  Add
                </Button>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => clearAgSuggestion(current.agName)}>Ignore</Button>
        </DialogActions>
      </Dialog>

      {addTarget && parsed && (
        <AddServerDialog
          open
          initialIp={parsed.host}
          initialInstanceName={parsed.instance || undefined}
          initialUseWindowsAuth={current.sourceCredentials.useWindowsAuth}
          initialUsername={current.sourceCredentials.username}
          initialPassword={current.sourceCredentials.password}
          onClose={() => setAddTarget(null)}
          onSave={handleAddSave}
        />
      )}
    </>
  )
}
