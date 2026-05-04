import { useMemo, useState } from 'react'
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Divider,
  Stack,
  Chip,
  Button
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import type { Alert } from '../../../preload/index'
import { tokens } from '../styles/tokens'

type SeverityFilter = 'all' | 'CRITICAL' | 'WARNING'
type CategoryFilter = 'all' | Alert['category']

interface Props {
  open: boolean
  alerts: Alert[]
  onClose: () => void
  onAcknowledge: (alertId: string) => void
}

function categoryLabel(cat: Alert['category']): string {
  switch (cat) {
    case 'cpu_high':
      return 'CPU'
    case 'blocking_sessions':
      return 'Blocking'
    case 'database_offline':
      return 'DB Offline'
    case 'backup_overdue':
      return 'Backup'
    case 'disk_space_low':
      return 'Disk'
  }
}

function SectionHeader({ label }: { label: string }): React.JSX.Element {
  return (
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        px: 2,
        py: 0.75,
        fontSize: tokens.font.sizeXs,
        fontWeight: tokens.font.weightSemibold,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: tokens.color.textMuted,
        bgcolor: tokens.color.bgBase,
        borderBottom: '1px solid',
        borderBottomColor: tokens.color.bgBorder
      }}
    >
      {label}
    </Typography>
  )
}

function AlertRow({
  alert,
  onAcknowledge
}: {
  alert: Alert & { _dupCount?: number }
  onAcknowledge: (id: string) => void
}): React.JSX.Element {
  const isCritical = alert.severity === 'CRITICAL'
  const isAcknowledged = alert.acknowledgedAt !== null
  const accentColor = isCritical ? tokens.color.danger : tokens.color.warning
  const dupCount = alert._dupCount ?? 0

  return (
    <ListItem
      alignItems="flex-start"
      sx={{
        opacity: isAcknowledged ? 0.55 : 1,
        borderLeft: `3px solid ${accentColor}`,
        bgcolor: tokens.color.bgSurface,
        mb: 0.5,
        pr: 2,
        flexDirection: 'column',
        alignItems: 'flex-start'
      }}
    >
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
            <Typography
              component="span"
              sx={{
                fontSize: tokens.font.sizeXs,
                fontWeight: tokens.font.weightSemibold,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: accentColor
              }}
            >
              {isCritical ? 'CRITICAL' : 'WARNING'}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontSize: tokens.font.sizeXs,
                fontWeight: tokens.font.weightSemibold,
                color: tokens.color.textMuted,
                bgcolor: tokens.color.bgBase,
                px: 0.75,
                py: 0.125,
                borderRadius: tokens.radius.sm
              }}
            >
              {categoryLabel(alert.category)}
            </Typography>
            <Typography
              component="span"
              sx={{ fontSize: tokens.font.sizeXs, color: tokens.color.textMuted }}
            >
              {alert.serverId}
            </Typography>
            {dupCount > 1 && (
              <Typography
                component="span"
                aria-label={`${dupCount} similar alerts in the last hour`}
                sx={{
                  fontSize: tokens.font.sizeXs,
                  fontWeight: tokens.font.weightSemibold,
                  color: 'common.white',
                  bgcolor: accentColor,
                  px: 0.75,
                  py: 0.125,
                  borderRadius: tokens.radius.sm
                }}
              >
                ×{dupCount}
              </Typography>
            )}
          </Stack>
        }
        secondary={
          <>
            <Typography
              component="span"
              sx={{
                display: 'block',
                fontSize: tokens.font.sizeSm,
                color: tokens.color.textPrimary,
                mb: 0.5
              }}
            >
              {alert.message}
            </Typography>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography
                component="span"
                sx={{ fontSize: tokens.font.sizeXs, color: tokens.color.textMuted }}
              >
                {new Date(alert.detectedAt).toLocaleString('en-US')}
              </Typography>
              {!isAcknowledged && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => onAcknowledge(alert.id)}
                  sx={{ minWidth: 'auto', p: 0.25, fontSize: tokens.font.sizeXs }}
                  aria-label={`Acknowledge ${alert.severity} alert ${alert.message}`}
                >
                  Acknowledge
                </Button>
              )}
            </Stack>
          </>
        }
        secondaryTypographyProps={{ component: 'div' }}
      />
    </ListItem>
  )
}

export function AlertsDrawer({ open, alerts, onClose, onAcknowledge }: Props): React.JSX.Element {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [dedup, setDedup] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('sqlsentinel:alerts:dedup') === '1'
    } catch {
      return false
    }
  })
  const setDedupPersist = (next: boolean): void => {
    setDedup(next)
    try {
      sessionStorage.setItem('sqlsentinel:alerts:dedup', next ? '1' : '0')
    } catch {
      // non-fatal
    }
  }

  const openAlerts = useMemo(() => alerts.filter((a) => a.acknowledgedAt === null), [alerts])
  const acked = useMemo(() => alerts.filter((a) => a.acknowledgedAt !== null), [alerts])

  // Available category facets — derived from the current open alert set
  const availableCategories = useMemo(() => {
    const set = new Set<Alert['category']>()
    for (const a of openAlerts) set.add(a.category)
    return Array.from(set)
  }, [openAlerts])

  const matchesFilters = (a: Alert): boolean => {
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false
    if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
    return true
  }

  const filteredOpen = useMemo(() => openAlerts.filter(matchesFilters), [
    openAlerts,
    severityFilter,
    categoryFilter
  ])

  // When dedup is on, collapse alerts that share serverId+category and were
  // detected in the last 60 minutes into a single representative alert (the
  // most recent), augmented with a `_dupCount` so the row can render the count.
  const dedupedOpen = useMemo(() => {
    if (!dedup) return filteredOpen
    const ONE_HOUR = 60 * 60 * 1000
    const now = Date.now()
    const groups = new Map<string, Array<Alert>>()
    for (const a of filteredOpen) {
      const ts = new Date(a.detectedAt).getTime()
      const key =
        now - ts < ONE_HOUR ? `${a.serverId}::${a.category}` : `solo:${a.id}`
      const list = groups.get(key) ?? []
      list.push(a)
      groups.set(key, list)
    }
    const out: Array<Alert & { _dupCount?: number }> = []
    for (const list of groups.values()) {
      list.sort(
        (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
      )
      const head = list[0]
      out.push(list.length > 1 ? { ...head, _dupCount: list.length } : head)
    }
    return out
  }, [filteredOpen, dedup])

  const criticalFirst = useMemo(
    () =>
      [...dedupedOpen].sort((a, b) => {
        if (a.severity === 'CRITICAL' && b.severity !== 'CRITICAL') return -1
        if (b.severity === 'CRITICAL' && a.severity !== 'CRITICAL') return 1
        return 0
      }),
    [dedupedOpen]
  )

  const handleAckAll = (): void => {
    // Snapshot ids first — onAcknowledge mutates the parent state which would
    // shrink the source array under iteration.
    const ids = criticalFirst.map((a) => a.id)
    for (const id of ids) onAcknowledge(id)
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: tokens.size.alertsDrawerWidth,
          bgcolor: tokens.color.bgBase,
          boxShadow: tokens.shadow.drawer
        }
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            px: 2,
            height: 48,
            minHeight: 48,
            bgcolor: tokens.color.bgSurface,
            borderBottom: '1px solid',
            borderBottomColor: tokens.color.bgBorder
          }}
        >
          <Typography
            sx={{
              flex: 1,
              fontSize: tokens.font.sizeMd,
              fontWeight: tokens.font.weightSemibold,
              color: tokens.color.textPrimary
            }}
          >
            Active alerts
            {criticalFirst.length > 0 && (
              <Typography
                component="span"
                sx={{
                  ml: 1,
                  fontSize: tokens.font.sizeXs,
                  fontWeight: tokens.font.weightSemibold,
                  color: 'common.white',
                  bgcolor: tokens.color.danger,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: tokens.radius.sm
                }}
              >
                {criticalFirst.length}
              </Typography>
            )}
          </Typography>
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="Close alerts panel"
            sx={{ color: tokens.color.textMuted }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {/* Filter / bulk-action bar — only when there are open alerts */}
        {openAlerts.length > 0 && (
          <Stack
            spacing={0.75}
            sx={{
              px: 2,
              py: 1,
              bgcolor: tokens.color.bgSurface,
              borderBottom: '1px solid',
              borderBottomColor: tokens.color.bgBorder
            }}
          >
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              <Chip
                label="All"
                size="small"
                color={severityFilter === 'all' ? 'primary' : 'default'}
                variant={severityFilter === 'all' ? 'filled' : 'outlined'}
                onClick={() => setSeverityFilter('all')}
              />
              <Chip
                label="Critical"
                size="small"
                color={severityFilter === 'CRITICAL' ? 'error' : 'default'}
                variant={severityFilter === 'CRITICAL' ? 'filled' : 'outlined'}
                onClick={() => setSeverityFilter('CRITICAL')}
              />
              <Chip
                label="Warning"
                size="small"
                color={severityFilter === 'WARNING' ? 'warning' : 'default'}
                variant={severityFilter === 'WARNING' ? 'filled' : 'outlined'}
                onClick={() => setSeverityFilter('WARNING')}
              />
              <Chip
                label="Group similar"
                size="small"
                color={dedup ? 'primary' : 'default'}
                variant={dedup ? 'filled' : 'outlined'}
                onClick={() => setDedupPersist(!dedup)}
                aria-pressed={dedup}
              />
            </Stack>
            {availableCategories.length > 1 && (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                <Chip
                  label="All categories"
                  size="small"
                  variant={categoryFilter === 'all' ? 'filled' : 'outlined'}
                  onClick={() => setCategoryFilter('all')}
                />
                {availableCategories.map((cat) => (
                  <Chip
                    key={cat}
                    label={categoryLabel(cat)}
                    size="small"
                    variant={categoryFilter === cat ? 'filled' : 'outlined'}
                    onClick={() => setCategoryFilter(cat)}
                  />
                ))}
              </Stack>
            )}
            {criticalFirst.length > 1 && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<DoneAllIcon fontSize="small" />}
                onClick={handleAckAll}
                sx={{ alignSelf: 'flex-start' }}
              >
                Acknowledge {criticalFirst.length} shown
              </Button>
            )}
          </Stack>
        )}

        {/* Body */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {criticalFirst.length === 0 && acked.length === 0 && (
            <Typography variant="body2" sx={{ p: 3, textAlign: 'center', color: tokens.color.textMuted }}>
              No active alerts.
            </Typography>
          )}
          {criticalFirst.length === 0 && openAlerts.length > 0 && (
            <Typography variant="body2" sx={{ p: 3, textAlign: 'center', color: tokens.color.textMuted }}>
              No alerts match the current filters.
            </Typography>
          )}

          {criticalFirst.length > 0 && (
            <>
              <SectionHeader label="Active" />
              <List dense disablePadding sx={{ px: 1, pt: 0.5 }}>
                {criticalFirst.map((a) => (
                  <AlertRow key={a.id} alert={a} onAcknowledge={onAcknowledge} />
                ))}
              </List>
            </>
          )}

          {acked.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <SectionHeader label="Acknowledged" />
              <List dense disablePadding sx={{ px: 1, pt: 0.5 }}>
                {acked.map((a) => (
                  <AlertRow key={a.id} alert={a} onAcknowledge={onAcknowledge} />
                ))}
              </List>
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
