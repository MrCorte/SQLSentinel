import { useState } from 'react'
import { Box, Typography, Stack, Chip, Divider, Collapse, IconButton, Tooltip } from '@mui/material'
import StorageIcon from '@mui/icons-material/Storage'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SettingsIcon from '@mui/icons-material/Settings'
import type { DiskVolume, DatabaseFile, CollectMetricsRequest } from '../../../../preload/index'
import { SpaceBar } from '../SpaceBar'
import { tokens } from '../../styles/tokens'
import { ShrinkDialog } from '../dialogs/ShrinkDialog'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function autogrowthLabel(file: DatabaseFile): { text: string; isDisabled: boolean } {
  if (file.growth === 0) return { text: 'Autogrowth: Disabled', isDisabled: true }
  if (file.is_percent_growth) return { text: `Autogrowth: ${file.growth}%`, isDisabled: false }
  const mb = (file.growth * 8) / 1024
  return { text: `Autogrowth: ${mb % 1 === 0 ? mb : mb.toFixed(1)} MB`, isDisabled: false }
}

function maxSizeLabel(max_mb: number | null): string {
  return max_mb === null ? 'Unlimited' : `${max_mb.toLocaleString('en-US')} MB`
}

function volumeBadge(free_pct: number): { label: string; color: string } | null {
  if (free_pct < 10) return { label: '⚠ Critical', color: tokens.color.danger }
  if (free_pct < 30) return { label: '⚠ Warning', color: tokens.color.warning }
  return null
}

// ---------------------------------------------------------------------------
// VolumeCard
// ---------------------------------------------------------------------------

function VolumeCard({ vol }: { vol: DiskVolume }): React.JSX.Element {
  const badge = volumeBadge(vol.free_pct)

  return (
    <Box
      sx={{
        bgcolor: tokens.color.bgSurface,
        border: '1px solid',
        borderColor: tokens.color.bgBorder,
        borderRadius: tokens.radius.sm,
        p: 2,
        position: 'relative',
        boxShadow: tokens.shadow.card
      }}
    >
      {badge && (
        <Chip
          label={badge.label}
          size="small"
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            bgcolor: badge.color,
            color: '#fff',
            fontWeight: 700,
            fontSize: 11,
            height: 22
          }}
        />
      )}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <StorageIcon sx={{ fontSize: 16, color: tokens.color.primary }} />
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: tokens.color.textPrimary }}>
          {vol.volume_mount_point}
        </Typography>
        {vol.logical_volume_name && (
          <Typography sx={{ fontSize: 12, color: tokens.color.textMuted }}>
            {vol.logical_volume_name}
          </Typography>
        )}
      </Stack>

      <SpaceBar used={vol.used_gb} total={vol.total_gb} unit="GB" />

      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
        <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
          Used: <strong style={{ color: 'inherit' }}>{vol.used_gb.toFixed(1)} GB</strong>
        </Typography>
        <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
          Free: <strong style={{ color: 'inherit' }}>{vol.free_gb.toFixed(1)} GB</strong>
        </Typography>
        <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
          Total: <strong style={{ color: 'inherit' }}>{vol.total_gb.toFixed(1)} GB</strong>
        </Typography>
      </Stack>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// DatabaseFileRow
// ---------------------------------------------------------------------------

function DatabaseFileRow({ file }: { file: DatabaseFile }): React.JSX.Element {
  const ag = autogrowthLabel(file)

  return (
    <Box sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
        <Chip
          label={file.type_desc}
          size="small"
          sx={{
            fontSize: 10,
            fontWeight: 700,
            height: 18,
            bgcolor: file.type_desc === 'ROWS' ? tokens.color.accentAlpha12 : 'action.hover',
            color: file.type_desc === 'ROWS' ? tokens.color.primary : 'text.secondary',
            border: '1px solid',
            borderColor: file.type_desc === 'ROWS' ? tokens.color.primary : tokens.color.bgBorder
          }}
        />
        <Typography
          sx={{
            fontSize: 12,
            color: tokens.color.textPrimary,
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1
          }}
          title={file.physical_name}
        >
          {file.file_name}
        </Typography>
      </Stack>

      <SpaceBar used={file.used_mb} total={file.size_mb} unit="MB" />

      <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
        <Typography
          variant="caption"
          sx={{
            color: ag.isDisabled ? tokens.color.danger : 'text.secondary',
            fontWeight: ag.isDisabled ? 600 : 400
          }}
        >
          {ag.text}
        </Typography>
        <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
          Max: {maxSizeLabel(file.max_mb)}
        </Typography>
      </Stack>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// DatabaseGroupCard — collapsible group per DB
// ---------------------------------------------------------------------------

function DatabaseGroupCard({
  dbName,
  files,
  connection
}: {
  dbName: string
  files: DatabaseFile[]
  connection: CollectMetricsRequest
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const [shrinkOpen, setShrinkOpen] = useState(false)

  return (
    <>
      <Box
        sx={{
          bgcolor: tokens.color.bgSurface,
          border: '1px solid',
          borderColor: tokens.color.bgBorder,
          borderRadius: tokens.radius.sm,
          overflow: 'hidden',
          boxShadow: tokens.shadow.card
        }}
      >
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.5}
          sx={{
            px: 2,
            py: 1,
            bgcolor: tokens.color.bgBase,
            borderBottom: open ? '1px solid' : 'none',
            borderBottomColor: open ? tokens.color.bgBorder : 'transparent',
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' }
          }}
          onClick={() => setOpen((v) => !v)}
        >
          <FolderOpenIcon sx={{ fontSize: 15, color: tokens.color.primary }} />
          <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1, color: tokens.color.textPrimary }}>
            {dbName}
          </Typography>
          <Typography variant="caption" sx={{ color: tokens.color.textMuted }}>
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </Typography>
          <Tooltip title="Shrink database">
            <IconButton
              size="small"
              sx={{ p: 0.25, color: tokens.color.textMuted, '&:hover': { color: tokens.color.primary } }}
              onClick={(e) => {
                e.stopPropagation()
                setShrinkOpen(true)
              }}
            >
              <SettingsIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" sx={{ p: 0.25 }}>
            <ExpandMoreIcon
              sx={{
                fontSize: 16,
                color: tokens.color.textMuted,
                transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 200ms ease'
              }}
            />
          </IconButton>
        </Stack>

        {/* Files list */}
        <Collapse in={open}>
          <Box sx={{ px: 2, pb: 1 }}>
            {files.map((file, idx) => (
              <Box key={file.file_name}>
                {idx > 0 && <Divider sx={{ my: 0.5 }} />}
                <DatabaseFileRow file={file} />
              </Box>
            ))}
          </Box>
        </Collapse>
      </Box>

      <ShrinkDialog
        open={shrinkOpen}
        onClose={() => setShrinkOpen(false)}
        dbName={dbName}
        files={files}
        connection={connection}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// DisksTab (main export)
// ---------------------------------------------------------------------------

interface DisksTabProps {
  diskVolumes: DiskVolume[]
  databaseFiles: DatabaseFile[]
  connection: CollectMetricsRequest
}

export function DisksTab({
  diskVolumes,
  databaseFiles,
  connection
}: DisksTabProps): React.JSX.Element {
  // Group databaseFiles by database_name
  const byDb = new Map<string, DatabaseFile[]>()
  for (const file of databaseFiles) {
    if (!byDb.has(file.database_name)) byDb.set(file.database_name, [])
    byDb.get(file.database_name)!.push(file)
  }
  const sortedDbNames = [...byDb.keys()].sort()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Section A — Volumi server */}
      <Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <StorageIcon sx={{ fontSize: 16, color: tokens.color.textMuted }} />
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: tokens.color.textMuted
            }}
          >
            Server Volumes
          </Typography>
        </Stack>

        {diskVolumes.length === 0 ? (
          <Typography variant="body2" sx={{ color: tokens.color.textMuted }}>
            No volume data available.
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 1.5
            }}
          >
            {diskVolumes.map((vol) => (
              <VolumeCard key={vol.volume_mount_point} vol={vol} />
            ))}
          </Box>
        )}
      </Box>

      <Divider />

      {/* Section B — File Database */}
      <Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <FolderOpenIcon sx={{ fontSize: 16, color: tokens.color.textMuted }} />
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: tokens.color.textMuted
            }}
          >
            Database Files
          </Typography>
        </Stack>

        {sortedDbNames.length === 0 ? (
          <Typography variant="body2" sx={{ color: tokens.color.textMuted }}>
            No database files available.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {sortedDbNames.map((dbName) => (
              <DatabaseGroupCard
                key={dbName}
                dbName={dbName}
                files={byDb.get(dbName)!}
                connection={connection}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  )
}
