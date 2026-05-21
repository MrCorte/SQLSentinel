import { memo } from 'react'
import { Tooltip as MuiTooltip } from '@mui/material'
import { tokens } from '../../../styles/tokens'
import { HOSTING_BADGE } from '../../../constants/hosting'
import { dataAge, serverKey } from './useHomeDashboard'
import type { StoredServer, ServerMetrics } from '../../../../../preload/index'
import type { ServerSummary } from '../../../store/metricsStore'
import type { ServerGroup } from '../../../types/index'

// ---------------------------------------------------------------------------
// Column layout — shared with ServerTable header
// ---------------------------------------------------------------------------

export const GRID_TEMPLATE = '18% 12% 11% 8% 6% 6% 8% 14% 10% 7%'

// ---------------------------------------------------------------------------
// Stable style constants — defined outside component so memo stays effective
// ---------------------------------------------------------------------------

const cellBase: React.CSSProperties = {
  padding: '7px 10px',
  display: 'flex',
  alignItems: 'center',
  overflow: 'hidden'
}

const cellName: React.CSSProperties = {
  ...cellBase,
  fontWeight: tokens.font.weightSemibold
}

const cellGroup: React.CSSProperties = {
  ...cellBase,
  opacity: 0.7
}

const cellHosting: React.CSSProperties = {
  ...cellBase,
  whiteSpace: 'nowrap'
}

const cellTipo: React.CSSProperties = {
  ...cellBase,
  opacity: 0.7,
  whiteSpace: 'nowrap'
}

const cellDb: React.CSSProperties = {
  ...cellBase,
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 1
}

const cellAlerts: React.CSSProperties = {
  ...cellBase,
  flexWrap: 'wrap',
  gap: 3
}

const cellStatus: React.CSSProperties = {
  ...cellBase
}

const cellUptime: React.CSSProperties = {
  ...cellBase,
  opacity: 0.7,
  whiteSpace: 'nowrap'
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

const ellipsisSpan: React.CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%'
}

// ---------------------------------------------------------------------------
// ServerRow — memoized div-based grid row (compatible with react-virtual)
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
  /** Injected by the virtualizer (position: absolute, top, height, width) */
  style?: React.CSSProperties
}

export const ServerRow = memo(function ServerRow({
  s,
  m,
  summary,
  alertCount,
  group,
  serverAlias,
  now,
  onNavigate,
  style
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
  const rowBg = s.unreachable ? tokens.color.dangerAlpha12 : 'transparent'

  const cpuColor =
    cpu === undefined
      ? 'rgba(128,128,128,0.5)'
      : cpu >= 80
        ? '#a4262c'
        : cpu >= 60
          ? '#d83b01'
          : undefined
  const cellCpu: React.CSSProperties = {
    ...cellBase,
    color: cpuColor,
    fontWeight: cpu !== undefined && cpu >= 60 ? tokens.font.weightBold : tokens.font.weightRegular,
    whiteSpace: 'nowrap'
  }

  const cellMem: React.CSSProperties = {
    ...cellBase,
    color: memPct === null ? 'rgba(128,128,128,0.5)' : memPct >= 90 ? '#a4262c' : undefined,
    whiteSpace: 'nowrap'
  }

  return (
    <div
      onClick={() => onNavigate(s.id)}
      style={{
        display: 'grid',
        gridTemplateColumns: GRID_TEMPLATE,
        alignItems: 'center',
        backgroundColor: rowBg,
        borderBottom: '1px solid rgba(128,128,128,0.2)',
        cursor: 'pointer',
        transition: 'background-color 100ms',
        fontSize: tokens.font.sizeSm,
        boxSizing: 'border-box',
        ...style
      }}
      onMouseEnter={(e) => {
        if (!s.unreachable)
          (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(128,128,128,0.08)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.backgroundColor = rowBg
      }}
    >
      {/* SERVER */}
      <div style={cellName}>
        <MuiTooltip title={name} placement="top" arrow>
          <span style={ellipsisSpan}>{name}</span>
        </MuiTooltip>
      </div>

      {/* ENVIRONMENT */}
      <div style={cellGroup}>
        {group ? (
          <MuiTooltip title={group.name} placement="top" arrow>
            <span style={ellipsisSpan}>
              <span style={{ color: group.color }}>●</span> {group.name}
            </span>
          </MuiTooltip>
        ) : (
          '—'
        )}
      </div>

      {/* INFRASTRUCTURE */}
      <div style={cellHosting}>
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
      </div>

      {/* TYPE */}
      <div style={cellTipo}>{tipo}</div>

      {/* CPU */}
      <div style={cellCpu}>{cpu !== undefined ? `${Math.round(cpu * 10) / 10}%` : '—'}</div>

      {/* MEM */}
      <div style={cellMem}>{memPct !== null ? `${memPct}%` : '—'}</div>

      {/* DB */}
      <div style={cellDb}>
        <span>{dbCount !== null ? dbCount : '—'}</span>
        <span style={{ fontSize: 10, color: age.color, lineHeight: 1.2 }}>{age.label}</span>
      </div>

      {/* ALERTS */}
      <div style={cellAlerts}>
        {critSrv > 0 && <span style={critBadge}>{critSrv} CRIT</span>}
        {warnSrv > 0 && <span style={warnBadge}>{warnSrv} WARN</span>}
        {critSrv === 0 && warnSrv === 0 && <span style={{ opacity: 0.4 }}>—</span>}
      </div>

      {/* STATUS */}
      <div style={cellStatus}>
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
      </div>

      {/* UPTIME */}
      <div style={cellUptime}>{uptime !== undefined ? `${uptime}d` : '—'}</div>
    </div>
  )
})
