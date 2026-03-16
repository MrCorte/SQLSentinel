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
import type { MetricsHistoryPoint } from '../hooks/useMetrics'

interface Props {
  history: MetricsHistoryPoint[]
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function MemoryChart({ history }: Props): React.JSX.Element {
  const data = history.map((p) => ({
    time: formatTime(p.timestamp),
    'Memoria (MB)': p.memoryUsedMb,
    'CPU (%)': p.cpuUsagePercent
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis yAxisId="mem" orientation="left" tick={{ fontSize: 11 }} unit=" MB" />
        <YAxis yAxisId="cpu" orientation="right" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
        <Tooltip />
        <Legend />
        <Line
          yAxisId="mem"
          type="monotone"
          dataKey="Memoria (MB)"
          stroke="#1976d2"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="cpu"
          type="monotone"
          dataKey="CPU (%)"
          stroke="#ed6c02"
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
