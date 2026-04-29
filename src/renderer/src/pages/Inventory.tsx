import { Box } from '@mui/material'
import { useInventoryState } from '../components/features/inventory/useInventoryState'
import { InventoryFilters } from '../components/features/inventory/InventoryFilters'
import { InventoryDbFilters } from '../components/features/inventory/InventoryDbFilters'
import { InventoryServerTable } from '../components/features/inventory/InventoryServerTable'
import { InventoryDbTable } from '../components/features/inventory/InventoryDbTable'
import { InventoryTopBar } from '../components/features/inventory/InventoryTopBar'
import { InventoryKpiRow } from '../components/features/inventory/InventoryKpiRow'

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
    serverAliases,
    // server view
    search,
    setSearch,
    filterDbName,
    setFilterDbName,
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
    handleDbToggleAll
  } = state

  return (
    <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto', px: 3, py: 2 }}>
        <InventoryTopBar
          refreshing={refreshing}
          lastRefresh={lastRefresh}
          dbView={dbView}
          onSetDbView={setDbView}
          inventoryEmpty={inventory.groups.length === 0}
          onExportCsv={handleExportCsv}
          onRefresh={handleRefresh}
        />

        <InventoryKpiRow
          dbView={dbView}
          filteredStats={filteredStats}
          dbViewStats={dbViewStats}
          totals={totals}
          hasActiveFilters={hasActiveFilters}
          hasActiveDbFilters={hasActiveDbFilters}
          filteredDbRows={filteredDbRows}
          allDbRows={allDbRows}
          inventoryEmpty={inventory.groups.length === 0}
        />

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
              filterDbName={filterDbName}
              onFilterDbNameChange={setFilterDbName}
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
              serverAliases={serverAliases}
              onRowClick={handleRowClick}
              onSort={handleSort}
            />
          </>
        )}
      </Box>
    </Box>
  )
}
