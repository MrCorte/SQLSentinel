import { Box, Button, CircularProgress, Tooltip, Typography, ToggleButtonGroup, ToggleButton } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import DownloadIcon from '@mui/icons-material/Download'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import StorageIcon from '@mui/icons-material/Storage'
import { tokens } from '../styles/tokens'
import { useInventoryState } from '../components/features/inventory/useInventoryState'
import { InventoryFilters } from '../components/features/inventory/InventoryFilters'
import { InventoryDbFilters } from '../components/features/inventory/InventoryDbFilters'
import { InventoryServerTable } from '../components/features/inventory/InventoryServerTable'
import { InventoryDbTable } from '../components/features/inventory/InventoryDbTable'

// ---------------------------------------------------------------------------
// KPI card
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
// Inventory (shell)
// ---------------------------------------------------------------------------

interface InventoryProps {
  onNavigateToDashboard: () => void
}

export function Inventory({ onNavigateToDashboard }: InventoryProps): React.JSX.Element {
  const state = useInventoryState(onNavigateToDashboard)

  const {
    refreshing,
    lastRefresh,
    handleRefresh,
    dbView,
    setDbView,
    inventory,
    totals,
    // server view
    search,
    setSearch,
    filterEnv,
    setFilterEnv,
    filterType,
    setFilterType,
    filterState,
    setFilterState,
    filterHost,
    setFilterHost,
    filterAlias,
    setFilterAlias,
    filterReferente,
    setFilterReferente,
    filterVersion,
    setFilterVersion,
    sortKey,
    sortDir,
    expandedClusters,
    expandedMachines,
    allClusterKeys,
    allMachineKeys,
    sortedRows,
    filteredStats,
    hasActiveFilters,
    // db view
    dbSearch,
    setDbSearch,
    filterDbRecovery,
    setFilterDbRecovery,
    filterDbTde,
    setFilterDbTde,
    filterDbCompat,
    setFilterDbCompat,
    filterDbOffline,
    setFilterDbOffline,
    filterDbNoBackup,
    setFilterDbNoBackup,
    compatLevelOptions,
    hasActiveDbFilters,
    displayDbViewRows,
    filteredDbRows,
    allDbRows,
    allDbViewRowsExpanded,
    expandedDbServers,
    dbViewStats,
    // dropdowns
    envGroups,
    aliasOptions,
    referenteOptions,
    versionOptions,
    // handlers
    handleRowClick,
    handleToggleAll,
    handleSort,
    handleResetFilters,
    handleExportCsv,
    toggleDbServer,
    handleResetDbFilters,
    handleDbToggleAll,
  } = state

  return (
    <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto', px: 3, py: 2 }}>

        {/* ── Top bar ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary', flex: 1 }}>
            Inventario SQL Server
          </Typography>
          {lastRefresh && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Aggiornato: {lastRefresh.toLocaleTimeString('it-IT')}
            </Typography>
          )}
          <Tooltip title="Esporta CSV">
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleExportCsv}
                disabled={inventory.groups.length === 0}
                sx={{ fontSize: 12 }}
              >
                Esporta CSV
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Aggiorna metriche da tutti i server">
            <span>
              <Button
                size="small"
                variant="contained"
                startIcon={
                  refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />
                }
                onClick={handleRefresh}
                disabled={refreshing}
                sx={{ fontSize: 12, bgcolor: tokens.color.primary }}
              >
                {refreshing ? 'Aggiornamento…' : 'Aggiorna'}
              </Button>
            </span>
          </Tooltip>
        </Box>

        {/* ── View toggle ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
          <ToggleButtonGroup
            value={dbView ? 'db' : 'server'}
            exclusive
            onChange={(_e, v) => {
              if (v) setDbView(v === 'db')
            }}
            size="small"
          >
            <ToggleButton value="server" sx={{ fontSize: 12, px: 1.5, gap: 0.5 }}>
              <AccountTreeIcon sx={{ fontSize: 15 }} /> Server View
            </ToggleButton>
            <ToggleButton value="db" sx={{ fontSize: 12, px: 1.5, gap: 0.5 }}>
              <StorageIcon sx={{ fontSize: 15 }} /> DB View
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

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
            <KpiCard
              label="Online"
              value={String(filteredStats.onlineDbs)}
              accentColor="#107c10"
            />
            <KpiCard
              label="Offline"
              value={String(filteredStats.offlineDbs)}
              accentColor={filteredStats.offlineDbs > 0 ? '#a4262c' : '#107c10'}
            />
          </Box>
        )}
        {dbView && (
          <Box sx={{ display: 'flex', gap: 1.5, mb: hasActiveDbFilters ? 1 : 3, flexWrap: 'wrap' }}>
            <KpiCard
              label="DB Totali"
              value={String(dbViewStats.total)}
              accentColor="#0078d4"
            />
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
        {inventory.groups.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
            <Typography sx={{ fontSize: 14 }}>
              Nessun server monitorato. Aggiungi server dalla sezione Discovery.
            </Typography>
          </Box>
        )}

        {/* ── DB View ── */}
        {dbView && inventory.groups.length > 0 && (
          <>
            <InventoryDbFilters
              dbSearch={dbSearch}
              onDbSearchChange={setDbSearch}
              filterDbRecovery={filterDbRecovery}
              onFilterDbRecoveryChange={setFilterDbRecovery}
              filterDbTde={filterDbTde}
              onFilterDbTdeChange={setFilterDbTde}
              filterDbCompat={filterDbCompat}
              onFilterDbCompatChange={setFilterDbCompat}
              filterDbOffline={filterDbOffline}
              onFilterDbOfflineToggle={() => setFilterDbOffline((v) => !v)}
              filterDbNoBackup={filterDbNoBackup}
              onFilterDbNoBackupToggle={() => setFilterDbNoBackup((v) => !v)}
              compatLevelOptions={compatLevelOptions}
              expandedDbServers={expandedDbServers}
              onToggleAll={handleDbToggleAll}
              onReset={handleResetDbFilters}
              allDbViewRowsExpanded={allDbViewRowsExpanded}
              filteredDbRows={filteredDbRows}
            />
            <InventoryDbTable
              displayDbViewRows={displayDbViewRows}
              expandedDbServers={expandedDbServers}
              onToggleDbServer={toggleDbServer}
            />
          </>
        )}

        {/* ── Server View ── */}
        {!dbView && inventory.groups.length > 0 && (
          <>
            <InventoryFilters
              search={search}
              onSearchChange={setSearch}
              filterEnv={filterEnv}
              onFilterEnvChange={setFilterEnv}
              filterType={filterType}
              onFilterTypeChange={setFilterType}
              filterState={filterState}
              onFilterStateChange={setFilterState}
              filterHost={filterHost}
              onFilterHostChange={setFilterHost}
              filterAlias={filterAlias}
              onFilterAliasChange={setFilterAlias}
              filterReferente={filterReferente}
              onFilterReferenteChange={setFilterReferente}
              filterVersion={filterVersion}
              onFilterVersionChange={setFilterVersion}
              envGroups={envGroups}
              aliasOptions={aliasOptions}
              referenteOptions={referenteOptions}
              versionOptions={versionOptions}
              allClusterKeys={allClusterKeys}
              allMachineKeys={allMachineKeys}
              expandedClusters={expandedClusters}
              expandedMachines={expandedMachines}
              onToggleAll={handleToggleAll}
              onReset={handleResetFilters}
              sortedRows={sortedRows}
            />
            <InventoryServerTable
              sortedRows={sortedRows}
              expandedClusters={expandedClusters}
              expandedMachines={expandedMachines}
              filterType={filterType}
              filterAlias={filterAlias}
              filterReferente={filterReferente}
              filterVersion={filterVersion}
              sortKey={sortKey}
              sortDir={sortDir}
              onRowClick={handleRowClick}
              onSort={handleSort}
            />
          </>
        )}

      </Box>
    </Box>
  )
}
