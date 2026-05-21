import { useRef } from 'react'
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
}

export function ServerTable({
  servers,
  metricsMap,
  summaries,
  alertCountByServer,
  groupByServerKey,
  serverAliases,
  now,
  onNavigate
}: ServerTableProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: servers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
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
      {/* Sticky header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: GRID_TEMPLATE,
          position: 'sticky',
          top: 0,
          zIndex: 1,
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
            const s = servers[vRow.index]
            const key = serverKey(s)
            return (
              <ServerRow
                key={s.id}
                style={{
                  position: 'absolute',
                  top: vRow.start,
                  height: vRow.size,
                  width: '100%'
                }}
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
