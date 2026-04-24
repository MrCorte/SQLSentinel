import { useRef, useState, memo, useEffect } from 'react'
import { alpha } from '@mui/material/styles'
import { Box, Chip, Paper, Tooltip, Typography } from '@mui/material'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useVirtualizer } from '@tanstack/react-virtual'
import { HOSTING_BADGE } from '../../../constants/hosting'
import { tokens } from '../../../styles/tokens'
import { COLUMNS, formatMb } from './inventoryTypes'
import type { InventoryRow } from './inventoryTypes'

const MIN_COL_W = 40

interface InventoryServerTableProps {
  sortedRows: InventoryRow[]
  expandedClusters: Set<string>
  expandedMachines: Set<string>
  filterType: string
  filterAlias: string
  filterReferente: string
  filterVersion: string
  sortKey: keyof InventoryRow
  sortDir: 'asc' | 'desc'
  serverAliases: Record<string, string>
  onRowClick: (row: InventoryRow) => void
  onSort: (key: keyof InventoryRow) => void
}

export const InventoryServerTable = memo(function InventoryServerTable({
  sortedRows,
  expandedClusters,
  expandedMachines,
  filterType,
  filterAlias,
  filterReferente,
  filterVersion,
  sortKey,
  sortDir,
  serverAliases,
  onRowClick,
  onSort,
}: InventoryServerTableProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<number[]>(() => COLUMNS.map((c) => c.defaultWidth))
  const colWidthsRef = useRef<number[]>(colWidths)
  colWidthsRef.current = colWidths

  // Cleanup drag listeners if the component unmounts mid-drag
  const activeListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null)
  useEffect(() => {
    return () => {
      if (activeListenersRef.current) {
        document.removeEventListener('mousemove', activeListenersRef.current.move)
        document.removeEventListener('mouseup', activeListenersRef.current.up)
      }
    }
  }, [])

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  const gridTemplate = colWidths.map((w) => `${w}px`).join(' ')
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + 32 // +32 for px:2 padding

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
      activeListenersRef.current = null
    }
    activeListenersRef.current = { move: onMove, up: onUp }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      {/* Single scroll container — X and Y together keeps header aligned with rows */}
      <Box
        ref={parentRef}
        sx={{ height: 'calc(100vh - 360px)', overflowX: 'auto', overflowY: 'auto', position: 'relative' }}
      >
        <Box sx={{ minWidth: totalWidth }}>
          {/* Sticky header */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              px: 2,
              py: 1,
              bgcolor: 'background.default',
              borderBottom: (theme) => `2px solid ${theme.palette.divider}`,
              position: 'sticky',
              top: 0,
              zIndex: 2,
            }}
          >
            {COLUMNS.map((col, idx) => {
              const active = sortKey === col.key
              return (
                <Box
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.25,
                    cursor: 'pointer',
                    userSelect: 'none',
                    position: 'relative',
                    overflow: 'hidden',
                    pr: '6px', // room for resize handle
                  }}
                >
                  <Typography
                    variant="caption"
                    fontWeight={700}
                    noWrap
                    sx={{ color: active ? tokens.color.accent : 'text.secondary' }}
                  >
                    {col.label}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: 10,
                      flexShrink: 0,
                      color: active ? tokens.color.accent : 'text.disabled',
                      opacity: active ? 1 : 0,
                      transition: 'opacity 150ms',
                      '.MuiBox-root:hover &': { opacity: active ? 1 : 0.4 },
                    }}
                  >
                    {active ? (sortDir === 'asc' ? '▲' : '▼') : '▼'}
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
              )
            })}
          </Box>

          {/* Virtual rows */}
          {sortedRows.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
              No servers match the selected filters
            </Box>
          ) : (
            <Box sx={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const row = sortedRows[vRow.index]
                const isHierarchical =
                  filterType === 'all' &&
                  filterAlias === 'all' &&
                  filterReferente === 'all' &&
                  filterVersion === 'all'
                const pl = row.depth === 1 && isHierarchical ? 4 : 2

                return (
                  <Box
                    key={row.id}
                    onClick={() => onRowClick(row)}
                    sx={{
                      position: 'absolute',
                      top: vRow.start,
                      height: vRow.size,
                      width: '100%',
                      display: 'grid',
                      gridTemplateColumns: gridTemplate,
                      alignItems: 'center',
                      px: 2,
                      pl,
                      cursor: 'pointer',
                      borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                      bgcolor: (theme) =>
                        theme.palette.mode === 'dark'
                          ? row.type === 'machine-header'
                            ? alpha(theme.palette.info.main, 0.12)
                            : row.type === 'ag-cluster'
                              ? alpha('#8b5cf6', 0.12)
                              : row.type === 'ag-replica'
                                ? alpha('#ffffff', 0.03)
                                : row.unreachable
                                  ? alpha(theme.palette.error.main, 0.2)
                                  : theme.palette.background.paper
                          : row.type === 'machine-header'
                            ? '#edf2f7'
                            : row.type === 'ag-cluster'
                              ? '#f6f4fb'
                              : row.type === 'ag-replica'
                                ? '#fafafa'
                                : row.unreachable
                                  ? '#fde7e9'
                                  : theme.palette.background.paper,
                      '&:hover': {
                        bgcolor: (theme) =>
                          theme.palette.mode === 'dark'
                            ? row.type === 'machine-header'
                              ? alpha(theme.palette.info.main, 0.22)
                              : row.type === 'ag-cluster'
                                ? alpha('#8b5cf6', 0.22)
                                : row.unreachable
                                  ? alpha(theme.palette.error.main, 0.3)
                                  : theme.palette.action.hover
                            : row.type === 'machine-header'
                              ? '#dce7f0'
                              : row.type === 'ag-cluster'
                                ? '#ede8f5'
                                : row.unreachable
                                  ? '#fad4d4'
                                  : theme.palette.action.hover,
                      },
                    }}
                  >
                    {/* ── SERVER ── */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                      {row.type === 'ag-cluster' &&
                        (expandedClusters.has(row.clusterKey!) ? (
                          <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                        ) : (
                          <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                        ))}
                      {row.type === 'machine-header' &&
                        (expandedMachines.has(row.clusterKey!) ? (
                          <ExpandMoreIcon fontSize="small" sx={{ color: '#4a6fa5', flexShrink: 0 }} />
                        ) : (
                          <ChevronRightIcon fontSize="small" sx={{ color: '#4a6fa5', flexShrink: 0 }} />
                        ))}
                      {row.type === 'ag-cluster' && (
                        <AccountTreeIcon fontSize="small" sx={{ color: '#8764b8', flexShrink: 0 }} />
                      )}
                      {row.type === 'machine-header' && (
                        <Typography sx={{ fontSize: 14, flexShrink: 0 }}>🖥</Typography>
                      )}
                      {row.type === 'ag-replica' && (
                        <Typography
                          sx={{
                            flexShrink: 0,
                            color: row.agRole === 'PRIMARY' ? '#107c10' : 'text.secondary',
                            fontSize: 12,
                          }}
                        >
                          {row.agRole === 'PRIMARY' ? '★' : '○'}
                        </Typography>
                      )}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          fontWeight={row.type === 'ag-cluster' || row.type === 'machine-header' ? 700 : 500}
                          noWrap
                          sx={row.type === 'machine-header' ? { color: '#2d5a8a' } : undefined}
                        >
                          {(row.type === 'standalone' || row.type === 'ag-replica') && row.serverId
                            ? serverAliases[row.serverId] || row.serverLabel
                            : row.serverLabel}
                        </Typography>
                        {row.type === 'ag-cluster' ? (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {row.replicaCount} replicas · Primary: {row.host || '—'}
                          </Typography>
                        ) : row.type === 'machine-header' ? (
                          <Typography variant="caption" sx={{ color: '#4a6fa5' }} noWrap>
                            {row.instanceCount} instances
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {row.port !== 1433 ? `${row.host}:${row.port}` : row.host}
                          </Typography>
                        )}
                      </Box>
                    </Box>

                    {/* ── AMBIENTE ── */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: row.envColor, flexShrink: 0 }} />
                      <Typography variant="caption" noWrap>{row.envName}</Typography>
                    </Box>

                    {/* ── TIPO ── */}
                    <Typography variant="caption">
                      {row.type === 'machine-header'
                        ? 'Multi-instance'
                        : row.type === 'standalone'
                          ? 'Standalone'
                          : row.type === 'ag-cluster'
                            ? 'AG Cluster'
                            : row.agRole === 'PRIMARY'
                              ? 'AG Primary'
                              : 'AG Secondary'}
                    </Typography>

                    {/* ── MACCHINA ── */}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                    >
                      {row.machineName || '—'}
                    </Typography>

                    {/* ── HOSTING ── */}
                    <Chip
                      label={HOSTING_BADGE[row.hostingType].label}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: 9,
                        fontWeight: 700,
                        borderRadius: '3px',
                        bgcolor: HOSTING_BADGE[row.hostingType].color,
                        color: '#fff',
                        width: 'fit-content',
                      }}
                    />

                    {/* ── DB ── */}
                    <Typography variant="body2">{row.dbCount > 0 ? row.dbCount : '—'}</Typography>

                    {/* ── ONLINE ── */}
                    <Typography variant="body2" color="success.main">
                      {row.dbCount > 0 ? row.onlineCount : '—'}
                    </Typography>

                    {/* ── OFFLINE ── */}
                    {row.offlineCount > 0 ? (
                      <Chip
                        label={row.offlineCount}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: 11,
                          fontWeight: 700,
                          bgcolor: '#a4262c',
                          color: '#fff',
                          borderRadius: '3px',
                          width: 'fit-content',
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {row.dbCount > 0 ? '0' : '—'}
                      </Typography>
                    )}

                    {/* ── DATI ── */}
                    <Typography variant="body2">
                      {row.type === 'ag-replica' && row.agRole === 'SECONDARY' ? (
                        <em style={{ color: '#aaa' }}>replica</em>
                      ) : row.totalDataMb > 0 ? (
                        formatMb(row.totalDataMb)
                      ) : (
                        '—'
                      )}
                    </Typography>

                    {/* ── VERSIONE ── */}
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {row.version || '—'}
                    </Typography>

                    {/* ── CPU ── */}
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {row.logicalCpus
                        ? row.physicalCpus
                          ? `${row.physicalCpus}C / ${row.logicalCpus}T`
                          : `${row.logicalCpus} vCPU`
                        : '—'}
                    </Typography>

                    {/* ── STATO ── */}
                    {row.type === 'ag-cluster' ? (
                      <Chip
                        label={row.agHealthy ? 'HEALTHY' : 'DEGRADED'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: '3px',
                          bgcolor: row.agHealthy ? '#107c10' : '#a4262c',
                          color: '#fff',
                          width: 'fit-content',
                        }}
                      />
                    ) : row.type === 'machine-header' ? (
                      <Chip
                        label={row.unreachable ? 'OFFLINE' : 'OK'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: '3px',
                          bgcolor: row.unreachable ? '#a4262c' : '#4a6fa5',
                          color: '#fff',
                          width: 'fit-content',
                        }}
                      />
                    ) : (
                      <Chip
                        label={row.unreachable ? 'OFFLINE' : 'ONLINE'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: '3px',
                          bgcolor: row.unreachable ? '#a4262c' : '#107c10',
                          color: '#fff',
                          width: 'fit-content',
                        }}
                      />
                    )}

                    {/* ── NOTE ── */}
                    {row.notes ? (
                      <Tooltip title={row.notes} placement="top">
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ color: 'text.secondary', cursor: 'help' }}
                        >
                          {row.notes}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>
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
