import { useRef, memo } from 'react'
import { alpha } from '@mui/material/styles'
import { Box, Chip, Paper, Tooltip, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import { useVirtualizer } from '@tanstack/react-virtual'
import { compatLevelToSqlVersion } from '../../../utils/sqlVersionUtils'
import { DB_COLUMNS, DB_GRID_TEMPLATE, formatMb } from './inventoryTypes'
import type { DbViewRow } from './inventoryTypes'

interface InventoryDbTableProps {
  displayDbViewRows: DbViewRow[]
  expandedDbServers: Set<string>
  onToggleDbServer: (serverKey: string) => void
}

export const InventoryDbTable = memo(function InventoryDbTable({
  displayDbViewRows,
  expandedDbServers,
  onToggleDbServer,
}: InventoryDbTableProps) {
  const dbParentRef = useRef<HTMLDivElement>(null)

  const dbRowVirtualizer = useVirtualizer({
    count: displayDbViewRows.length,
    getScrollElement: () => dbParentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  })

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      {/* Sticky column headers */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: DB_GRID_TEMPLATE,
          px: 2,
          py: 1,
          bgcolor: 'background.default',
          borderBottom: (theme) => `2px solid ${theme.palette.divider}`,
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        {DB_COLUMNS.map((col) => (
          <Typography key={col.label} variant="caption" fontWeight={700} sx={{ color: 'text.secondary' }}>
            {col.label}
          </Typography>
        ))}
      </Box>

      <Box
        ref={dbParentRef}
        sx={{ height: 'calc(100vh - 380px)', overflowY: 'auto', position: 'relative' }}
      >
        {displayDbViewRows.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
            Nessun database corrisponde ai filtri selezionati
          </Box>
        ) : (
          <Box sx={{ height: dbRowVirtualizer.getTotalSize(), position: 'relative' }}>
            {dbRowVirtualizer.getVirtualItems().map((vRow) => {
              const row = displayDbViewRows[vRow.index]
              const isHeader = row.type === 'server-header'

              return (
                <Box
                  key={row.id}
                  onClick={() => (isHeader ? onToggleDbServer(row.serverKey) : undefined)}
                  sx={{
                    position: 'absolute',
                    top: vRow.start,
                    height: vRow.size,
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: DB_GRID_TEMPLATE,
                    alignItems: 'center',
                    px: 2,
                    cursor: isHeader ? 'pointer' : 'default',
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    bgcolor: (theme) =>
                      isHeader
                        ? theme.palette.mode === 'dark'
                          ? alpha(theme.palette.primary.main, 0.12)
                          : '#eef4fb'
                        : row.stateDesc !== 'ONLINE'
                          ? theme.palette.mode === 'dark'
                            ? alpha(theme.palette.error.main, 0.15)
                            : '#fde7e9'
                          : theme.palette.background.paper,
                    '&:hover': {
                      bgcolor: (theme) =>
                        isHeader
                          ? theme.palette.mode === 'dark'
                            ? alpha(theme.palette.primary.main, 0.22)
                            : '#dce9f5'
                          : theme.palette.action.hover,
                    },
                  }}
                >
                  {isHeader ? (
                    // Server header — spans all columns
                    <Box sx={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      {expandedDbServers.has(row.serverKey) ? (
                        <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                      ) : (
                        <ChevronRightIcon
                          fontSize="small"
                          sx={{ color: 'text.secondary', flexShrink: 0 }}
                        />
                      )}
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: row.envColor,
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="body2" fontWeight={700} noWrap sx={{ flex: 1 }}>
                        {row.serverLabel}
                      </Typography>
                      <Chip
                        label={row.unreachable ? 'OFFLINE' : 'ONLINE'}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: 9,
                          fontWeight: 700,
                          borderRadius: '3px',
                          bgcolor: row.unreachable ? '#a4262c' : '#107c10',
                          color: '#fff',
                        }}
                      />
                      {row.agRole && (
                        <Chip
                          label={row.agRole === 'PRIMARY' ? '★ PRIMARY' : '○ SECONDARY'}
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: 9,
                            fontWeight: 700,
                            borderRadius: '3px',
                            bgcolor: row.agRole === 'PRIMARY' ? '#107c10' : 'transparent',
                            color: row.agRole === 'PRIMARY' ? '#fff' : 'text.secondary',
                            border: row.agRole === 'SECONDARY' ? '1px solid' : 'none',
                            borderColor: 'divider',
                          }}
                        />
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {row.serverVersion}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: 1, flexShrink: 0 }}
                      >
                        {row.dbCount} DB
                      </Typography>
                    </Box>
                  ) : (
                    // DB row — 13 cells
                    <>
                      {/* DATABASE */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2, minWidth: 0 }}>
                        <Typography variant="body2" noWrap fontWeight={500}>
                          {row.dbName}
                        </Typography>
                        {row.isReadOnly && (
                          <Tooltip title="Sola lettura">
                            <Typography sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>
                              R/O
                            </Typography>
                          </Tooltip>
                        )}
                      </Box>

                      {/* SERVER */}
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {row.serverLabel}
                      </Typography>

                      {/* ALIAS */}
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {row.alias ?? '—'}
                      </Typography>

                      {/* STATO */}
                      <Chip
                        label={row.stateDesc ?? '—'}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: 9,
                          fontWeight: 700,
                          borderRadius: '3px',
                          bgcolor: row.stateDesc === 'ONLINE' ? '#107c10' : '#a4262c',
                          color: '#fff',
                          width: 'fit-content',
                        }}
                      />

                      {/* RECOVERY */}
                      <Chip
                        label={row.recoveryModel ?? '—'}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: 9,
                          fontWeight: 700,
                          borderRadius: '3px',
                          bgcolor:
                            row.recoveryModel === 'FULL'
                              ? '#0078d4'
                              : row.recoveryModel === 'BULK_LOGGED'
                                ? '#038387'
                                : '#737373',
                          color: '#fff',
                          width: 'fit-content',
                        }}
                      />

                      {/* COMPAT */}
                      <Tooltip title={`Compatibility level ${row.compatibilityLevel ?? '—'}`}>
                        <Typography
                          variant="caption"
                          sx={{
                            color:
                              (row.compatibilityLevel ?? 999) < 130 ? '#ca5010' : 'text.secondary',
                          }}
                        >
                          {row.compatibilityLevel
                            ? compatLevelToSqlVersion(row.compatibilityLevel)
                            : '—'}
                        </Typography>
                      </Tooltip>

                      {/* TDE */}
                      <Tooltip title={row.isEncrypted ? 'TDE attivo' : 'TDE non attivo'}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          {row.isEncrypted ? (
                            <LockIcon sx={{ fontSize: 15, color: '#038387' }} />
                          ) : (
                            <LockOpenIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
                          )}
                        </Box>
                      </Tooltip>

                      {/* DATI */}
                      <Typography variant="body2">
                        {row.sizeMb ? formatMb(row.sizeMb) : '—'}
                      </Typography>

                      {/* LOG */}
                      <Typography variant="body2">
                        {row.logSizeMb ? formatMb(row.logSizeMb) : '—'}
                      </Typography>

                      {/* ULTIMO FULL */}
                      {(() => {
                        const noBackup = !row.lastFullBackup
                        const stale =
                          !noBackup &&
                          Date.now() - new Date(row.lastFullBackup!).getTime() > 86_400_000
                        return (
                          <Typography
                            variant="caption"
                            sx={{ color: noBackup || stale ? '#a4262c' : 'text.secondary' }}
                          >
                            {noBackup
                              ? 'Mai'
                              : new Date(row.lastFullBackup!).toLocaleDateString('it-IT')}
                          </Typography>
                        )
                      })()}

                      {/* ULTIMO LOG */}
                      {(() => {
                        if (row.recoveryModel === 'SIMPLE') {
                          return (
                            <Typography variant="caption" color="text.disabled">
                              N/A
                            </Typography>
                          )
                        }
                        const noLog = !row.lastLogBackup
                        return (
                          <Typography
                            variant="caption"
                            sx={{ color: noLog ? '#d83b01' : 'text.secondary' }}
                          >
                            {noLog
                              ? 'Mai'
                              : new Date(row.lastLogBackup!).toLocaleDateString('it-IT')}
                          </Typography>
                        )
                      })()}

                      {/* OWNER */}
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {row.owner || '—'}
                      </Typography>

                      {/* CREATO */}
                      <Typography variant="caption" color="text.secondary">
                        {row.createDate
                          ? new Date(row.createDate).toLocaleDateString('it-IT')
                          : '—'}
                      </Typography>
                    </>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    </Paper>
  )
})
