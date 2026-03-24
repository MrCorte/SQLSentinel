import {
  Drawer,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Divider,
  Stack
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { Alert } from '../../../preload/index'
import { tokens } from '../styles/tokens'

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
      return 'Blocchi'
    case 'database_offline':
      return 'DB Offline'
    case 'backup_overdue':
      return 'Backup'
    case 'disk_space_low':
      return 'Disco'
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
        color: 'text.secondary',
        bgcolor: 'background.default',
        borderBottom: '1px solid',
        borderBottomColor: 'divider',
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
  alert: Alert
  onAcknowledge: (id: string) => void
}): React.JSX.Element {
  const isCritical = alert.severity === 'CRITICAL'
  const isAcknowledged = alert.acknowledgedAt !== null
  const accentColor = isCritical ? tokens.color.error : tokens.color.warning

  return (
    <ListItem
      alignItems="flex-start"
      sx={{
        opacity: isAcknowledged ? 0.55 : 1,
        borderLeft: `3px solid ${accentColor}`,
        bgcolor: 'background.paper',
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
                color: 'text.secondary',
                bgcolor: 'background.default',
                px: 0.75,
                py: 0.125,
                borderRadius: tokens.radius.sm
              }}
            >
              {categoryLabel(alert.category)}
            </Typography>
            <Typography
              component="span"
              sx={{ fontSize: tokens.font.sizeXs, color: 'text.secondary' }}
            >
              {alert.serverId}
            </Typography>
          </Stack>
        }
        secondary={
          <>
            <Typography
              component="span"
              sx={{ display: 'block', fontSize: tokens.font.sizeSm, color: 'text.primary', mb: 0.5 }}
            >
              {alert.message}
            </Typography>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography
                component="span"
                sx={{ fontSize: tokens.font.sizeXs, color: 'text.secondary' }}
              >
                {new Date(alert.detectedAt).toLocaleString('it-IT')}
              </Typography>
              {!isAcknowledged && (
                <Typography
                  component="span"
                  onClick={() => onAcknowledge(alert.id)}
                  sx={{
                    fontSize: tokens.font.sizeXs,
                    fontWeight: tokens.font.weightSemibold,
                    color: tokens.color.primary,
                    cursor: 'pointer',
                    '&:hover': { textDecoration: 'underline' }
                  }}
                >
                  Riconosci →
                </Typography>
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
  const openAlerts = alerts.filter((a) => a.acknowledgedAt === null)
  const acked = alerts.filter((a) => a.acknowledgedAt !== null)

  const criticalFirst = [...openAlerts].sort((a, b) =>
    a.severity === 'CRITICAL' && b.severity !== 'CRITICAL' ? -1 : 1
  )

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: tokens.size.alertsDrawerWidth,
          bgcolor: 'background.default',
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
            height: tokens.size.navbarHeight,
            minHeight: tokens.size.navbarHeight,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderBottomColor: 'divider',
          }}
        >
          <Typography
            sx={{
              flex: 1,
              fontSize: tokens.font.sizeMd,
              fontWeight: tokens.font.weightSemibold,
              color: 'text.primary'
            }}
          >
            Alert attivi
            {criticalFirst.length > 0 && (
              <Typography
                component="span"
                sx={{
                  ml: 1,
                  fontSize: tokens.font.sizeXs,
                  fontWeight: tokens.font.weightSemibold,
                  color: 'common.white',
                  bgcolor: tokens.color.error,
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
            sx={{ color: 'text.secondary' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {/* Body */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {criticalFirst.length === 0 && acked.length === 0 && (
            <Typography
              variant="body2"
              sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}
            >
              Nessun alert attivo.
            </Typography>
          )}

          {criticalFirst.length > 0 && (
            <>
              <SectionHeader label="Attivi" />
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
              <SectionHeader label="Riconosciuti" />
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
