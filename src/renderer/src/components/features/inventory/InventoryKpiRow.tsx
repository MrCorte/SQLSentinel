import { memo } from 'react'
import { Box, Typography } from '@mui/material'
import type { FilteredStats, DbViewStats } from './useInventoryState'
import type { DbViewRow } from './inventoryTypes'

// ---------------------------------------------------------------------------
// KPI card primitive
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string
  value: string
  accentColor: string
}

function KpiCard({ label, value, accentColor }: KpiCardProps): React.JSX.Element {
  return (
    <Box
      sx={{
        flex: '1 1 0',
        minWidth: 100,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderTop: `3px solid ${accentColor}`,
        borderRadius: '4px',
        px: 2,
        py: 1.5,
      }}
    >
      <Typography
        sx={{
          fontSize: 10,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          mb: 0.5,
        }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'text.primary', lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// InventoryKpiRow
// ---------------------------------------------------------------------------

interface InventoryKpiRowProps {
  dbView: boolean
  filteredStats: FilteredStats
  dbViewStats: DbViewStats
  totals: { servers: number }
  hasActiveFilters: boolean
  hasActiveDbFilters: boolean
  filteredDbRows: DbViewRow[]
  allDbRows: DbViewRow[]
  inventoryEmpty: boolean
}

export const InventoryKpiRow = memo(function InventoryKpiRow({
  dbView,
  filteredStats,
  dbViewStats,
  totals,
  hasActiveFilters,
  hasActiveDbFilters,
  filteredDbRows,
  allDbRows,
  inventoryEmpty,
}: InventoryKpiRowProps): React.JSX.Element {
  return (
    <>
      {/* ── KPI cards ── */}
      {!dbView && (
        <Box sx={{ display: 'flex', gap: 1.5, mb: hasActiveFilters ? 1 : 3, flexWrap: 'wrap' }}>
          <KpiCard label="Server" value={String(filteredStats.servers)} accentColor="#0078d4" />
          <KpiCard
            label="Standalone"
            value={String(filteredStats.standalone)}
            accentColor="#0078d4"
          />
          <KpiCard
            label="AG Cluster"
            value={
              filteredStats.agClusters > 0
                ? `${filteredStats.agClusters} (${filteredStats.agServers} nodi)`
                : '0'
            }
            accentColor="#8764b8"
          />
          <KpiCard
            label="Database"
            value={String(filteredStats.databases)}
            accentColor="#0078d4"
          />
          <KpiCard label="Online" value={String(filteredStats.onlineDbs)} accentColor="#107c10" />
          <KpiCard
            label="Offline"
            value={String(filteredStats.offlineDbs)}
            accentColor={filteredStats.offlineDbs > 0 ? '#a4262c' : '#107c10'}
          />
        </Box>
      )}
      {dbView && (
        <Box sx={{ display: 'flex', gap: 1.5, mb: hasActiveDbFilters ? 1 : 3, flexWrap: 'wrap' }}>
          <KpiCard label="DB Totali" value={String(dbViewStats.total)} accentColor="#0078d4" />
          <KpiCard label="Online" value={String(dbViewStats.online)} accentColor="#107c10" />
          <KpiCard
            label="Offline"
            value={String(dbViewStats.offline)}
            accentColor={dbViewStats.offline > 0 ? '#a4262c' : '#107c10'}
          />
          <KpiCard
            label="Full Recovery"
            value={String(dbViewStats.fullRecovery)}
            accentColor="#0078d4"
          />
          <KpiCard
            label="TDE Attivo"
            value={String(dbViewStats.tdeActive)}
            accentColor="#038387"
          />
          <KpiCard
            label="Senza Backup"
            value={String(dbViewStats.noBackup)}
            accentColor={dbViewStats.noBackup > 0 ? '#d83b01' : '#107c10'}
          />
          <KpiCard
            label="Compat < 2016"
            value={String(dbViewStats.oldCompat)}
            accentColor={dbViewStats.oldCompat > 0 ? '#ca5010' : '#107c10'}
          />
        </Box>
      )}

      {/* ── Filter indicator ── */}
      {!dbView && hasActiveFilters && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Risultati filtrati: {filteredStats.servers} di {totals.servers} server
        </Typography>
      )}
      {dbView && hasActiveDbFilters && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Risultati filtrati: {filteredDbRows.length} di {allDbRows.length} database
        </Typography>
      )}

      {/* ── Empty placeholder ── */}
      {inventoryEmpty && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <Typography sx={{ fontSize: 14 }}>
            Nessun server monitorato. Aggiungi server dalla sezione Discovery.
          </Typography>
        </Box>
      )}
    </>
  )
})
