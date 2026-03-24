import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import { Box } from '@mui/material'
import type { MetricsHistoryPoint } from '../hooks/useMetrics'
import { tokens } from '../styles/tokens'

interface Props {
  history: MetricsHistoryPoint[]
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function MemoryChart({ history }: Props): React.JSX.Element {
  console.log(
    '[MemoryChart] render — punti:',
    history.length,
    history.length > 0
      ? `ultimo cpu=${history[history.length - 1].cpuUsagePercent.toFixed(1)}%`
      : ''
  )
  const data = history.map((p) => ({
    time: formatTime(p.timestamp),
    'CPU %': parseFloat(p.cpuUsagePercent.toFixed(1)),
    'Memoria %': parseFloat(p.memoryPercent.toFixed(1))
  }))

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: tokens.radius.sm,
        p: 1.5
      }}
    >
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.color.chartGrid} />
          <XAxis dataKey="time" tick={{ fontSize: tokens.font.sizeXs }} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} tick={{ fontSize: tokens.font.sizeXs }} unit="%" width={40} />
          <Tooltip
            formatter={(value, name) => [`${Number(value).toFixed(1)} %`, name as string]}
            contentStyle={{
              fontSize: tokens.font.sizeSm,
              border: '1px solid rgba(128,128,128,0.3)',
              borderRadius: tokens.radius.sm
            }}
          />
          <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: tokens.font.sizeSm }} />
          <Line
            type="monotone"
            dataKey="CPU %"
            stroke={tokens.color.chartCpu}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="Memoria %"
            stroke={tokens.color.chartMemory}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  )
}
