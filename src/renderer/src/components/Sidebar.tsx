import { useState, useRef } from 'react'
import { Box, Typography, IconButton, Tooltip, Menu, MenuItem, Divider } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import type { StoredServer } from '../../../preload/index'
import { tokens } from '../styles/tokens'
import { SidebarSearch } from './features/sidebar/SidebarSearch'
import { SidebarTree } from './features/sidebar/SidebarTree'
import { RenameAliasDialog } from './features/sidebar/RenameAliasDialog'
import { GroupManagerDialog } from './features/sidebar/GroupManagerDialog'
import { useSidebarTree, serverLabel } from './features/sidebar/useSidebarTree'

// Re-export types consumed by external code
export type { SidebarItem } from './features/sidebar/types'
export { getSidebarItemSize } from './features/sidebar/types'

// ---------------------------------------------------------------------------
// SidebarProps
// ---------------------------------------------------------------------------

export interface SidebarProps {
  servers: StoredServer[]
  serversError: string | null
  selectedServer: StoredServer | null
  selectedAgName: string | null
  onSelectServer: (server: StoredServer) => void
  onSelectAg: (agName: string) => void
  onRemoveServer: (server: StoredServer) => void
}

export function Sidebar({
  servers,
  serversError,
  selectedServer,
  selectedAgName,
  onSelectServer,
  onSelectAg,
  onRemoveServer
}: SidebarProps): React.JSX.Element {
  const {
    flatItems,
    sortedGroups,
    serverAliases,
    searchText,
    ctxMenu,
    moveMenuOpen,
    setSearchText,
    toggleCollapse,
    toggleAgCollapse,
    toggleMachineCollapse,
    handleContextMenu,
    handleCloseCtx,
    setMoveMenuOpen,
    handleMoveToGroup,
    setServerAlias
  } = useSidebarTree(servers)

  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const moveMenuRef = useRef<HTMLLIElement | null>(null)

  // Rename alias dialog
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameServerId, setRenameServerId] = useState('')

  const handleRemove = (): void => {
    if (!ctxMenu) return
    onRemoveServer(ctxMenu.server)
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
        <SidebarSearch value={searchText} onChange={setSearchText} />
      </Box>

      {/* Server list — virtualized */}
      <SidebarTree
        flatItems={flatItems}
        servers={servers}
        serversError={serversError}
        selectedServer={selectedServer}
        selectedAgName={selectedAgName}
        searchText={searchText}
        serverAliases={serverAliases}
        onSelectServer={onSelectServer}
        onSelectAg={onSelectAg}
        onToggleCollapse={toggleCollapse}
        onToggleAgCollapse={toggleAgCollapse}
        onToggleMachineCollapse={toggleMachineCollapse}
        onContextMenu={handleContextMenu}
      />

      {/* Context menu */}
      <Menu
        open={Boolean(ctxMenu)}
        onClose={handleCloseCtx}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { top: ctxMenu.mouseY, left: ctxMenu.mouseX } : undefined}
        PaperProps={{ sx: { minWidth: 180 } }}
      >
        <MenuItem ref={moveMenuRef} onClick={() => setMoveMenuOpen(true)}>
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
