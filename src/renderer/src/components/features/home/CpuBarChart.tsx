import { Box, Typography } from '@mui/material'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip
} from 'recharts'
import { tokens } from '../../../styles/tokens'

// ---------------------------------------------------------------------------
// CpuBarChart — horizontal bar chart of CPU usage per server
// ---------------------------------------------------------------------------

export interface CpuBarChartProps {
  cpuData: { name: string; cpu: number; fill: string; hasData: boolean }[]
  hasCpuData: boolean
  cpuChartHeight: number
}

export function CpuBarChart({
  cpuData,
  hasCpuData,
  cpuChartHeight
}: CpuBarChartProps): React.JSX.Element {
  return (
    <Box
      sx={{
        flex: 1,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderTop: `3px solid ${tokens.color.chartCpu}`,
        borderRadius: `${tokens.radius.md}px`,
        boxShadow: tokens.shadow.elevated,
        p: 1.5,
        minWidth: 200,
        overflow: 'hidden'
      }}
    >
      <Typography
        sx={{
          fontSize: tokens.font.sizeXs,
          fontWeight: tokens.font.weightBold,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          mb: 1
        }}
      >
        CPU % per server
      </Typography>
      {!hasCpuData ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180 }}>
          <Typography sx={{ fontSize: tokens.font.sizeBase, color: 'text.secondary' }}>
            No metrics available
          </Typography>
        </Box>
      ) : (
        <Box sx={{ overflowY: 'auto', maxHeight: 400 }}>
          <ResponsiveContainer width="100%" height={cpuChartHeight}>
            <BarChart
              layout="vertical"
              data={cpuData}
              margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid horizontal={false} stroke={tokens.color.chartGrid} />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: tokens.font.sizeXs, fill: '#94a3b8' }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: tokens.font.sizeXs, fill: '#94a3b8' }}
              />
              <Tooltip
                formatter={(value) => [`${value}%`, 'CPU']}
                contentStyle={{
                  fontSize: tokens.font.sizeSm,
                  border: '1px solid rgba(128,128,128,0.3)',
                  borderRadius: tokens.radius.sm
                }}
              />
              <Bar dataKey="cpu" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                {cpuData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  )
}
