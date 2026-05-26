import { useState } from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import ThumbUpAltOutlinedIcon from '@mui/icons-material/ThumbUpAltOutlined'
import ThumbDownAltOutlinedIcon from '@mui/icons-material/ThumbDownAltOutlined'
import ThumbUpIcon from '@mui/icons-material/ThumbUp'
import ThumbDownIcon from '@mui/icons-material/ThumbDown'

export interface ThumbsRowProps {
  /** Stable id of the message being rated — used to keep UI state. */
  messageId: string
  question: string
  response: string
  provider: string
  model: string
  /** Optional — set when the feedback originated inside an incident drawer. */
  incidentId?: string | null
  /** Current rating from the parent store (controlled). */
  currentRating?: 1 | -1
  onSaved?: (rating: 1 | -1) => void
}

/**
 * Inline thumbs up/down row shown under assistant responses.
 * Stores question + response text in SQL Server (privacy: full text, not hashes).
 */
export function ThumbsRow({
  messageId,
  question,
  response,
  provider,
  model,
  incidentId,
  currentRating,
  onSaved
}: ThumbsRowProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const disabled = busy || currentRating != null

  async function rate(rating: 1 | -1): Promise<void> {
    if (disabled) return
    setBusy(true)
    try {
      const result = await window.sqlSentinel.aiSaveFeedback({
        question,
        response,
        rating,
        provider,
        model,
        incidentId: incidentId ?? null
      })
      if (result.ok) {
        onSaved?.(rating)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      data-message-id={messageId}
      sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center', mt: 0.5, opacity: 0.7 }}
    >
      <Tooltip title="Mark as helpful — stored locally for future few-shot examples">
        <span>
          <IconButton
            size="small"
            disabled={disabled}
            onClick={() => rate(1)}
            aria-label="thumbs up"
          >
            {currentRating === 1 ? (
              <ThumbUpIcon fontSize="inherit" />
            ) : (
              <ThumbUpAltOutlinedIcon fontSize="inherit" />
            )}
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Mark as unhelpful — recorded for analytics">
        <span>
          <IconButton
            size="small"
            disabled={disabled}
            onClick={() => rate(-1)}
            aria-label="thumbs down"
          >
            {currentRating === -1 ? (
              <ThumbDownIcon fontSize="inherit" />
            ) : (
              <ThumbDownAltOutlinedIcon fontSize="inherit" />
            )}
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  )
}
