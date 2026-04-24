import { useRef, useState, memo } from 'react'
import { Box, Chip, Paper, Tooltip, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import { useVirtualizer } from '@tanstack/react-virtual'
import { compatLevelToSqlVersion } from '../../../utils/sqlVersionUtils'
import { tokens } from '../../../styles/tokens'
import { DB_COLUMNS, formatMb } from './inventoryTypes'
import type { DbViewRow } from './inventoryTypes'

const MIN_COL_W = 40

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
  const [colWidths, setColWidths] = useState<number[]>(() => DB_COLUMNS.map((c) => c.defaultWidth))
  const colWidthsRef = useRef<number[]>(colWidths)
  colWidthsRef.current = colWidths

  const dbRowVirtualizer = useVirtualizer({
    count: displayDbViewRows.length,
    getScrollElement: () => dbParentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  const gridTemplate = colWidths.map((w) => `${w}px`).join(' ')
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + 32

  function startResize(e: React.MouseEvent, idx: number): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidthsRef.current[idx]
    function onMove(ev: MouseEvent): void {
      const newW = Math.max(MIN_COL_W, startW + ev.clientX - startX)
      setColWidths((prev) => {
        const next = [...prev]
        next[idx] = newW
        return next
      })
    }
    function onUp(): void {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      {/* Single scroll container — X and Y together keeps header aligned with rows */}
      <Box
        ref={dbParentRef}
        sx={{ height: 'calc(100vh - 380px)', overflowX: 'auto', overflowY: 'auto', position: 'relative' }}
      >
        <Box sx={{ minWidth: totalWidth }}>
          {/* Sticky header */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              px: 2,
              py: 1.5,
              bgcolor: tokens.color.bgBase,
              borderBottom: `2px solid ${tokens.color.bgBorder}`,
              position: 'sticky',
              top: 0,
              zIndex: 2,
            }}
          >
            {DB_COLUMNS.map((col, idx) => (
              <Box
                key={col.label}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  pr: '6px',
                }}
              >
                <Typography
                  variant="caption"
                  fontWeight={700}
                  noWrap
                  sx={{ color: tokens.color.textMuted }}
                >
                  {col.label}
                </Typography>
                {/* Resize handle */}
                <Box
                  onMouseDown={(e) => startResize(e, idx)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 5,
                    cursor: 'col-resize',
                    zIndex: 1,
                    borderRight: `2px solid transparent`,
                    '&:hover': {
                      borderRight: `2px solid ${tokens.color.accent}`,
                    },
                  }}
                />
              </Box>
            ))}
          </Box>

          {/* Virtual rows */}
          {displayDbViewRows.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center', color: tokens.color.textMuted }}>
              No databases match the selected filters
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
                      gridTemplateColumns: gridTemplate,
                      alignItems: 'center',
                      px: 2,
                      cursor: isHeader ? 'pointer' : 'default',
                      borderBottom: `1px solid ${tokens.color.bgBorder}`,
                      bgcolor: isHeader
                        ? tokens.color.accentAlpha12
                        : row.stateDesc !== 'ONLINE'
                          ? tokens.color.dangerAlpha12
                          : tokens.color.bgSurface,
                      '&:hover': {
                        bgcolor: isHeader ? tokens.color.accentAlpha40 : tokens.color.bgBorder,
                      },
                    }}
                  >
                    {isHeader ? (
                      <Box
                        sx={{
                          gridColumn: '1 / -1',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                        }}
                      >
                        {expandedDbServers.has(row.serverKey) ? (
                          <ExpandMoreIcon
                            fontSize="small"
                            sx={{ color: tokens.color.textMuted, flexShrink: 0 }}
                          />
                        ) : (
                          <ChevronRightIcon
                            fontSize="small"
                            sx={{ color: tokens.color.textMuted, flexShrink: 0 }}
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
                              borderColor: tokens.color.bgBorder,
                            }}
                          />
                        )}
                        <Typography variant="caption" sx={{ color: tokens.color.textMuted, ml: 1 }}>
                          {row.serverVersion}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: tokens.color.textMuted, ml: 1, flexShrink: 0 }}
                        >
                          {row.dbCount} DB
                        </Typography>
                      </Box>
                    ) : (
                      <>
                        {/* DATABASE */}
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2, minWidth: 0 }}
                        >
                          <Typography variant="body2" noWrap fontWeight={500}>
                            {row.dbName}
                          </Typography>
                          {row.isReadOnly && (
                            <Tooltip title="Read-only">
                              <Typography
                                sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}
                              >
                                R/O
                              </Typography>
                            </Tooltip>
                          )}
                        </Box>

                        {/* SERVER */}
                        <Typography variant="caption" sx={{ color: tokens.color.textMuted }} noWrap>
                          {row.serverLabel}
                        </Typography>

                        {/* ALIAS */}
                        <Typography variant="caption" sx={{ color: tokens.color.textMuted }} noWrap>
                          {row.alias ?? '—'}
                        </Typography>

                        {/* STATUS */}
                        <Tooltip title={row.stateDesc ?? ''} disableHoverListener={row.stateDesc === 'ONLINE' || row.stateDesc === 'OFFLINE'}>
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
                              maxWidth: '100%',
                            }}
                          />
                        </Tooltip>

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
                            maxWidth: '100%',
                          }}
                        />

                        {/* COMPAT */}
                        <Tooltip title={`Compatibility level ${row.compatibilityLevel ?? '—'}`}>
                          <Typography
                            variant="caption"
                            sx={{
                              color:
                                (row.compatibilityLevel ?? 999) < 130 ? tokens.color.dotWarning : tokens.color.textMuted,
                            }}
                          >
                            {row.compatibilityLevel
                              ? compatLevelToSqlVersion(row.compatibilityLevel)
                              : '—'}
                          </Typography>
                        </Tooltip>

                        {/* TDE */}
                        <Tooltip title={row.isEncrypted ? 'TDE enabled' : 'TDE disabled'}>
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            {row.isEncrypted ? (
                              <LockIcon sx={{ fontSize: 15, color: '#038387' }} />
                            ) : (
                              <LockOpenIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
                            )}
                          </Box>
                        </Tooltip>

                        {/* DATA */}
                        <Typography variant="body2">
                          {row.sizeMb ? formatMb(row.sizeMb) : '—'}
                        </Typography>

                        {/* LOG */}
                        <Typography variant="body2">
                          {row.logSizeMb ? formatMb(row.logSizeMb) : '—'}
                        </Typography>

                        {/* LAST FULL */}
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
                                ? 'Never'
                                : new Date(row.lastFullBackup!).toLocaleDateString('en-US')}
                            </Typography>
                          )
                        })()}

                        {/* LAST LOG */}
                        {(() => {
                          if (row.recoveryModel === 'SIMPLE') {
                            return (
                              <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
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
                                ? 'Never'
                                : new Date(row.lastLogBackup!).toLocaleDateString('en-US')}
                            </Typography>
                          )
                        })()}

                        {/* OWNER */}
                        <Typography variant="caption" sx={{ color: tokens.color.textMuted }} noWrap>
                          {row.owner || '—'}
                        </Typography>

                        {/* CREATED */}
                        <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
                          {row.createDate
                            ? new Date(row.createDate).toLocaleDateString('en-US')
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
      </Box>
    </Paper>
  )
})
