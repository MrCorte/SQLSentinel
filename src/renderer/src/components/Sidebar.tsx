import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  List,
  ListItem,
  Alert
} from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import SearchIcon from '@mui/icons-material/Search'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DragHandleIcon from '@mui/icons-material/DragHandle'
import { keyframes } from '@mui/system'
import type { StoredServer } from '../../../preload/index'
import { useGroupsStore } from '../store/groupsStore'
import type { ServerGroup } from '../types/index'
import { getServerDisplayName } from '../types/index'
import { tokens } from '../styles/tokens'

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

const pulseAnim = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.25 }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serverLabel(s: StoredServer): string {
  return `${s.ip}:${s.port}`
}

function highlightText(text: string, query: string): React.JSX.Element {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: '#ffb900', fontWeight: 700 }}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  )
}

// ---------------------------------------------------------------------------
// StatusDot — pulse animation when unreachable
// ---------------------------------------------------------------------------

function StatusDot({ unreachable }: { unreachable?: boolean }): React.JSX.Element {
  const color = unreachable ? tokens.color.dotOffline : tokens.color.dotOnline
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: color,
        flexShrink: 0,
        animation: unreachable ? `${pulseAnim} 1.5s ease-in-out infinite` : 'none'
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// SearchBar
// ---------------------------------------------------------------------------

function SearchBar({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <Box sx={{ position: 'relative', px: 1.5, pb: 1 }}>
      <Box
        component="span"
        sx={{
          position: 'absolute',
          left: 22,
          top: '50%',
          transform: 'translateY(-55%)',
          color: '#888',
          display: 'flex',
          pointerEvents: 'none'
        }}
      >
        <SearchIcon sx={{ fontSize: 14 }} />
      </Box>
      <Box
        component="input"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder="Cerca server..."
        sx={{
          width: '100%',
          height: 28,
          bgcolor: '#2d2d2d',
          border: '1px solid #3d3d3d',
          borderRadius: '4px',
          color: '#fff',
          fontSize: 12,
          pl: '28px',
          pr: value ? '24px' : '8px',
          outline: 'none',
          fontFamily: 'inherit',
          '&::placeholder': { color: '#888' },
          '&:focus': { borderColor: tokens.color.primary }
        }}
      />
      {value && (
        <Box
          component="span"
          onClick={() => onChange('')}
          sx={{
            position: 'absolute',
            right: 20,
            top: '50%',
            transform: 'translateY(-55%)',
            color: '#888',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            '&:hover': { color: '#ccc' }
          }}
        >
          ×
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// GroupHeader
// ---------------------------------------------------------------------------

function GroupHeader({
  group,
  onlineCount,
  onClick
}: {
  group: ServerGroup
  onlineCount: number
  onClick: () => void
}): React.JSX.Element {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.75,
        cursor: 'pointer',
        userSelect: 'none',
        '&:hover': { bgcolor: '#2a2a2a' },
        transition: 'background 150ms'
      }}
    >
      <ChevronRightIcon
        sx={{
          fontSize: 14,
          color: '#888',
          transform: group.collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          transition: 'transform 200ms ease',
          flexShrink: 0
        }}
      />
      <Box
        component="span"
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: group.color,
          flexShrink: 0
        }}
      />
      <Typography
        sx={{
          fontSize: 10,
          color: '#a0a0a0',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          fontWeight: 600,
          flex: 1
        }}
      >
        {group.name}
      </Typography>
      {onlineCount > 0 && (
        <Typography sx={{ fontSize: 10, color: '#666' }}>({onlineCount})</Typography>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// ServerItem
// ---------------------------------------------------------------------------

interface ServerItemProps {
  server: StoredServer
  alias: string | undefined
  isSelected: boolean
  searchText: string
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent, server: StoredServer) => void
}

function ServerItem({
  server,
  alias,
  isSelected,
  searchText,
  onSelect,
  onContextMenu
}: ServerItemProps): React.JSX.Element {
  const displayName = getServerDisplayName({ ip: server.ip, port: server.port, alias })
  const realAddr = serverLabel(server)
  const tooltipTitle = server.unreachable
    ? `Non raggiungibile${server.unreachableSince ? ` dal ${new Date(server.unreachableSince).toLocaleString('it-IT')}` : ''}`
    : realAddr

  return (
    <Tooltip
      title={tooltipTitle}
      placement="right"
      arrow
      disableInteractive
      enterDelay={600}
    >
      <Box
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e, server)
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 3.5,
          pr: 1.5,
          py: 0.875,
          cursor: 'pointer',
          bgcolor: isSelected ? tokens.color.bgSidebarSelected : 'transparent',
          color: isSelected ? '#fff' : 'rgba(255,255,255,0.7)',
          '&:hover': {
            bgcolor: isSelected ? tokens.color.primaryHover : tokens.color.bgSidebarHover,
            color: '#fff'
          },
          transition: 'background 150ms'
        }}
      >
        <StatusDot unreachable={server.unreachable} />
        <Typography
          component="span"
          sx={{
            fontSize: 13,
            fontWeight: isSelected ? 600 : 400,
            flex: 1,
            color: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {searchText ? highlightText(displayName, searchText) : displayName}
        </Typography>
      </Box>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// RenameAliasDialog
// ---------------------------------------------------------------------------

function RenameAliasDialog({
  open,
  serverId,
  currentAlias,
  onClose,
  onSave
}: {
  open: boolean
  serverId: string
  currentAlias: string
  onClose: () => void
  onSave: (alias: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(currentAlias)

  useEffect(() => {
    if (open) setValue(currentAlias)
  }, [open, currentAlias])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rinomina server</DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TextField
          label="Nome visualizzato"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={serverId}
          fullWidth
          size="small"
          autoFocus
          helperText="Lascia vuoto per mostrare IP:Porta"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(value)
            if (e.key === 'Escape') onClose()
          }}
        />
        <Typography
          variant="caption"
          sx={{ mt: 1, display: 'block', color: tokens.color.textSecondary }}
        >
          IP: {serverId}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" onClick={() => onSave(value)}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// GroupManagerDialog
// ---------------------------------------------------------------------------

function GroupManagerDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
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
    if (
      dragIdx.current === null ||
      overIdx.current === null ||
      dragIdx.current === overIdx.current
    )
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
      <DialogTitle>Gestione gruppi</DialogTitle>
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
                <Tooltip title="Elimina gruppo">
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
            label="Nuovo gruppo"
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
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" onClick={handleSave}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Sidebar (main export)
// ---------------------------------------------------------------------------

export interface SidebarProps {
  servers: StoredServer[]
  serversError: string | null
  selectedServer: StoredServer | null
  onSelectServer: (server: StoredServer) => void
  onRemoveServer: (server: StoredServer) => void
}

export function Sidebar({
  servers,
  serversError,
  selectedServer,
  onSelectServer,
  onRemoveServer
}: SidebarProps): React.JSX.Element {
  const { groups, serverGroups, serverAliases, toggleCollapse, setServerGroup, setServerAlias } =
    useGroupsStore()

  const [searchText, setSearchText] = useState('')
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{
    mouseX: number
    mouseY: number
    server: StoredServer
  } | null>(null)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const moveMenuRef = useRef<HTMLLIElement | null>(null)

  // Rename alias dialog
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameServerId, setRenameServerId] = useState('')

  const sortedGroups = [...groups].sort((a, b) => a.order - b.order)

  // Search: filter + priority sort (startsWith before includes)
  const filteredServers = searchText
    ? servers
        .filter((s) => {
          const label = serverAliases[serverLabel(s)] || serverLabel(s)
          return label.toLowerCase().includes(searchText.toLowerCase())
        })
        .sort((a, b) => {
          const la = (serverAliases[serverLabel(a)] || serverLabel(a)).toLowerCase()
          const lb = (serverAliases[serverLabel(b)] || serverLabel(b)).toLowerCase()
          const q = searchText.toLowerCase()
          const aStarts = la.startsWith(q)
          const bStarts = lb.startsWith(q)
          if (aStarts && !bStarts) return -1
          if (!aStarts && bStarts) return 1
          return 0
        })
    : []

  // Group assignment map
  const serversByGroupId = new Map<string, StoredServer[]>()
  for (const s of servers) {
    const gid = serverGroups[serverLabel(s)]
    if (gid) {
      if (!serversByGroupId.has(gid)) serversByGroupId.set(gid, [])
      serversByGroupId.get(gid)!.push(s)
    }
  }
  const ungrouped = servers.filter((s) => !serverGroups[serverLabel(s)])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, server: StoredServer): void => {
      setCtxMenu({ mouseX: e.clientX, mouseY: e.clientY, server })
      setMoveMenuOpen(false)
    },
    []
  )

  const handleCloseCtx = (): void => {
    setCtxMenu(null)
    setMoveMenuOpen(false)
  }

  const handleRemove = (): void => {
    if (!ctxMenu) return
    onRemoveServer(ctxMenu.server)
    handleCloseCtx()
  }

  const handleMoveToGroup = (groupId: string | undefined): void => {
    if (!ctxMenu) return
    setServerGroup(serverLabel(ctxMenu.server), groupId)
    handleCloseCtx()
  }

  const handleRenameOpen = (): void => {
    if (!ctxMenu) return
    setRenameServerId(serverLabel(ctxMenu.server))
    setRenameOpen(true)
    handleCloseCtx()
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        bgcolor: tokens.color.bgSidebar,
        width: tokens.size.sidebarWidth,
        minWidth: tokens.size.sidebarWidth,
        flexShrink: 0
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1.5,
          pt: 1.5,
          pb: 0.75,
          borderBottom: `1px solid ${tokens.color.dividerDark}`
        }}
      >
        <Typography
          sx={{
            fontSize: 10,
            color: '#a0a0a0',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            fontWeight: 600,
            flex: 1
          }}
        >
          Server monitorati
        </Typography>
        <Tooltip title="Gestisci gruppi">
          <IconButton
            size="small"
            onClick={() => setGroupManagerOpen(true)}
            sx={{ color: '#888', p: 0.375, '&:hover': { color: '#ccc', bgcolor: '#2d2d2d' } }}
          >
            <SettingsIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Search bar */}
      <Box sx={{ pt: 1 }}>
        <SearchBar value={searchText} onChange={setSearchText} />
      </Box>

      {/* Server list */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
        {serversError && (
          <Alert severity="error" sx={{ mx: 1, mb: 0.5, fontSize: 11 }}>
            {serversError}
          </Alert>
        )}

        {servers.length === 0 && !serversError && (
          <Typography sx={{ px: 2, py: 1.5, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
            Nessun server.
            <br />
            Usa Discovery per aggiungerne.
          </Typography>
        )}

        {/* Search mode: flat filtered list */}
        {searchText ? (
          filteredServers.length > 0 ? (
            filteredServers.map((s) => (
              <ServerItem
                key={s.id}
                server={s}
                alias={serverAliases[serverLabel(s)]}
                isSelected={selectedServer ? selectedServer.id === s.id : false}
                searchText={searchText}
                onSelect={() => onSelectServer(s)}
                onContextMenu={handleContextMenu}
              />
            ))
          ) : (
            <Typography sx={{ px: 2, py: 1, fontSize: 12, color: '#666' }}>
              Nessun risultato.
            </Typography>
          )
        ) : (
          /* Normal mode: grouped */
          <>
            {sortedGroups.map((group) => {
              const groupServers = serversByGroupId.get(group.id) ?? []
              if (groupServers.length === 0) return null
              const onlineCount = groupServers.filter((s) => !s.unreachable).length
              return (
                <Box key={group.id}>
                  <GroupHeader
                    group={group}
                    onlineCount={onlineCount}
                    onClick={() => toggleCollapse(group.id)}
                  />
                  <Box
                    sx={{
                      maxHeight: group.collapsed ? 0 : 9999,
                      overflow: 'hidden',
                      transition: 'max-height 200ms ease'
                    }}
                  >
                    {groupServers.map((s) => (
                      <ServerItem
                        key={s.id}
                        server={s}
                        alias={serverAliases[serverLabel(s)]}
                        isSelected={selectedServer ? selectedServer.id === s.id : false}
                        searchText=""
                        onSelect={() => onSelectServer(s)}
                        onContextMenu={handleContextMenu}
                      />
                    ))}
                  </Box>
                </Box>
              )
            })}

            {/* Ungrouped section */}
            {ungrouped.length > 0 && (
              <Box>
                <Typography
                  sx={{
                    px: 1.5,
                    py: 0.75,
                    fontSize: 10,
                    color: '#666',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    fontWeight: 600
                  }}
                >
                  Senza gruppo
                </Typography>
                {ungrouped.map((s) => (
                  <ServerItem
                    key={s.id}
                    server={s}
                    alias={serverAliases[serverLabel(s)]}
                    isSelected={selectedServer ? selectedServer.id === s.id : false}
                    searchText=""
                    onSelect={() => onSelectServer(s)}
                    onContextMenu={handleContextMenu}
                  />
                ))}
              </Box>
            )}
          </>
        )}
      </Box>

      {/* Context menu */}
      <Menu
        open={Boolean(ctxMenu)}
        onClose={handleCloseCtx}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { top: ctxMenu.mouseY, left: ctxMenu.mouseX } : undefined}
        PaperProps={{ sx: { minWidth: 180 } }}
      >
        <MenuItem
          ref={moveMenuRef}
          onClick={() => setMoveMenuOpen(true)}
        >
          Sposta in gruppo ▶
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleRenameOpen}>Rinomina alias</MenuItem>
        <MenuItem onClick={handleRemove} sx={{ color: tokens.color.error }}>
          Rimuovi server
        </MenuItem>
      </Menu>

      {/* Move-to-group submenu */}
      <Menu
        open={moveMenuOpen}
        anchorEl={moveMenuRef.current}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClose={() => setMoveMenuOpen(false)}
        PaperProps={{ sx: { minWidth: 160 } }}
      >
        {sortedGroups.map((g) => (
          <MenuItem key={g.id} onClick={() => handleMoveToGroup(g.id)}>
            <Box
              component="span"
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: g.color,
                mr: 1,
                display: 'inline-block',
                flexShrink: 0
              }}
            />
            {g.name}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => handleMoveToGroup(undefined)}>Senza gruppo</MenuItem>
      </Menu>

      {/* Rename alias dialog */}
      <RenameAliasDialog
        open={renameOpen}
        serverId={renameServerId}
        currentAlias={serverAliases[renameServerId] ?? ''}
        onClose={() => setRenameOpen(false)}
        onSave={(alias) => {
          setServerAlias(renameServerId, alias)
          setRenameOpen(false)
        }}
      />

      {/* Group manager dialog */}
      <GroupManagerDialog open={groupManagerOpen} onClose={() => setGroupManagerOpen(false)} />
    </Box>
  )
}
