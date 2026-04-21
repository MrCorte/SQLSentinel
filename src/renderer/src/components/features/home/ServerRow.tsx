import { memo } from 'react'
import { Tooltip as MuiTooltip } from '@mui/material'
import { tokens } from '../../../styles/tokens'
import { HOSTING_BADGE } from '../../../constants/hosting'
import { dataAge, serverKey } from './useHomeDashboard'
import type { StoredServer, ServerMetrics } from '../../../../../preload/index'
import type { ServerSummary } from '../../../store/metricsStore'
import type { ServerGroup } from '../../../types/index'

// ---------------------------------------------------------------------------
// Stable style constants — defined outside component so memo stays effective
// ---------------------------------------------------------------------------

const tdBase: React.CSSProperties = {
  padding: '5px 8px',
  borderBottom: '1px solid rgba(128,128,128,0.2)'
}

const tdNameStyle: React.CSSProperties = {
  ...tdBase,
  fontWeight: tokens.font.weightSemibold,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const tdGroupStyle: React.CSSProperties = {
  ...tdBase,
  opacity: 0.7,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const tdHostingStyle: React.CSSProperties = {
  ...tdBase,
  whiteSpace: 'nowrap'
}

const tdTipoStyle: React.CSSProperties = {
  ...tdBase,
  opacity: 0.7,
  whiteSpace: 'nowrap'
}

const tdDbStyle: React.CSSProperties = {
  ...tdBase,
  whiteSpace: 'nowrap'
}

const tdAlertsStyle: React.CSSProperties = {
  ...tdBase
}

const tdStatusStyle: React.CSSProperties = {
  ...tdBase,
  overflow: 'hidden'
}

const tdUptimeStyle: React.CSSProperties = {
  ...tdBase,
  opacity: 0.7,
  whiteSpace: 'nowrap'
}

const ellipsisSpan: React.CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const alertsWrap: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '3px',
  alignItems: 'center',
  minWidth: 0
}

const critBadge: React.CSSProperties = {
  color: '#fff',
  background: '#a4262c',
  borderRadius: 3,
  padding: '1px 5px',
  fontSize: 10,
  fontWeight: tokens.font.weightBold,
  whiteSpace: 'nowrap'
}

const warnBadge: React.CSSProperties = {
  color: '#fff',
  background: '#d83b01',
  borderRadius: 3,
  padding: '1px 5px',
  fontSize: 10,
  fontWeight: tokens.font.weightBold,
  whiteSpace: 'nowrap'
}

const dbAgeWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px'
}

// ---------------------------------------------------------------------------
// ServerRow — memoized table row
// Re-renders only when its own server data changes (Immer structural sharing).
// ---------------------------------------------------------------------------

export interface ServerRowProps {
  s: StoredServer
  m: ServerMetrics | undefined
  summary: ServerSummary | undefined
  alertCount: { crit: number; warn: number } | undefined
  group: ServerGroup | undefined
  serverAlias: string | undefined
  now: number
  onNavigate: (id: string) => void
}

export const ServerRow = memo(function ServerRow({
  s,
  m,
  summary,
  alertCount,
  group,
  serverAlias,
  now,
  onNavigate
}: ServerRowProps): React.JSX.Element {
  const key = serverKey(s)
  const name = serverAlias || s.host || s.ip || key
  const cpu = m?.instanceInfo?.cpuUsagePercent
  const memPct = m
    ? Math.round((m.instanceInfo.memoryUsedMb / m.instanceInfo.memoryTargetMb) * 100)
    : null
  const dbCount = summary?.dbCount ?? null
  const age = dataAge(summary?.collectedAt, now)
  const critSrv = alertCount?.crit ?? 0
  const warnSrv = alertCount?.warn ?? 0
  const tipo = s.agGroupId
    ? s.agRole === 'PRIMARY'
      ? 'AG PRI'
      : s.agRole === 'SECONDARY'
        ? 'AG SEC'
        : 'AG RES'
    : 'Standalone'
  const uptime = m?.instanceInfo?.uptimeDays
  const rowBg = s.unreachable ? '#fde7e9' : 'transparent'

  const tdCpuStyle: React.CSSProperties = {
    ...tdBase,
    color:
      cpu === undefined
        ? 'rgba(128,128,128,0.5)'
        : cpu >= 80
          ? '#a4262c'
          : cpu >= 60
            ? '#d83b01'
            : undefined,
    fontWeight: cpu !== undefined && cpu >= 60 ? tokens.font.weightBold : tokens.font.weightRegular,
    whiteSpace: 'nowrap'
  }

  const tdMemStyle: React.CSSProperties = {
    ...tdBase,
    color:
      memPct === null ? 'rgba(128,128,128,0.5)' : memPct >= 90 ? '#a4262c' : undefined,
    whiteSpace: 'nowrap'
  }

  return (
    <tr
      onClick={() => onNavigate(s.id)}
      style={{ backgroundColor: rowBg, cursor: 'pointer', transition: 'background-color 100ms' }}
      onMouseEnter={(e) => {
        if (!s.unreachable)
          (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'rgba(128,128,128,0.08)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = rowBg
      }}
    >
      <td style={tdNameStyle}>
        <MuiTooltip title={name} placement="top" arrow>
          <span style={ellipsisSpan}>{name}</span>
        </MuiTooltip>
      </td>
      <td style={tdGroupStyle}>
        {group ? (
          <MuiTooltip title={group.name} placement="top" arrow>
            <span style={ellipsisSpan}>
              <span style={{ color: group.color }}>●</span> {group.name}
            </span>
          </MuiTooltip>
        ) : (
          '—'
        )}
      </td>
      <td style={tdHostingStyle}>
        {(() => {
          const hBadge = HOSTING_BADGE[s.hostingType ?? 'on-premise']
          return (
            <span
              style={{
                display: 'inline-block',
                backgroundColor: hBadge.color,
                color: '#fff',
                fontWeight: tokens.font.weightBold,
                fontSize: 10,
                borderRadius: 3,
                padding: '1px 5px'
              }}
            >
              {hBadge.label}
            </span>
          )
        })()}
      </td>
      <td style={tdTipoStyle}>{tipo}</td>
      <td style={tdCpuStyle}>{cpu !== undefined ? `${Math.round(cpu * 10) / 10}%` : '—'}</td>
      <td style={tdMemStyle}>{memPct !== null ? `${memPct}%` : '—'}</td>
      <td style={tdDbStyle}>
        <div style={dbAgeWrap}>
          <span>{dbCount !== null ? dbCount : '—'}</span>
          <span style={{ fontSize: 10, color: age.color, lineHeight: 1.2 }}>{age.label}</span>
        </div>
      </td>
      <td style={tdAlertsStyle}>
        <div style={alertsWrap}>
          {critSrv > 0 && <span style={critBadge}>{critSrv} CRIT</span>}
          {warnSrv > 0 && <span style={warnBadge}>{warnSrv} WARN</span>}
          {critSrv === 0 && warnSrv === 0 && <span style={{ opacity: 0.4 }}>—</span>}
        </div>
      </td>
      <td style={tdStatusStyle}>
        {s.unreachable ? (
          <span
            style={{
              ...ellipsisSpan,
              color: '#a4262c',
              fontWeight: tokens.font.weightBold,
              fontSize: tokens.font.sizeXs
            }}
          >
            ● OFFLINE
          </span>
        ) : m ? (
          <span
            style={{
              ...ellipsisSpan,
              color: '#107c10',
              fontWeight: tokens.font.weightBold,
              fontSize: tokens.font.sizeXs
            }}
          >
            ● ONLINE
          </span>
        ) : (
          <span style={{ ...ellipsisSpan, opacity: 0.4, fontSize: tokens.font.sizeXs }}>
            ● UNKNOWN
          </span>
        )}
      </td>
      <td style={tdUptimeStyle}>{uptime !== undefined ? `${uptime}d` : '—'}</td>
    </tr>
  )
})
