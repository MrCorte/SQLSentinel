import { useState, useMemo } from 'react'
import { Box, Typography, IconButton, Tooltip, Menu, MenuItem, Divider } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import { SidebarSearch } from '../features/sidebar/SidebarSearch'
import { SidebarTree } from '../features/sidebar/SidebarTree'
import { GroupManagerDialog } from '../features/sidebar/GroupManagerDialog'
import { useSidebarTree } from '../features/sidebar/useSidebarTree'
import { useServersStore } from '../../store/serversStore'
import { useAlertsStore } from '../../store/alertsStore'
import { tokens } from '../../styles/tokens'
import type { StoredServer } from '../../../../preload/index'
import type { SidebarItem } from '../features/sidebar/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SeverityFilter = 'all' | 'critical' | 'warning' | 'offline'

interface FilterDef {
  key: SeverityFilter
  label: string
  color: string
}

const FILTERS: FilterDef[] = [
  { key: 'all', label: 'All', color: tokens.color.textMuted },
  { key: 'critical', label: 'Critical', color: tokens.color.danger },
  { key: 'warning', label: 'Warning', color: tokens.color.warning },
  { key: 'offline', label: 'Offline', color: tokens.color.dotOffline }
]

interface Props {
  selectedServer: StoredServer | null
  selectedAgName: string | null
  onSelectServer: (server: StoredServer) => void
  onSelectAg: (agName: string) => void
  onRemoveServer: (server: StoredServer) => void
}

// ---------------------------------------------------------------------------
// ServerTree
// ---------------------------------------------------------------------------

export function ServerTree({
  selectedServer,
  selectedAgName,
  onSelectServer,
  onSelectAg,
  onRemoveServer: _onRemoveServer
}: Props): React.JSX.Element {
  const servers = useServersStore((s) => s.servers)

  // Stable string selectors — Zustand re-renders only when the HOST:PORT set for that
  // severity actually changes, not on every alert property update (ack, message, etc.)
  const criticalKey = useAlertsStore((s) =>
    s.alerts
      .filter((a) => a.severity === 'CRITICAL')
      .map((a) => a.serverId)
      .sort()
      .join('\0')
  )
  const warningKey = useAlertsStore((s) =>
    s.alerts
      .filter((a) => a.severity === 'WARNING')
      .map((a) => a.serverId)
      .sort()
      .join('\0')
  )

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)

  const {
    flatItems,
    sortedGroups,
    serverAliases,
    searchText,
    ctxMenu,
    setSearchText,
    toggleCollapse,
    toggleAgCollapse,
    toggleMachineCollapse,
    handleContextMenu,
    handleAgContextMenu,
    handleCloseCtx,
    handleMoveToGroup
  } = useSidebarTree(servers)

  // Build a set of host:port keys that match the active severity filter.
  // alert.serverId is "host:port" (set by metricsWorker), so we compare against
  // server host:port, not server.id (UUID).
  const filteredServerIds = useMemo((): Set<string> | null => {
    if (severityFilter === 'all') return null

    if (severityFilter === 'offline') {
      return new Set(
        servers
          .filter((s) => s.unreachable)
          .map((s) => `${s.host ?? s.ip}:${s.port}`)
      )
    }

    const raw = severityFilter === 'critical' ? criticalKey : warningKey
    return new Set(raw ? raw.split('\0') : [])
  }, [severityFilter, servers, criticalKey, warningKey])

  // Filter flatItems: when a severity filter is active, keep only server items
  // (and search-server items) whose server ID is in filteredServerIds
  const visibleItems = useMemo((): SidebarItem[] => {
    if (filteredServerIds === null) return flatItems

    const filtered = flatItems.filter((item) => {
      if (item.kind === 'server' || item.kind === 'search-server') {
        return filteredServerIds.has(`${item.server.host ?? item.server.ip}:${item.server.port}`)
      }
      // Keep structural items (group headers, AG headers, machine headers)
      // only if they have at least one visible server
      return true
    })

    // Remove group/ag/machine headers that have no server children following them
    const result: SidebarItem[] = []
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i]
      if (
        item.kind === 'group' ||
        item.kind === 'ag' ||
        item.kind === 'machine' ||
        item.kind === 'ungrouped-header'
      ) {
        // Look ahead: is there at least one server item before the next structural header?
        let hasServer = false
        for (let j = i + 1; j < filtered.length; j++) {
          const next = filtered[j]
          if (next.kind === 'server' || next.kind === 'search-server') {
            hasServer = true
            break
          }
          if (
            next.kind === 'group' ||
            next.kind === 'ag' ||
            next.kind === 'machine' ||
            next.kind === 'ungrouped-header'
          ) {
            break
          }
        }
        if (hasServer) result.push(item)
      } else {
        result.push(item)
      }
    }

    if (result.length === 0) return [{ kind: 'no-results' }]
    return result
  }, [flatItems, filteredServerIds])

  // Count visible servers for label
  const visibleServerCount = useMemo(
    () =>
      visibleItems.filter((item) => item.kind === 'server' || item.kind === 'search-server').length,
    [visibleItems]
  )

  const totalServerCount = servers.length

  // serversError is not exposed by useSidebarTree — pass null
  const serversError: string | null = null

  return (
    <Box
      sx={{
        width: tokens.size.serverTreeWidth,
        minWidth: tokens.size.serverTreeWidth,
        height: '100%',
        bgcolor: tokens.color.bgBase,
        borderRight: `1px solid ${tokens.color.bgBorder}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 1.5,
          pt: 1.5,
          pb: 0.75,
          borderBottom: `1px solid ${tokens.color.bgBorder}`
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
          <Typography
            sx={{
              fontSize: tokens.font.sizeXs,
              fontWeight: tokens.font.weightSemibold,
              color: tokens.color.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              flex: 1
            }}
          >
            Servers
          </Typography>
          <Tooltip title="Manage environments" placement="right">
            <IconButton
              size="small"
              onClick={() => setGroupManagerOpen(true)}
              sx={{ p: 0.25, color: tokens.color.textMuted, '&:hover': { color: '#fff' } }}
            >
              <SettingsIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Search */}
        <SidebarSearch value={searchText} onChange={setSearchText} />

        {/* Severity filter pills */}
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
          {FILTERS.map((f) => {
            const isActive = severityFilter === f.key
            return (
              <Box
                key={f.key}
                onClick={() => setSeverityFilter(f.key)}
                sx={{
                  px: 0.75,
                  py: 0.25,
                  fontSize: 10,
                  fontWeight: isActive ? tokens.font.weightSemibold : tokens.font.weightRegular,
                  color: isActive ? '#fff' : f.color,
                  bgcolor: isActive ? `${f.color}22` : 'transparent',
                  border: `1px solid ${isActive ? f.color : 'transparent'}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'all 150ms',
                  '&:hover': {
                    bgcolor: `${f.color}18`,
                    color: f.color
                  }
                }}
              >
                {f.label}
              </Box>
            )
          })}
        </Box>

        {/* Server count label */}
        <Typography
          sx={{
            fontSize: 10,
            color: tokens.color.textMuted,
            mt: 0.5
          }}
        >
          {severityFilter === 'all'
            ? `${totalServerCount} server${totalServerCount !== 1 ? 's' : ''}`
            : `${visibleServerCount} / ${totalServerCount}`}
        </Typography>
      </Box>

      <GroupManagerDialog open={groupManagerOpen} onClose={() => setGroupManagerOpen(false)} />

      {/* Context menu — right-click on a server */}
      <Menu
        open={ctxMenu !== null}
        onClose={handleCloseCtx}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { top: ctxMenu.mouseY, left: ctxMenu.mouseX } : undefined}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        <Typography sx={{ px: 2, py: 0.5, fontSize: 10, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          {ctxMenu?.server.agName ? `Move AG cluster "${ctxMenu.server.agName}"` : 'Move to environment'}
        </Typography>
        {sortedGroups.map((g) => (
          <MenuItem
            key={g.id}
            onClick={() => handleMoveToGroup(g.id)}
            sx={{ fontSize: 13, gap: 1 }}
          >
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: g.color, flexShrink: 0 }} />
            {g.name}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => handleMoveToGroup(undefined)} sx={{ fontSize: 13, color: tokens.color.textMuted }}>
          Remove from group
        </MenuItem>
      </Menu>

      {/* Tree */}
      <SidebarTree
        flatItems={visibleItems}
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
        onAgContextMenu={handleAgContextMenu}
      />
    </Box>
  )
}
