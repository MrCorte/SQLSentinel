import { Box, Typography } from '@mui/material'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { tokens } from '../../../styles/tokens'

// ---------------------------------------------------------------------------
// StatusDonutChart — server status pie chart with legend
// ---------------------------------------------------------------------------

export interface StatusDonutChartProps {
  totalServers: number
  donutFinal: { name: string; value: number; fill: string }[]
  onlineCount: number
  offlineCount: number
  unreachableCount: number
}

export function StatusDonutChart({
  totalServers,
  donutFinal,
  onlineCount,
  offlineCount,
  unreachableCount
}: StatusDonutChartProps): React.JSX.Element {
  return (
    <Box
      sx={{
        flex: '0 0 260px',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderTop: `3px solid ${tokens.color.primary}`,
        borderRadius: `${tokens.radius.md}px`,
        boxShadow: tokens.shadow.elevated,
        p: 1.5
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
        Server status
      </Typography>
      <Box sx={{ position: 'relative', height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={donutFinal}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              dataKey="value"
              isAnimationActive={false}
            >
              {donutFinal.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                fontSize: tokens.font.sizeSm,
                border: '1px solid rgba(128,128,128,0.3)',
                borderRadius: tokens.radius.sm
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center text overlay */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none'
          }}
        >
          <Typography
            sx={{ fontSize: 28, fontWeight: tokens.font.weightBold, color: 'text.primary', lineHeight: 1 }}
          >
            {totalServers}
          </Typography>
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: tokens.font.weightBold,
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: '0.06em'
            }}
          >
            SERVER
          </Typography>
        </Box>
      </Box>
      {/* Legend */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
        {[
          { label: 'Online', color: '#107c10', value: onlineCount },
          { label: 'Offline', color: '#a4262c', value: offlineCount },
          { label: 'Unreachable', color: '#d83b01', value: unreachableCount }
        ].map((item) => (
          <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: item.color,
                flexShrink: 0,
                boxShadow:
                  item.label === 'Online'
                    ? tokens.shadow.dotGlowSuccess
                    : item.label === 'Unreachable'
                      ? tokens.shadow.dotGlowWarning
                      : tokens.shadow.dotGlowError
              }}
            />
            <Typography sx={{ fontSize: tokens.font.sizeXs, color: 'text.secondary', flex: 1 }}>
              {item.label}
            </Typography>
            <Typography
              sx={{ fontSize: tokens.font.sizeXs, fontWeight: tokens.font.weightBold, color: 'text.primary' }}
            >
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
