import { useEffect, useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Tooltip,
  CircularProgress
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ThumbUpIcon from '@mui/icons-material/ThumbUp'
import ThumbDownIcon from '@mui/icons-material/ThumbDown'
import { tokens } from '../../styles/tokens'
import { notify } from '../../store/notifyStore'
import type {
  AiFeedbackRecord,
  PromotionCandidateDto,
  TsqlMapEntryDto
} from '../../../../preload/index'

function extractTsqlFromResponse(response: string): string {
  const match = response.match(/```sql\s*\n([\s\S]+?)\n```/i)
  return match ? match[1].trim() : response.slice(0, 600)
}

function suggestKeyName(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join('_')
}

export function AITrainingSection(): React.JSX.Element {
  const [tab, setTab] = useState(0)
  return (
    <Card variant="outlined">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>AI Training</Typography>
        <Typography sx={{ fontSize: 12, color: tokens.color.textMuted }}>
          Manage thumbs-up examples the AI agent uses as few-shot guidance, and promote recurring
          positive patterns into the static T-SQL map.
        </Typography>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36 }}>
          <Tab label="Examples" sx={{ minHeight: 36, fontSize: 12 }} />
          <Tab label="Promotion candidates" sx={{ minHeight: 36, fontSize: 12 }} />
          <Tab label="Active T-SQL map" sx={{ minHeight: 36, fontSize: 12 }} />
        </Tabs>
        {tab === 0 && <ExamplesTab />}
        {tab === 1 && <CandidatesTab />}
        {tab === 2 && <MapTab />}
      </CardContent>
    </Card>
  )
}

function ExamplesTab(): React.JSX.Element {
  const [rows, setRows] = useState<AiFeedbackRecord[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'up' | 'down'>('all')

  async function refresh(): Promise<void> {
    const r = await window.sqlSentinel.aiListFeedback()
    if (r.ok) setRows(r.data)
    else notify.error(r.error, 'Failed to load feedback')
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleDelete(id: string): Promise<void> {
    const r = await window.sqlSentinel.aiDeleteFeedback(id)
    if (r.ok) {
      setRows((prev) => prev?.filter((x) => x.id !== id) ?? null)
    } else {
      notify.error(r.error, 'Delete failed')
    }
  }

  if (rows == null) {
    return <CircularProgress size={20} />
  }

  const filtered = rows.filter((r) =>
    filter === 'all' ? true : filter === 'up' ? r.rating === 1 : r.rating === -1
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {(['all', 'up', 'down'] as const).map((k) => (
          <Chip
            key={k}
            label={k === 'all' ? `All (${rows.length})` : k === 'up' ? '👍 only' : '👎 only'}
            size="small"
            color={filter === k ? 'primary' : 'default'}
            onClick={() => setFilter(k)}
          />
        ))}
      </Box>
      {filtered.length === 0 ? (
        <Typography sx={{ fontSize: 12, color: tokens.color.textMuted, fontStyle: 'italic' }}>
          No feedback recorded yet. Click 👍 or 👎 under any assistant response.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontSize: 11 }}>When</TableCell>
              <TableCell sx={{ fontSize: 11 }}>Rating</TableCell>
              <TableCell sx={{ fontSize: 11 }}>Question</TableCell>
              <TableCell sx={{ fontSize: 11 }}>Model</TableCell>
              <TableCell sx={{ fontSize: 11 }}>Embed</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell sx={{ fontSize: 11 }}>
                  {new Date(r.createdAt).toLocaleString()}
                </TableCell>
                <TableCell sx={{ fontSize: 11 }}>
                  {r.rating === 1 ? (
                    <ThumbUpIcon fontSize="inherit" color="success" />
                  ) : (
                    <ThumbDownIcon fontSize="inherit" color="error" />
                  )}
                </TableCell>
                <TableCell sx={{ fontSize: 11, maxWidth: 280 }}>
                  <Tooltip title={r.question}>
                    <span>
                      {r.question.slice(0, 80)}
                      {r.question.length > 80 && '…'}
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ fontSize: 11 }}>{r.model}</TableCell>
                <TableCell sx={{ fontSize: 11 }}>{r.hasEmbedding ? '✓' : '—'}</TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => handleDelete(r.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  )
}

function CandidatesTab(): React.JSX.Element {
  const [rows, setRows] = useState<PromotionCandidateDto[] | null>(null)
  const [dialog, setDialog] = useState<PromotionCandidateDto | null>(null)

  async function refresh(): Promise<void> {
    const r = await window.sqlSentinel.aiListPromotionCandidates()
    if (r.ok) setRows(r.data)
    else notify.error(r.error, 'Failed to load candidates')
  }

  useEffect(() => {
    refresh()
  }, [])

  if (rows == null) return <CircularProgress size={20} />

  if (rows.length === 0) {
    return (
      <Typography sx={{ fontSize: 12, color: tokens.color.textMuted, fontStyle: 'italic' }}>
        No patterns reached 3 thumbs-up yet. Keep marking helpful responses.
      </Typography>
    )
  }

  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontSize: 11 }}>Example question</TableCell>
            <TableCell sx={{ fontSize: 11 }}>Upvotes</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.questionHash}>
              <TableCell sx={{ fontSize: 11, maxWidth: 380 }}>{r.exampleQuestion}</TableCell>
              <TableCell sx={{ fontSize: 11 }}>{r.upvotes}</TableCell>
              <TableCell>
                <Button size="small" variant="outlined" onClick={() => setDialog(r)}>
                  Promote
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {dialog && (
        <PromoteDialog
          candidate={dialog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            refresh()
          }}
        />
      )}
    </>
  )
}

function PromoteDialog({
  candidate,
  onClose,
  onDone
}: {
  candidate: PromotionCandidateDto
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const [keyName, setKeyName] = useState(suggestKeyName(candidate.exampleQuestion))
  const [aliasesText, setAliasesText] = useState(
    candidate.exampleQuestion.toLowerCase().slice(0, 80)
  )
  const [tsql, setTsql] = useState(extractTsqlFromResponse(candidate.bestResponse))
  const [busy, setBusy] = useState(false)

  async function handleSave(): Promise<void> {
    setBusy(true)
    try {
      const aliases = aliasesText
        .split(/[,;\n]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
      const r = await window.sqlSentinel.aiPromoteToTsqlMap({
        keyName: keyName.trim(),
        aliases,
        tsql: tsql.trim(),
        promotedHash: candidate.questionHash
      })
      if (r.ok) {
        notify.success(`Promoted "${keyName}" — future matches will use this query.`)
        onDone()
      } else {
        notify.error(r.error, 'Promotion failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 14 }}>Promote to static T-SQL map</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <TextField
          label="Key name"
          size="small"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          helperText="Used as an additional trigger phrase. Lowercase, snake_case."
        />
        <TextField
          label="Aliases (comma-separated)"
          size="small"
          multiline
          rows={2}
          value={aliasesText}
          onChange={(e) => setAliasesText(e.target.value)}
          helperText="Trigger phrases. A question containing any of these will return the T-SQL below verbatim."
        />
        <TextField
          label="T-SQL"
          size="small"
          multiline
          rows={10}
          value={tsql}
          onChange={(e) => setTsql(e.target.value)}
          helperText="SELECT-only. Will be quoted verbatim — no modification by the model."
          sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 12 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={busy || !keyName.trim() || !tsql.trim()}
        >
          {busy ? <CircularProgress size={14} /> : 'Promote'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function MapTab(): React.JSX.Element {
  const [rows, setRows] = useState<TsqlMapEntryDto[] | null>(null)

  async function refresh(): Promise<void> {
    const r = await window.sqlSentinel.aiListTsqlMap()
    if (r.ok) setRows(r.data)
    else notify.error(r.error, 'Failed to load T-SQL map')
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleDelete(id: string): Promise<void> {
    const r = await window.sqlSentinel.aiDeleteTsqlMapEntry(id)
    if (r.ok) {
      setRows((prev) => prev?.filter((x) => x.id !== id) ?? null)
    } else {
      notify.error(r.error, 'Delete failed')
    }
  }

  if (rows == null) return <CircularProgress size={20} />

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontSize: 11 }}>Key</TableCell>
          <TableCell sx={{ fontSize: 11 }}>Aliases</TableCell>
          <TableCell sx={{ fontSize: 11 }}>Origin</TableCell>
          <TableCell />
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell sx={{ fontSize: 11 }}>
              <Tooltip
                title={
                  <pre style={{ fontSize: 10, maxWidth: 500, whiteSpace: 'pre-wrap' }}>
                    {r.tsql.slice(0, 500)}
                  </pre>
                }
              >
                <span>{r.keyName}</span>
              </Tooltip>
            </TableCell>
            <TableCell sx={{ fontSize: 11 }}>
              {r.aliases.length === 0 ? '—' : r.aliases.join(', ')}
            </TableCell>
            <TableCell sx={{ fontSize: 11 }}>
              <Chip
                size="small"
                label={r.origin}
                color={r.origin === 'promoted' ? 'primary' : 'default'}
              />
            </TableCell>
            <TableCell>
              {r.origin === 'promoted' && (
                <IconButton size="small" onClick={() => handleDelete(r.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
