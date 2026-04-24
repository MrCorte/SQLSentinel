import { Box } from '@mui/material'
import { StatusDonutChart } from './StatusDonutChart'
import { CpuBarChart, type CpuBarChartProps } from './CpuBarChart'
import { AlertsRecapCard } from './AlertsRecapCard'

const CPU_CHART_HEIGHT = 220

export interface DashboardChartsProps {
  totalServers: number
  donutFinal: { name: string; value: number; fill: string }[]
  onlineCount: number
  offlineCount: number
  unreachableCount: number
  cpuData: CpuBarChartProps['cpuData']
  hasCpuData: boolean
}

export function DashboardCharts({
  totalServers,
  donutFinal,
  onlineCount,
  offlineCount,
  unreachableCount,
  cpuData,
  hasCpuData
}: DashboardChartsProps): React.JSX.Element {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr 1.75fr 2.25fr',
        gap: 1.5,
        flexShrink: 0
      }}
    >
      <StatusDonutChart
        totalServers={totalServers}
        donutFinal={donutFinal}
        onlineCount={onlineCount}
        offlineCount={offlineCount}
        unreachableCount={unreachableCount}
      />
      <CpuBarChart cpuData={cpuData} hasCpuData={hasCpuData} cpuChartHeight={CPU_CHART_HEIGHT} />
      <AlertsRecapCard />
    </Box>
  )
}
