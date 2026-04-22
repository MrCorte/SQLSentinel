import { Box } from '@mui/material'
import { tokens } from '../../../styles/tokens'
import { serverKey } from './useHomeDashboard'
import { ServerRow } from './ServerRow'
import type { StoredServer, ServerMetrics } from '../../../../../preload/index'
import type { ServerSummary } from '../../../store/metricsStore'
import type { ServerGroup } from '../../../types/index'

// ---------------------------------------------------------------------------
// Column widths
// ---------------------------------------------------------------------------

const COL_WIDTHS = ['18%', '12%', '11%', '8%', '6%', '6%', '8%', '14%', '10%', '7%']
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

const thStyle: React.CSSProperties = {
  padding: '6px 8px',
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
// ServerTable — scrollable server list table
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
  return (
    <Box
      sx={{
        flex: 1,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: `${tokens.radius.md}px`,
        boxShadow: tokens.shadow.elevated,
        overflow: 'auto',
        minWidth: 0
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: tokens.font.sizeSm,
          tableLayout: 'fixed'
        }}
      >
        <colgroup>
          {COL_WIDTHS.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ position: 'sticky', top: 0, backgroundColor: 'transparent', zIndex: 1 }}>
            {COL_HEADERS.map((col) => (
              <th key={col} style={thStyle}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {servers.map((s) => {
            const key = serverKey(s)
            return (
              <ServerRow
                key={s.id}
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
        </tbody>
      </table>
    </Box>
  )
}
