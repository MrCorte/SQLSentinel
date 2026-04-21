import { lazy, Suspense } from 'react'
import { Box, Tabs, Tab } from '@mui/material'
import type { ServerMetrics, CollectMetricsRequest } from '../../../preload/index'
import { tokens } from '../styles/tokens'
import { useMetricsData } from './features/metrics/useMetricsData'
import {
  TabPanoramica,
  TabDatabase,
  TabSessioni,
  TabBackup,
  TabTopQuery,
  TabWaitStats,
} from './features/metrics/MetricsTabs'

const DisksTab = lazy(() => import('./tabs/DisksTab').then((m) => ({ default: m.DisksTab })))

interface Props {
  metrics: ServerMetrics
  serverId: string
  serverDbId: string // UUID from StoredServer.id — used for persistence (≠ serverId ip:port key)
  serverNotes?: string
  connection: CollectMetricsRequest
}

export function MetricsPanel({
  metrics,
  serverId,
  serverDbId,
  serverNotes,
  connection,
}: Props): React.JSX.Element {
  const {
    tab,
    setTab,
    databases,
    editingDb,
    setEditingDb,
    handleSaveDbFields,
    topQueriesRows,
  } = useMetricsData({ metrics, serverId })

  const activeSessions = metrics?.activeSessions ?? []
  const backupStatus = metrics?.backupStatus ?? []
  const diskVolumes = metrics?.diskVolumes ?? []
  const databaseFiles = metrics?.databaseFiles ?? []
  const topQueries = metrics?.topQueries ?? []
  const waitStats = metrics?.waitStats ?? []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderBottomColor: 'divider',
        }}
      >
        <Tabs
          value={tab}
          onChange={(_e, v) => setTab(v as number)}
          sx={{
            minHeight: 36,
            '& .MuiTab-root': {
              minHeight: 36,
              fontSize: tokens.font.sizeBase,
              fontWeight: tokens.font.weightSemibold,
              color: 'text.secondary',
              py: 0,
              textTransform: 'none',
              '&.Mui-selected': { color: tokens.color.primary },
            },
            '& .MuiTabs-indicator': {
              backgroundColor: tokens.color.primary,
              height: 2,
            },
          }}
        >
          <Tab label="Panoramica" />
          <Tab label={`Database (${databases.length})`} />
          <Tab label={`Sessioni (${activeSessions.length})`} />
          <Tab label="Backup" />
          <Tab label={`Dischi (${diskVolumes.length})`} />
          <Tab label={`Top Query (${topQueries.length})`} />
          <Tab label={`Wait Stats (${waitStats.length})`} />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', pt: 2 }}>
        {tab === 0 && (
          <TabPanoramica metrics={metrics} serverDbId={serverDbId} serverNotes={serverNotes} />
        )}

        {tab === 1 && (
          <TabDatabase
            databases={databases}
            editingDb={editingDb}
            setEditingDb={setEditingDb}
            handleSaveDbFields={handleSaveDbFields}
          />
        )}

        {tab === 2 && <TabSessioni activeSessions={activeSessions} />}

        {tab === 3 && <TabBackup backupStatus={backupStatus} />}

        {tab === 4 && (
          <Suspense fallback={<Box sx={{ p: 2, color: 'text.secondary' }}>Caricamento...</Box>}>
            <DisksTab diskVolumes={diskVolumes} databaseFiles={databaseFiles} connection={connection} />
          </Suspense>
        )}

        {tab === 5 && <TabTopQuery topQueriesRows={topQueriesRows} />}

        {tab === 6 && <TabWaitStats waitStats={waitStats} />}
      </Box>
    </Box>
  )
}
