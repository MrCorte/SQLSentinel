import { Box, Typography } from '@mui/material'
import { tokens } from '../../../styles/tokens'
import type { OfflineDb } from './useHomeDashboard'

// ---------------------------------------------------------------------------
// OfflineDbsTable — panel listing databases not in ONLINE state
// ---------------------------------------------------------------------------

export interface OfflineDbsTableProps {
  offlineDbs: OfflineDb[]
  onNavigateToServer: (id: string) => void
}

export function OfflineDbsTable({
  offlineDbs,
  onNavigateToServer
}: OfflineDbsTableProps): React.JSX.Element {
  return (
    <Box
      sx={{
        mx: 0,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: '4px solid #a4262c',
        borderRadius: `${tokens.radius.md}px`,
        boxShadow: tokens.shadow.elevated,
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1,
          borderBottom: '1px solid',
          borderBottomColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          backgroundImage: (theme) =>
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(164,38,44,0.10) 0%, transparent 100%)'
              : 'linear-gradient(135deg, rgba(164,38,44,0.06) 0%, transparent 100%)'
        }}
      >
        <Typography
          sx={{
            fontSize: tokens.font.sizeXs,
            fontWeight: tokens.font.weightBold,
            color: '#a4262c',
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}
        >
          Databases not online
        </Typography>
        <Box
          sx={{
            ml: 0.5,
            px: 0.75,
            py: 0.1,
            bgcolor: '#a4262c',
            color: '#fff',
            borderRadius: 1,
            fontSize: 10,
            fontWeight: tokens.font.weightBold,
            lineHeight: 1.6
          }}
        >
          {offlineDbs.length}
        </Box>
      </Box>

      {/* Table */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: tokens.font.sizeSm,
          tableLayout: 'fixed'
        }}
      >
        <thead>
          <tr>
            {['DATABASE', 'SERVER', 'STATUS', 'OFFLINE SINCE'].map((col) => (
              <th
                key={col}
                style={{
                  padding: '5px 10px',
                  textAlign: 'left',
                  fontWeight: tokens.font.weightBold,
                  fontSize: tokens.font.sizeXs,
                  opacity: 0.6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderBottom: '1px solid rgba(128,128,128,0.2)',
                  whiteSpace: 'nowrap'
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {offlineDbs.map((db, i) => (
            <tr
              key={`${db.serverId}/${db.name}`}
              onClick={() => onNavigateToServer(db.serverRecordId)}
              style={{
                backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(164,38,44,0.03)',
                cursor: 'pointer'
              }}
            >
              <td
                style={{
                  padding: '5px 10px',
                  borderBottom: '1px solid rgba(128,128,128,0.1)',
                  fontWeight: tokens.font.weightSemibold,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {db.name}
              </td>
              <td
                style={{
                  padding: '5px 10px',
                  borderBottom: '1px solid rgba(128,128,128,0.1)',
                  opacity: 0.75,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {db.serverName}
              </td>
              <td
                style={{
                  padding: '5px 10px',
                  borderBottom: '1px solid rgba(128,128,128,0.1)',
                  whiteSpace: 'nowrap'
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    padding: '1px 6px',
                    borderRadius: 3,
                    fontSize: 10,
                    fontWeight: tokens.font.weightBold,
                    background: db.stateDesc === 'OFFLINE' ? '#a4262c' : '#d83b01',
                    color: '#fff'
                  }}
                >
                  {db.stateDesc}
                </span>
              </td>
              <td
                style={{
                  padding: '5px 10px',
                  borderBottom: '1px solid rgba(128,128,128,0.1)',
                  whiteSpace: 'nowrap',
                  color: db.offlineSince ? 'inherit' : 'rgba(128,128,128,0.5)',
                  fontSize: tokens.font.sizeSm
                }}
              >
                {db.offlineSince
                  ? new Date(db.offlineSince).toLocaleString('en-US', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : 'before last restart'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  )
}
