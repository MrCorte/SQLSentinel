import { memo, useMemo } from 'react'
import { Box, Typography, Alert } from '@mui/material'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts'
import { useShallow } from 'zustand/react/shallow'
import { useMetricsStore } from '../store/metricsStore'
import { tokens } from '../styles/tokens'

function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(ts))
}

interface Props {
  serverId: string
}

const EMPTY_HISTORY: { ts: number; value: number }[] = []

export const ServerHistoryChart = memo(function ServerHistoryChart({ serverId }: Props) {
  const { cpuHistory, memHistory } = useMetricsStore(
    useShallow((s) => ({
      cpuHistory: s.historyMap[serverId]?.cpu ?? EMPTY_HISTORY,
      memHistory: s.historyMap[serverId]?.memory ?? EMPTY_HISTORY
    }))
  )

  // Derive unreachable from health circuit-breaker (failCount ≥ 3)
  const isUnreachable = useMetricsStore((s) => (s.serverHealth[serverId]?.failCount ?? 0) >= 3)

  // Absolute MB for the tooltip — from the summary (lightweight, always up to date)
  const memoryUsedMb = useMetricsStore((s) => s.summaries[serverId]?.memoryUsedMb ?? null)

  const chartData = useMemo(() => {
    const memMap = new Map(memHistory.map((p) => [p.ts, p.value]))
    return cpuHistory.map((point) => ({
      label: fmtTime(point.ts),
      cpu: Math.round(point.value),
      memory: Math.round(memMap.get(point.ts) ?? 0)
    }))
  }, [cpuHistory, memHistory])

  // ── Empty states ─────────────────────────────────────────────────────────

  if (isUnreachable) {
    return (
      <Alert severity="warning" sx={{ my: 1 }}>
        Server unreachable — history not available
      </Alert>
    )
  }

  if (chartData.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 160,
          color: tokens.color.textMuted,
          fontSize: 13
        }}
      >
        Waiting for the first sample…
      </Box>
    )
  }

  // ── Grafico ──────────────────────────────────────────────────────────────

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={tokens.color.chartGrid} />

        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />

        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `${v}%`}
          width={38}
        />

        {/* CPU warning threshold */}
        <ReferenceLine
          y={80}
          stroke={tokens.color.warning}
          strokeDasharray="4 4"
          label={{
            value: '80%',
            fontSize: tokens.font.sizeXs,
            fill: tokens.color.warning,
            position: 'insideTopRight'
          }}
        />

        <Tooltip
          formatter={(value, name) => {
            const pct = typeof value === 'number' ? value : 0
            if (name === 'memory') {
              const mbLabel =
                memoryUsedMb != null ? ` (${memoryUsedMb.toLocaleString('en-US')} MB)` : ''
              return [`${pct}%${mbLabel}`, 'Memory'] as [string, string]
            }
            return [`${pct}%`, 'CPU'] as [string, string]
          }}
          labelFormatter={(label) => `Ore ${label}`}
          contentStyle={{ fontSize: 12 }}
        />

        <Legend
          formatter={(name) => (name === 'cpu' ? 'CPU %' : 'Memoria %')}
          wrapperStyle={{ fontSize: 12 }}
        />

        <Line
          type="monotone"
          dataKey="cpu"
          stroke={tokens.color.chartCpu}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />

        <Line
          type="monotone"
          dataKey="memory"
          stroke={tokens.color.chartMemory}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
})

// Re-export a helper so callers can read the current sample count
export function useHistoryLength(serverId: string): number {
  return useMetricsStore((s) => s.historyMap[serverId]?.cpu?.length ?? 0)
}

// Nominal type annotation for clarity in JSX usage
export type { Props as ServerHistoryChartProps }

/**
 * Standalone section wrapper — used by ServerDashboard to render the chart
 * with a labelled Paper container.
 */
export function ServerHistorySection({ serverId }: { serverId: string }): React.JSX.Element {
  const sampleCount = useHistoryLength(serverId)

  return (
    <>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        Storico CPU / Memoria
        <Typography component="span" variant="caption" sx={{ ml: 1, color: tokens.color.textMuted }}>
          ultimi {sampleCount} campioni · aggiornamento ogni 60&nbsp;s
        </Typography>
      </Typography>

      <ServerHistoryChart serverId={serverId} />
    </>
  )
}
