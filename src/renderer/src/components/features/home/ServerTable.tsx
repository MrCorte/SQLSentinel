import { useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Box } from '@mui/material'
import { tokens } from '../../../styles/tokens'
import { serverKey } from './useHomeDashboard'
import { ServerRow, GRID_TEMPLATE } from './ServerRow'
import type { StoredServer, ServerMetrics } from '../../../../../preload/index'
import type { ServerSummary } from '../../../store/metricsStore'
import type { ServerGroup } from '../../../types/index'

// ---------------------------------------------------------------------------
// Column config
// ---------------------------------------------------------------------------

const COL_HEADERS = [
  'SERVER',
  'ENVIRONMENT',
  'INFRASTRUCTURE',
  'TYPE',
  'CPU%',
  'MEM%',
  'DB',
  'ALERTS',
  'STATUS',
  'UPTIME'
]

const ROW_HEIGHT = 48
const AG_HEADER_HEIGHT = 34

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: tokens.font.weightBold,
  fontSize: tokens.font.sizeXs,
  color: 'inherit',
  opacity: 0.6,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '1px solid rgba(128,128,128,0.2)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

// ---------------------------------------------------------------------------
// AG (Always On) grouping
// ---------------------------------------------------------------------------

/**
 * A row in the rendered list: either an Always On group header, or a server.
 * Servers that share an AvailabilityGroup (>= 2 replicas with the same agName)
 * are clustered together under a header named after the AG; standalone servers
 * (and lone AG replicas) render in their original position.
 */
type DisplayRow =
  | { kind: 'ag'; key: string; agName: string; members: StoredServer[] }
  | { kind: 'server'; key: string; server: StoredServer }

function rolePriority(role: StoredServer['agRole']): number {
  return role === 'PRIMARY' ? 0 : role === 'SECONDARY' ? 1 : 2
}

export function buildDisplayRows(servers: StoredServer[]): DisplayRow[] {
  // Bucket servers by AG name (trimmed, case-insensitive), preserving the order
  // in which each AG first appears.
  const buckets = new Map<string, StoredServer[]>()
  for (const s of servers) {
    const ag = s.agName?.trim()
    if (!ag) continue
    const k = ag.toLowerCase()
    const bucket = buckets.get(k)
    if (bucket) bucket.push(s)
    else buckets.set(k, [s])
  }
  // Only AGs with 2+ replicas become a group; a lone replica stays inline.
  const grouped = new Set([...buckets].filter(([, m]) => m.length >= 2).map(([k]) => k))

  const rows: DisplayRow[] = []
  const emitted = new Set<string>()
  for (const s of servers) {
    const k = s.agName?.trim().toLowerCase()
    if (k && grouped.has(k)) {
      if (emitted.has(k)) continue // members already emitted under the header
      emitted.add(k)
      const members = [...buckets.get(k)!].sort(
        (a, b) => rolePriority(a.agRole) - rolePriority(b.agRole)
      )
      const agName = members.find((m) => m.agName?.trim())?.agName?.trim() ?? s.agName!.trim()
      rows.push({ kind: 'ag', key: `ag:${k}`, agName, members })
      for (const m of members) rows.push({ kind: 'server', key: `srv:${m.id}`, server: m })
    } else {
      rows.push({ kind: 'server', key: `srv:${s.id}`, server: s })
    }
  }
  return rows
}

function agHealthColor(
  members: StoredServer[],
  metricsMap: Record<string, ServerMetrics | undefined>
): string {
  const offline = members.filter((m) => m.unreachable).length
  const online = members.filter((m) => !m.unreachable && metricsMap[serverKey(m)]).length
  if (offline > 0) return tokens.color.danger
  if (online < members.length) return tokens.color.warning
  return tokens.color.success
}

function AgHeaderRow({
  agName,
  members,
  metricsMap,
  onClick,
  style
}: {
  agName: string
  members: StoredServer[]
  metricsMap: Record<string, ServerMetrics | undefined>
  onClick?: () => void
  style?: React.CSSProperties
}): React.JSX.Element {
  const color = agHealthColor(members, metricsMap)
  const primary = members.find((m) => m.agRole === 'PRIMARY')
  return (
    <div
      title={`Open the Always On dashboard for ${agName}`}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        backgroundColor: '#1e2a3a',
        borderLeft: `3px solid ${color}`,
        borderBottom: '1px solid rgba(128,128,128,0.2)',
        boxSizing: 'border-box',
        cursor: onClick ? 'pointer' : 'default',
        ...style
      }}
      onMouseEnter={(e) => {
        if (onClick) (e.currentTarget as HTMLDivElement).style.backgroundColor = '#26344a'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.backgroundColor = '#1e2a3a'
      }}
    >
      <span style={{ fontSize: 12 }}>🔗</span>
      <span
        style={{
          fontSize: tokens.font.sizeXs,
          fontWeight: tokens.font.weightBold,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: '#a0c4d8',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {agName}
      </span>
      <span style={{ fontSize: 10, color: tokens.color.textMuted, whiteSpace: 'nowrap' }}>
        Always On · {members.length} replicas
        {primary ? ` · primary ${primary.host ?? primary.ip}` : ''}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ServerTable — virtualised server list
// ---------------------------------------------------------------------------

export interface ServerTableProps {
  servers: StoredServer[]
  metricsMap: Record<string, ServerMetrics | undefined>
  summaries: Record<string, ServerSummary | undefined>
  alertCountByServer: Record<string, { crit: number; warn: number }>
  groupByServerKey: Record<string, ServerGroup | undefined>
  serverAliases: Record<string, string>
  now: number
  onNavigate: (id: string) => void
  onNavigateToAg: (agName: string) => void
}

export function ServerTable({
  servers,
  metricsMap,
  summaries,
  alertCountByServer,
  groupByServerKey,
  serverAliases,
  now,
  onNavigate,
  onNavigateToAg
}: ServerTableProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)

  // Cluster Always On replicas under a per-AG header; everything else stays flat.
  const rows = useMemo(() => buildDisplayRows(servers), [servers])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index].kind === 'ag' ? AG_HEADER_HEIGHT : ROW_HEIGHT),
    // Key by row identity so the size cache doesn't go stale when AG headers
    // shift index as servers come and go.
    getItemKey: (index) => rows[index].key,
    overscan: 8
  })

  return (
    <Box
      sx={{
        flex: 1,
        bgcolor: tokens.color.bgSurface,
        border: '1px solid',
        borderColor: tokens.color.bgBorder,
        borderRadius: `${tokens.radius.md}px`,
        boxShadow: tokens.shadow.elevated,
        overflow: 'hidden',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Header — outside the scroll container so it never scrolls away */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: GRID_TEMPLATE,
          flexShrink: 0
        }}
      >
        {COL_HEADERS.map((col) => (
          <div key={col} style={thStyle}>
            {col}
          </div>
        ))}
      </div>

      {/* Scroll container */}
      <div ref={parentRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {/* Total height spacer + absolutely positioned virtual rows */}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index]
            const posStyle: React.CSSProperties = {
              position: 'absolute',
              top: vRow.start,
              height: vRow.size,
              width: '100%'
            }
            if (row.kind === 'ag') {
              return (
                <AgHeaderRow
                  key={row.key}
                  agName={row.agName}
                  members={row.members}
                  metricsMap={metricsMap}
                  onClick={() => onNavigateToAg(row.agName)}
                  style={posStyle}
                />
              )
            }
            const s = row.server
            const key = serverKey(s)
            return (
              <ServerRow
                key={row.key}
                style={posStyle}
                s={s}
                m={metricsMap[key]}
                summary={summaries[key]}
                alertCount={alertCountByServer[key]}
                group={groupByServerKey[key]}
                serverAlias={serverAliases[s.id]}
                now={now}
                onNavigate={onNavigate}
              />
            )
          })}
        </div>
      </div>
    </Box>
  )
}
