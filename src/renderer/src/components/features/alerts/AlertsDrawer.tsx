import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Divider,
  Stack,
  Chip,
  Button
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import type { Alert } from '../../../../../preload/index'
import { tokens } from '../../../styles/tokens'
import { useAlertFiltering } from './hooks/useAlertFiltering'
import { useAlertVirtualization } from './hooks/useAlertVirtualization'

interface Props {
  open: boolean
  alerts: Alert[]
  onClose: () => void
  onAcknowledge: (alertId: string) => void
}

type AlertWithDup = Alert & { _dupCount?: number }

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
    default:
      return cat
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
  alert: AlertWithDup
  onAcknowledge: (id: string) => void
}): React.JSX.Element {
  const isCritical = alert.severity === 'CRITICAL'
  const isAcknowledged = alert.acknowledgedAt !== null
  const accentColor = isCritical ? tokens.color.danger : tokens.color.warning
  const dupCount = alert._dupCount ?? 0

  return (
    <Box
      sx={{
        opacity: isAcknowledged ? 0.55 : 1,
        borderLeft: `3px solid ${accentColor}`,
        bgcolor: tokens.color.bgSurface,
        mb: 0.5,
        mx: 1,
        px: 1,
        py: 0.75
      }}
    >
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
      <Typography
        sx={{
          display: 'block',
          fontSize: tokens.font.sizeSm,
          color: tokens.color.textPrimary,
          mb: alert.suggestion ? 0.25 : 0.5
        }}
      >
        {alert.message}
      </Typography>
      {alert.suggestion && (
        <Typography
          sx={{
            display: 'block',
            fontSize: tokens.font.sizeXs,
            color: tokens.color.textMuted,
            fontStyle: 'italic',
            mb: 0.5
          }}
        >
          {alert.suggestion}
        </Typography>
      )}
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
    </Box>
  )
}

export function AlertsDrawer({ open, alerts, onClose, onAcknowledge }: Props): React.JSX.Element {
  const {
    severityFilter,
    categoryFilter,
    dedup,
    setSeverityFilter,
    setCategoryFilter,
    setDedupPersist,
    openAlerts,
    acked,
    availableCategories,
    criticalFirst
  } = useAlertFiltering(alerts)

  const { scrollRef, virtualItems, virtualizer } = useAlertVirtualization(criticalFirst, acked)

  const handleAckAll = (): void => {
    for (const a of criticalFirst) onAcknowledge(a.id)
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

        {/* Filter / bulk-action bar */}
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
        <Box ref={scrollRef} sx={{ flex: 1, overflow: 'auto' }}>
          {virtualItems.length === 0 && acked.length === 0 && openAlerts.length === 0 && (
            <Typography
              variant="body2"
              sx={{ p: 3, textAlign: 'center', color: tokens.color.textMuted }}
            >
              No active alerts.
            </Typography>
          )}
          {virtualItems.length === 0 && openAlerts.length > 0 && (
            <Typography
              variant="body2"
              sx={{ p: 3, textAlign: 'center', color: tokens.color.textMuted }}
            >
              No alerts match the current filters.
            </Typography>
          )}

          {virtualItems.length > 0 && (
            <Box
              sx={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const item = virtualItems[vItem.index]
                return (
                  <Box
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vItem.start}px)`
                    }}
                  >
                    {item.kind === 'header' && <SectionHeader label={item.label} />}
                    {item.kind === 'divider' && <Divider sx={{ my: 1 }} />}
                    {item.kind === 'alert' && (
                      <AlertRow alert={item.alert} onAcknowledge={onAcknowledge} />
                    )}
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
