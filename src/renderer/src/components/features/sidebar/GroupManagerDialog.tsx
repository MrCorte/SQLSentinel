import { useState, useRef, useEffect } from 'react'
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  List,
  ListItem,
  Divider
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DragHandleIcon from '@mui/icons-material/DragHandle'
import { useGroupsStore } from '../../../store/groupsStore'
import type { ServerGroup } from '../../../types/index'
import { tokens } from '../../../styles/tokens'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  '#a4262c',
  '#d83b01',
  '#107c10',
  '#0078d4',
  '#8764b8',
  '#038387',
  '#ca5010',
  '#737373'
]

// ---------------------------------------------------------------------------
// GroupManagerDialog
// ---------------------------------------------------------------------------

interface GroupManagerDialogProps {
  open: boolean
  onClose: () => void
}

export function GroupManagerDialog({ open, onClose }: GroupManagerDialogProps): React.JSX.Element {
  const { groups, addGroup, removeGroup, renameGroup, reorderGroups } = useGroupsStore()
  const [localGroups, setLocalGroups] = useState<ServerGroup[]>([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const dragIdx = useRef<number | null>(null)
  const overIdx = useRef<number | null>(null)

  useEffect(() => {
    if (open) setLocalGroups([...groups].sort((a, b) => a.order - b.order))
  }, [open, groups])

  const handleDragStart = (_e: React.DragEvent, idx: number): void => {
    dragIdx.current = idx
  }
  const handleDragOver = (e: React.DragEvent, idx: number): void => {
    e.preventDefault()
    overIdx.current = idx
  }
  const handleDrop = (): void => {
    if (dragIdx.current === null || overIdx.current === null || dragIdx.current === overIdx.current)
      return
    const updated = [...localGroups]
    const [moved] = updated.splice(dragIdx.current, 1)
    updated.splice(overIdx.current, 0, moved)
    setLocalGroups(updated)
    dragIdx.current = null
    overIdx.current = null
  }

  const handleSave = (): void => {
    if (editingId) {
      renameGroup(editingId, editingName)
      setEditingId(null)
    }
    reorderGroups(localGroups)
    onClose()
  }

  const handleAdd = (): void => {
    if (!newName.trim()) return
    addGroup(newName.trim(), newColor)
    setNewName('')
    setNewColor(COLOR_PALETTE[0])
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Manage groups</DialogTitle>
      <DialogContent sx={{ pb: 0 }}>
        <List dense disablePadding>
          {localGroups.map((g, idx) => (
            <ListItem
              key={g.id}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={handleDrop}
              sx={{ px: 0, gap: 1, cursor: 'grab', '&:active': { cursor: 'grabbing' } }}
              secondaryAction={
                <Tooltip title="Delete group">
                  <IconButton
                    size="small"
                    onClick={() => {
                      removeGroup(g.id)
                      setLocalGroups((prev) => prev.filter((x) => x.id !== g.id))
                    }}
                    sx={{ color: tokens.color.error }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <DragHandleIcon sx={{ color: '#888', fontSize: 18, flexShrink: 0 }} />
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor: g.color,
                  flexShrink: 0
                }}
              />
              {editingId === g.id ? (
                <TextField
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    setLocalGroups((prev) =>
                      prev.map((x) => (x.id === g.id ? { ...x, name: editingName } : x))
                    )
                    setEditingId(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setLocalGroups((prev) =>
                        prev.map((x) => (x.id === g.id ? { ...x, name: editingName } : x))
                      )
                      setEditingId(null)
                    }
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  size="small"
                  autoFocus
                  sx={{ flex: 1 }}
                />
              ) : (
                <Typography
                  onDoubleClick={() => {
                    setEditingId(g.id)
                    setEditingName(g.name)
                  }}
                  sx={{ flex: 1, fontSize: 13, cursor: 'text', userSelect: 'none' }}
                >
                  {g.name}
                </Typography>
              )}
            </ListItem>
          ))}
        </List>

        <Divider sx={{ my: 1.5 }} />

        {/* Add group row */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', pb: 1 }}>
          <TextField
            label="New group"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
            size="small"
            sx={{ flex: 1 }}
          />
          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
            {COLOR_PALETTE.map((c) => (
              <Box
                key={c}
                onClick={() => setNewColor(c)}
                sx={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  bgcolor: c,
                  cursor: 'pointer',
                  border: newColor === c ? '2px solid white' : '2px solid transparent',
                  boxSizing: 'border-box',
                  '&:hover': { opacity: 0.8 }
                }}
              />
            ))}
          </Box>
          <IconButton size="small" onClick={handleAdd} disabled={!newName.trim()}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
