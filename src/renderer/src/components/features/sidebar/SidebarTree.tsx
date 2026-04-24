import { useRef, useCallback, memo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Box, Typography, IconButton, Tooltip, Chip } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Alert from '@mui/material/Alert'
import { keyframes } from '@mui/system'
import type { StoredServer } from '../../../../../preload/index'
import type { AgGroupState } from '../../../store/agStore'
import type { ServerGroup } from '../../../types/index'
import { getServerDisplayName } from '../../../types/index'
import { useMetricsStore } from '../../../store/metricsStore'
import { tokens } from '../../../styles/tokens'
import { HOSTING_BADGE } from '../../../constants/hosting'
import { serverLabel } from './useSidebarTree'
import type { SidebarItem } from './types'
import { getSidebarItemSize } from './types'

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

const pulseAnim = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.25 }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function highlightText(text: string, query: string): React.JSX.Element {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: '#ffb900', fontWeight: 700 }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  )
}

// ---------------------------------------------------------------------------
// StatusDot
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
        boxShadow: unreachable ? tokens.shadow.dotGlowError : tokens.shadow.dotGlowSuccess,
        animation: unreachable ? `${pulseAnim} 1.5s ease-in-out infinite` : 'none'
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// GroupHeader
// ---------------------------------------------------------------------------

export const GroupHeader = memo(function GroupHeader({
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
})

// ---------------------------------------------------------------------------
// AgGroupHeader
// ---------------------------------------------------------------------------

function agHealthColor(health: AgGroupState['health']): string {
  if (health === 'HEALTHY') return '#107c10'
  if (health === 'PARTIALLY_HEALTHY') return '#d83b01'
  return '#a4262c'
}

export const AgGroupHeader = memo(function AgGroupHeader({
  ag,
  isSelected,
  isExpanded,
  onToggleCollapse,
  onSelect,
  onContextMenu
}: {
  ag: AgGroupState
  isSelected: boolean
  isExpanded: boolean
  onToggleCollapse: () => void
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const color = agHealthColor(ag.health)
  return (
    <Box
      onContextMenu={onContextMenu}
      sx={{
        display: 'flex',
        alignItems: 'center',
        pl: 1.5,
        pr: 1,
        bgcolor: isSelected ? tokens.color.bgSidebarSelected : '#1e2a3a',
        borderLeft: `3px solid ${color}`,
        transition: 'background 150ms'
      }}
    >
      {/* ZONA 1 — solo expand/collapse */}
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation()
          onToggleCollapse()
        }}
        sx={{ p: 0.25, color: '#7a9ab8', flexShrink: 0 }}
      >
        <ChevronRightIcon
          sx={{
            fontSize: 14,
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 200ms ease'
          }}
        />
      </IconButton>

      {/* ZONA 2 — naviga alla AG Dashboard */}
      <Box
        onClick={onSelect}
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          py: 0.75,
          pl: 0.5,
          cursor: 'pointer',
          overflow: 'hidden',
          '&:hover': { opacity: 0.85 }
        }}
      >
        <Typography
          sx={{
            fontSize: 11,
            color: isSelected ? '#fff' : '#a0c4d8',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 700,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          🔗 {ag.ag_name}
        </Typography>
        <Typography
          sx={{
            fontSize: 10,
            color,
            fontWeight: 700,
            bgcolor: `${color}22`,
            px: 0.75,
            py: 0.125,
            borderRadius: 0.5,
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          {ag.health === 'HEALTHY'
            ? '● HEALTHY'
            : ag.health === 'PARTIALLY_HEALTHY'
              ? '◐ PARTIAL'
              : '○ UNHEALTHY'}
        </Typography>
      </Box>
    </Box>
  )
})

// ---------------------------------------------------------------------------
// RoleBadge
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: 'PRIMARY' | 'SECONDARY' | 'RESOLVING' }): React.JSX.Element {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    PRIMARY: { bg: '#dff6dd', color: '#107c10', label: 'PRIMARY' },
    SECONDARY: { bg: '#f3f2f1', color: '#605e5c', label: 'SECONDARY' },
    RESOLVING: { bg: '#fed9cc', color: '#d83b01', label: 'RESOLVING' }
  }
  const s = styles[role] ?? styles.RESOLVING
  return (
    <Typography
      component="span"
      sx={{
        fontSize: 9,
        fontWeight: 700,
        bgcolor: s.bg,
        color: s.color,
        px: 0.5,
        py: 0.125,
        borderRadius: 0.5,
        flexShrink: 0
      }}
    >
      {s.label}
    </Typography>
  )
}

// ---------------------------------------------------------------------------
// MachineHeader
// ---------------------------------------------------------------------------

export const MachineHeader = memo(function MachineHeader({
  machineName,
  instanceCount,
  isExpanded,
  onClick
}: {
  machineName: string
  instanceCount: number
  isExpanded: boolean
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
        pl: 2.5,
        cursor: 'pointer',
        bgcolor: '#1a2433',
        borderLeft: '3px solid #4a6fa5',
        '&:hover': { bgcolor: '#1f2d40' },
        transition: 'background 150ms'
      }}
    >
      <ChevronRightIcon
        sx={{
          fontSize: 14,
          color: '#7a9ab8',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 200ms ease',
          flexShrink: 0
        }}
      />
      <Typography
        sx={{
          fontSize: 11,
          color: '#a0c4d8',
          fontWeight: 600,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        🖥 {machineName}
      </Typography>
      <Typography
        sx={{
          fontSize: 10,
          color: '#4a6fa5',
          fontWeight: 700,
          bgcolor: '#4a6fa522',
          px: 0.75,
          py: 0.125,
          borderRadius: 0.5,
          whiteSpace: 'nowrap',
          flexShrink: 0
        }}
      >
        {instanceCount} {instanceCount === 1 ? 'instance' : 'instances'}
      </Typography>
    </Box>
  )
})

// ---------------------------------------------------------------------------
// ServerItem
// ---------------------------------------------------------------------------

interface ServerItemProps {
  server: StoredServer
  alias: string | undefined
  isSelected: boolean
  searchText: string
  inAgGroup?: boolean
  inMachineGroup?: boolean
  onSelect: (server: StoredServer) => void
  onContextMenu?: (e: React.MouseEvent, server: StoredServer) => void
}

export const ServerItem = memo(function ServerItem({
  server,
  alias,
  isSelected,
  searchText,
  inAgGroup,
  inMachineGroup,
  onSelect,
  onContextMenu
}: ServerItemProps): React.JSX.Element {
  const displayName = getServerDisplayName({
    ip: server.ip ?? server.host,
    port: server.port,
    alias
  })
  const realAddr = serverLabel(server)
  const health = useMetricsStore((s) => s.serverHealth[realAddr])
  const tooltipTitle = server.unreachable
    ? `Unreachable${server.unreachableSince ? ` since ${new Date(server.unreachableSince).toLocaleString('en-US')}` : ''}`
    : realAddr

  const roleIcon = server.agRole === 'PRIMARY' ? '★ ' : server.agRole === 'SECONDARY' ? '○ ' : ''

  const handleClick = useCallback(() => onSelect(server), [onSelect, server])
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onContextMenu) return
      e.preventDefault()
      onContextMenu(e, server)
    },
    [onContextMenu, server]
  )

  return (
    <Tooltip title={tooltipTitle} placement="right" arrow disableInteractive enterDelay={600}>
      <Box
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: inAgGroup || inMachineGroup ? 4.5 : 3.5,
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
          {inAgGroup && roleIcon}
          {searchText ? highlightText(displayName, searchText) : displayName}
        </Typography>
        {inAgGroup && server.agRole && <RoleBadge role={server.agRole} />}
        {(() => {
          const badge = HOSTING_BADGE[server.hostingType ?? 'on-premise']
          return (
            <Chip
              label={badge.label}
              size="small"
              sx={{
                height: 16,
                fontSize: 9,
                fontWeight: 700,
                backgroundColor: badge.color,
                color: '#fff',
                borderRadius: '3px',
                flexShrink: 0,
                '& .MuiChip-label': { px: '4px' }
              }}
            />
          )
        })()}
        {health && health.failCount > 0 && (
          <Tooltip
            title={`${health.failCount} ${health.failCount === 1 ? 'failed attempt' : 'failed attempts'} — next retry: ${new Date(health.nextRetry).toLocaleTimeString('en-US')}`}
            placement="right"
            arrow
          >
            <WarningAmberIcon sx={{ fontSize: 13, color: '#d83b01', flexShrink: 0 }} />
          </Tooltip>
        )}
      </Box>
    </Tooltip>
  )
})

// ---------------------------------------------------------------------------
// SidebarTree — virtualised flat list
// ---------------------------------------------------------------------------

export interface SidebarTreeProps {
  flatItems: SidebarItem[]
  servers: StoredServer[]
  serversError: string | null
  selectedServer: StoredServer | null
  selectedAgName: string | null
  searchText: string
  serverAliases: Record<string, string>
  onSelectServer: (server: StoredServer) => void
  onSelectAg: (agName: string) => void
  onToggleCollapse: (groupId: string) => void
  onToggleAgCollapse: (agName: string) => void
  onToggleMachineCollapse: (machineName: string) => void
  onContextMenu: (e: React.MouseEvent, server: StoredServer) => void
  onAgContextMenu: (e: React.MouseEvent, agName: string) => void
}

export function SidebarTree({
  flatItems,
  servers,
  serversError,
  selectedServer,
  selectedAgName,
  searchText,
  serverAliases,
  onSelectServer,
  onSelectAg,
  onToggleCollapse,
  onToggleAgCollapse,
  onToggleMachineCollapse,
  onContextMenu,
  onAgContextMenu
}: SidebarTreeProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => getSidebarItemSize(flatItems[i]),
    overscan: 10
  })

  return (
    <Box ref={parentRef} sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
      {serversError && (
        <Alert severity="error" sx={{ mx: 1, mb: 0.5, fontSize: 11 }}>
          {serversError}
        </Alert>
      )}

      {servers.length === 0 && !serversError && (
        <Typography sx={{ px: 2, py: 1.5, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
          No servers.
          <br />
          Use Discovery to add some.
        </Typography>
      )}

      {flatItems.length > 0 && (
        <Box
          sx={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const item = flatItems[vItem.index]
            return (
              <Box
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start}px)`
                }}
              >
                {item.kind === 'group' && (
                  <GroupHeader
                    group={item.group}
                    onlineCount={item.onlineCount}
                    onClick={() => onToggleCollapse(item.group.id)}
                  />
                )}
                {item.kind === 'ag' && (
                  <AgGroupHeader
                    ag={item.agInfo}
                    isSelected={selectedAgName === item.agName}
                    isExpanded={item.isExpanded}
                    onToggleCollapse={() => onToggleAgCollapse(item.agName)}
                    onSelect={() => onSelectAg(item.agName)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      onAgContextMenu(e, item.agName)
                    }}
                  />
                )}
                {item.kind === 'machine' && (
                  <MachineHeader
                    machineName={item.machineName}
                    instanceCount={item.instanceCount}
                    isExpanded={item.isExpanded}
                    onClick={() => onToggleMachineCollapse(item.machineName)}
                  />
                )}
                {item.kind === 'server' && (
                  <ServerItem
                    server={item.server}
                    alias={serverAliases[item.server.id]}
                    isSelected={selectedServer ? selectedServer.id === item.server.id : false}
                    searchText=""
                    inAgGroup={item.inAgGroup}
                    inMachineGroup={item.inMachineGroup}
                    onSelect={onSelectServer}
                    onContextMenu={item.inAgGroup ? undefined : onContextMenu}
                  />
                )}
                {item.kind === 'ungrouped-header' && (
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
                    Ungrouped
                  </Typography>
                )}
                {item.kind === 'search-server' && (
                  <ServerItem
                    server={item.server}
                    alias={serverAliases[item.server.id]}
                    isSelected={selectedServer ? selectedServer.id === item.server.id : false}
                    searchText={searchText}
                    inMachineGroup={false}
                    onSelect={onSelectServer}
                    onContextMenu={onContextMenu}
                  />
                )}
                {item.kind === 'no-results' && (
                  <Typography sx={{ px: 2, py: 1, fontSize: 12, color: '#666' }}>
                    No results.
                  </Typography>
                )}
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
