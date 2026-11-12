import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  CircularProgress,
  Collapse
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import { tokens } from '../../styles/tokens'
import { notify } from '../../store/notifyStore'
import type { RagStats, RagTrace, RagTraceStatus } from '../../../../preload/index'

// ---------------------------------------------------------------------------
// RAG observability dashboard — answers three questions:
//   1. Is the pipeline fast?        (latency KPIs + per-stage breakdown)
//   2. Is the answer grounded?      (retrieval hit rate, scores, dropped blocks)
//   3. Does grounding pay off?      (feedback split by retrieval quality)
// plus the actionable "knowledge gaps" list (questions nothing in the KB covered).
// ---------------------------------------------------------------------------

const WINDOWS = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 }
] as const

function fmtMs(v: number | null | undefined): string {
  if (v == null) return '—'
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`
}
function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}
function fmtScore(v: number | null | undefined, digits = 2): string {
  return v == null ? '—' : v.toFixed(digits)
}
function fmtNum(v: number): string {
  return v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : v.toLocaleString()
}

const STATUS_META: Record<
  RagTraceStatus,
  { label: string; color: 'success' | 'error' | 'default' | 'info' }
> = {
  ok: { label: 'ok', color: 'success' },
  error: { label: 'error', color: 'error' },
  cancelled: { label: 'cancelled', color: 'default' },
  cache_hit: { label: 'cache', color: 'info' }
}

function StatTile({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  const body = (
    <Box
      sx={{
        border: `1px solid ${tokens.color.bgBorder}`,
        borderRadius: 1,
        px: 1.5,
        py: 1,
        minWidth: 0
      }}
    >
      <Typography sx={{ fontSize: 11, color: tokens.color.textMuted }} noWrap>
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 18,
          fontWeight: 600,
          color: tokens.color.textPrimary,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {value}
      </Typography>
    </Box>
  )
  return hint ? (
    <Tooltip title={hint} placement="top">
      {body}
    </Tooltip>
  ) : (
    body
  )
}

/** Gantt-style waterfall of a single trace's spans (one series → one hue). */
function SpanWaterfall({ trace }: { trace: RagTrace }): React.JSX.Element {
  const total = Math.max(1, trace.totalMs, ...trace.spans.map((s) => s.startMs + s.durationMs))
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {trace.spans.map((s, i) => {
        const left = (s.startMs / total) * 100
        const width = Math.max(0.5, (s.durationMs / total) * 100)
        return (
          <Box
            key={`${s.name}-${i}`}
            sx={{
              display: 'grid',
              gridTemplateColumns: '150px 1fr 64px',
              gap: 1,
              alignItems: 'center'
            }}
          >
            <Typography
              sx={{
                fontSize: 11,
                color: tokens.color.textPrimary,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5
              }}
              noWrap
            >
              {!s.ok && (
                <ErrorOutlineIcon
                  sx={{ fontSize: 12, color: tokens.color.danger }}
                  aria-label="failed"
                />
              )}
              {s.name}
            </Typography>
            <Tooltip
              title={`${s.name}: ${fmtMs(s.durationMs)} (start +${fmtMs(s.startMs)})${s.ok ? '' : ' — failed'}${s.detail ? ` · ${s.detail}` : ''}`}
              placement="top"
            >
              {/* Hit target is the full row height, larger than the 8px bar */}
              <Box sx={{ position: 'relative', height: 14, cursor: 'default' }}>
                <Box
                  sx={{
                    position: 'absolute',
                    top: 6,
                    left: 0,
                    right: 0,
                    height: 2,
                    bgcolor: tokens.color.bgBorder,
                    opacity: 0.5
                  }}
                />
                <Box
                  sx={{
                    position: 'absolute',
                    top: 3,
                    left: `${left}%`,
                    width: `${width}%`,
                    height: 8,
                    borderRadius: '4px',
                    bgcolor: s.ok ? tokens.color.accent : tokens.color.danger
                  }}
                />
              </Box>
            </Tooltip>
            <Typography
              sx={{
                fontSize: 11,
                color: tokens.color.textMuted,
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {fmtMs(s.durationMs)}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

function TraceDetail({ trace }: { trace: RagTrace }): React.JSX.Element {
  return (
    <Box
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, gap: 2, py: 1.5 }}
    >
      <Box>
        <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1 }}>Timeline</Typography>
        <SpanWaterfall trace={trace} />
        <Typography sx={{ fontSize: 11, color: tokens.color.textMuted, mt: 1 }}>
          Retrieval done at {fmtMs(trace.retrievalMs)} · first token at {fmtMs(trace.ttftMs)} ·
          total {fmtMs(trace.totalMs)}
          {trace.tokensIn != null && ` · tokens ${trace.tokensIn} in / ${trace.tokensOut ?? 0} out`}
        </Typography>
        {trace.error && (
          <Typography sx={{ fontSize: 11, color: tokens.color.danger, mt: 0.5 }}>
            Error: {trace.error}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
            Retrieved ({trace.ftsHits} FTS · {trace.semanticHits} semantic · top cosine{' '}
            {fmtScore(trace.semanticTopScore)})
          </Typography>
          {trace.hits.length === 0 && !trace.predefinedHit ? (
            <Typography sx={{ fontSize: 11, color: tokens.color.warning }}>
              ⚠ Nothing retrieved: the answer relied on the model alone (ungrounded).
            </Typography>
          ) : (
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {trace.predefinedHit && (
                <Typography component="li" sx={{ fontSize: 11 }}>
                  Predefined T-SQL map entry (verbatim query)
                </Typography>
              )}
              {trace.hits.map((h, i) => (
                <Typography component="li" key={i} sx={{ fontSize: 11 }}>
                  <Box component="span" sx={{ color: tokens.color.textMuted }}>
                    {h.source === 'kb'
                      ? `KB · ${h.via ?? ''} · rrf ${fmtScore(h.score, 4)}`
                      : `example · cos ${fmtScore(h.score)}`}
                  </Box>{' '}
                  {h.title}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
            Context {fmtNum(trace.contextChars)} / {fmtNum(trace.contextBudget)} chars
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {trace.blocks.map((b, i) => (
              <Chip
                key={i}
                size="small"
                variant="outlined"
                label={`${b.kept ? '' : '✂ '}${b.tag} · ${fmtNum(b.chars)}`}
                title={b.kept ? 'Included in the prompt' : 'Dropped to fit the context budget'}
                sx={{
                  fontSize: 10,
                  height: 20,
                  textDecoration: b.kept ? 'none' : 'line-through',
                  opacity: b.kept ? 1 : 0.7
                }}
              />
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export function RagObservabilitySection(): React.JSX.Element {
  const [hours, setHours] = useState<number>(24)
  const [stats, setStats] = useState<RagStats | null>(null)
  const [traces, setTraces] = useState<RagTrace[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([
        window.sqlSentinel.aiRagStats({ sinceHours: hours }),
        window.sqlSentinel.aiRagListTraces({ sinceHours: hours, limit: 50 })
      ])
      if (s.ok) setStats(s.data)
      else notify.error(s.error, 'Failed to load RAG stats')
      if (t.ok) setTraces(t.data)
      else notify.error(t.error, 'Failed to load RAG traces')
    } finally {
      setLoading(false)
    }
  }, [hours])

  useEffect(() => {
    refresh()
  }, [refresh])

  const fb = stats?.feedback

  return (
    <Card variant="outlined">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>RAG Observability</Typography>
            <Typography sx={{ fontSize: 12, color: tokens.color.textMuted }}>
              One trace per AI assistant request: retrieval quality, context budget, latency per
              stage and user feedback. Traces are kept for 30 days.
            </Typography>
          </Box>
          {WINDOWS.map((w) => (
            <Chip
              key={w.hours}
              size="small"
              label={w.label}
              color={hours === w.hours ? 'primary' : 'default'}
              onClick={() => setHours(w.hours)}
            />
          ))}
          <Tooltip title="Refresh">
            <span>
              <IconButton size="small" onClick={refresh} disabled={loading} aria-label="refresh">
                {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {stats == null ? (
          <CircularProgress size={20} />
        ) : stats.totalTraces === 0 ? (
          <Typography sx={{ fontSize: 12, color: tokens.color.textMuted, fontStyle: 'italic' }}>
            No traces in this window yet. Ask the AI assistant something to generate one.
          </Typography>
        ) : (
          <>
            {/* Latency */}
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>Performance</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: 1
              }}
            >
              <StatTile label="Requests" value={fmtNum(stats.totalTraces)} />
              <StatTile
                label="p50 latency"
                value={fmtMs(stats.p50TotalMs)}
                hint="Median end-to-end time of successful answers"
              />
              <StatTile
                label="p95 latency"
                value={fmtMs(stats.p95TotalMs)}
                hint="95th percentile, the slow tail"
              />
              <StatTile
                label="p50 first token"
                value={fmtMs(stats.p50TtftMs)}
                hint="Time until the user sees the first word"
              />
              <StatTile
                label="Avg retrieval"
                value={fmtMs(stats.avgRetrievalMs)}
                hint="Parallel retrieval phase (KB + examples + telemetry)"
              />
              <StatTile label="Cache hit rate" value={fmtPct(stats.cacheHitRate)} />
              <StatTile label="Error rate" value={fmtPct(stats.errorRate)} />
              <StatTile
                label="Tokens in / out"
                value={`${fmtNum(stats.tokensIn)} / ${fmtNum(stats.tokensOut)}`}
              />
            </Box>

            {/* Retrieval quality */}
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>Retrieval quality</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: 1
              }}
            >
              <StatTile
                label="Ungrounded answers"
                value={fmtPct(stats.ungroundedRate)}
                hint="No KB hit, no past example, no predefined query: the model answered from its own memory (hallucination risk)"
              />
              <StatTile
                label="Avg top cosine"
                value={fmtScore(stats.avgSemanticTopScore)}
                hint="Best semantic-search similarity per request (0–1)"
              />
              <StatTile
                label="Predefined query hit"
                value={fmtPct(stats.predefinedHitRate)}
                hint="Requests served by a verbatim T-SQL map entry"
              />
              <StatTile
                label="Satisfaction"
                value={fmtPct(fb?.satisfaction)}
                hint={`${fb?.up ?? 0} 👍 / ${fb?.down ?? 0} 👎 over ${fb?.rated ?? 0} rated answers`}
              />
              <StatTile
                label="Grounded when 👍 / 👎"
                value={`${fmtPct(fb?.groundedRateUp)} / ${fmtPct(fb?.groundedRateDown)}`}
                hint="Share of liked vs disliked answers that had retrieval support. A large gap means grounding drives quality."
              />
              <StatTile
                label="Top cosine when 👍 / 👎"
                value={`${fmtScore(fb?.avgSemanticScoreUp)} / ${fmtScore(fb?.avgSemanticScoreDown)}`}
                hint="Average best semantic score on liked vs disliked answers"
              />
            </Box>

            {/* Stage breakdown + block drops */}
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, gap: 2 }}
            >
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>Stages</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: 11 }}>Stage</TableCell>
                      <TableCell sx={{ fontSize: 11 }} align="right">
                        Avg
                      </TableCell>
                      <TableCell sx={{ fontSize: 11 }} align="right">
                        p95
                      </TableCell>
                      <TableCell sx={{ fontSize: 11 }} align="right">
                        Errors
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {stats.stages.map((st) => (
                      <TableRow key={st.name}>
                        <TableCell sx={{ fontSize: 11 }}>{st.name}</TableCell>
                        <TableCell
                          sx={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                          align="right"
                        >
                          {fmtMs(st.avgMs)}
                        </TableCell>
                        <TableCell
                          sx={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                          align="right"
                        >
                          {fmtMs(st.p95Ms)}
                        </TableCell>
                        <TableCell sx={{ fontSize: 11 }} align="right">
                          {st.errors}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                    Context blocks dropped for budget
                  </Typography>
                  {stats.blockDrops.length === 0 ? (
                    <Typography sx={{ fontSize: 11, color: tokens.color.textMuted }}>
                      None. Everything fit.
                    </Typography>
                  ) : (
                    stats.blockDrops.map((d) => (
                      <Typography key={d.tag} sx={{ fontSize: 11 }}>
                        ✂ {d.tag}: {d.count}×
                      </Typography>
                    ))
                  )}
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                    Knowledge gaps (questions with no retrieval support)
                  </Typography>
                  {stats.knowledgeGaps.length === 0 ? (
                    <Typography sx={{ fontSize: 11, color: tokens.color.textMuted }}>
                      None in this window.
                    </Typography>
                  ) : (
                    <Box component="ul" sx={{ m: 0, pl: 2 }}>
                      {stats.knowledgeGaps.map((g) => (
                        <Typography component="li" key={g.traceId} sx={{ fontSize: 11 }}>
                          {g.question}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          </>
        )}

        {/* Recent traces */}
        {traces && traces.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>Recent traces</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11, width: 28 }} />
                  <TableCell sx={{ fontSize: 11 }}>When</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Question</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Status</TableCell>
                  <TableCell sx={{ fontSize: 11 }} align="right">
                    Total
                  </TableCell>
                  <TableCell sx={{ fontSize: 11 }} align="right">
                    KB / Ex
                  </TableCell>
                  <TableCell sx={{ fontSize: 11 }} align="right">
                    Top cos
                  </TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Feedback</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {traces.map((t) => {
                  const open = expanded === t.id
                  const meta = STATUS_META[t.status] ?? STATUS_META.ok
                  return (
                    <Fragment key={t.id}>
                      <TableRow
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => setExpanded(open ? null : t.id)}
                      >
                        <TableCell sx={{ p: 0.5 }}>
                          {open ? (
                            <KeyboardArrowDownIcon fontSize="small" />
                          ) : (
                            <KeyboardArrowRightIcon fontSize="small" />
                          )}
                        </TableCell>
                        <TableCell sx={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                          {new Date(t.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell
                          sx={{
                            fontSize: 11,
                            maxWidth: 320,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {t.question}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={meta.label}
                            color={meta.color}
                            variant="outlined"
                            sx={{ fontSize: 10, height: 20 }}
                          />
                        </TableCell>
                        <TableCell
                          sx={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                          align="right"
                        >
                          {fmtMs(t.totalMs)}
                        </TableCell>
                        <TableCell sx={{ fontSize: 11 }} align="right">
                          {t.kbHits} / {t.exampleHits}
                          {t.predefinedHit ? ' · map' : ''}
                        </TableCell>
                        <TableCell
                          sx={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                          align="right"
                        >
                          {fmtScore(t.semanticTopScore)}
                        </TableCell>
                        <TableCell sx={{ fontSize: 11 }}>
                          {t.feedbackRating === 1
                            ? '👍 helpful'
                            : t.feedbackRating === -1
                              ? '👎 unhelpful'
                              : '—'}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          sx={{ py: 0, borderBottom: open ? undefined : 'none' }}
                        >
                          <Collapse in={open} unmountOnExit>
                            <TraceDetail trace={t} />
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
