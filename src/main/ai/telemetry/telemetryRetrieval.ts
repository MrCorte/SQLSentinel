import { createLogger } from '../../utils/logger'
import * as serverStore from '../../store/sqlserver/serverRepository'
import type { StoredServer } from '../../store/sqlserver/serverRepository'
import {
  listDigestsInWindow,
  listAnomalousWithEmbedding,
  loadBaselineHistory,
  type StoredDigest
} from '../../store/sqlserver/telemetryDigestRepository'
import { getQueryEmbedding, unpackEmbedding, cosineSimilarity } from '../embedder'
import { computeBaseline, fmtLocal, type TelemetryDigest } from './digest'
import { parseTimeRange, asksForHistory, type TimeRange } from './timeRange'

const log = createLogger('telemetryRag')

// ---------------------------------------------------------------------------
// Observability RAG — retrieval.
//
// Pipeline per ogni domanda:
//   1. scope   → quali server? (nominati nella domanda > server selezionato > fleet)
//   2. quando  → finestra temporale estratta dalla domanda (default: ultime 6h)
//   3. fetch   → digest orari della finestra (filtro strutturato, ordinati per anomalia)
//   4. baseline→ "com'è di solito" questo server (stessa ora del giorno se possibile)
//   5. precedenti → ricerca semantica tra gli episodi anomali PASSATI
//                   ("è già successo?") — embedding del sintomo vs embedding dei digest
//   6. render  → blocco <<TELEMETRY_HISTORY>> compatto entro un budget di caratteri
// ---------------------------------------------------------------------------

const HOUR = 3_600_000
const DEFAULT_WINDOW_HOURS = 6
const MAX_WINDOW_DIGESTS = 10
const MAX_BLOCK_CHARS = 3200
const PRECEDENT_MIN_SCORE = 2
const PRECEDENT_SIMILARITY = 0.6
const PRECEDENT_INDEX_MAX = 3000

export interface TelemetryRetrieval {
  /** Blocco di contesto per il prompt ('' se non c'è nulla di utile). */
  block: string
  /** Riepilogo per la timeline dei tool nella UI. */
  display: string
  /** Vero se la domanda parla esplicitamente di passato/trend → priorità alta nel contesto. */
  temporal: boolean
  windowDigests: number
  anomalous: number
  precedents: { title: string; score: number }[]
}

// --- Indice in memoria degli episodi anomali (per la similarità) ----------
interface IndexEntry {
  id: string
  serverId: string
  bucketStart: Date
  text: string
  vec: Float32Array
}
let _index: IndexEntry[] = []
let _indexLoaded = false
let _indexLoading: Promise<void> | null = null

async function ensureIndex(): Promise<void> {
  if (_indexLoaded) return
  if (_indexLoading) return _indexLoading
  _indexLoading = (async () => {
    try {
      const rows = await listAnomalousWithEmbedding(PRECEDENT_MIN_SCORE, PRECEDENT_INDEX_MAX)
      _index = rows.map((r) => ({
        id: r.id,
        serverId: r.serverId,
        bucketStart: r.bucketStart,
        text: r.text,
        vec: unpackEmbedding(r.embedding)
      }))
      _indexLoaded = true
      log.info(`loaded ${_index.length} anomalous digest(s) into precedent index`)
    } catch (err) {
      log.warn('precedent index load failed:', err instanceof Error ? err.message : String(err))
    } finally {
      _indexLoading = null
    }
  })()
  return _indexLoading
}

/** Chiamato dal job: il nuovo episodio anomalo è subito ricercabile. */
export function onDigestInserted(e: {
  id: string
  digest: TelemetryDigest
  vec: Float32Array
}): void {
  if (!_indexLoaded || e.digest.anomalyScore < PRECEDENT_MIN_SCORE) return
  _index.unshift({
    id: e.id,
    serverId: e.digest.serverId,
    bucketStart: e.digest.bucketStart,
    text: e.digest.text,
    vec: e.vec
  })
  if (_index.length > PRECEDENT_INDEX_MAX) _index.length = PRECEDENT_INDEX_MAX
}

export function resetTelemetryIndex(): void {
  _index = []
  _indexLoaded = false
  _indexLoading = null
}

// --- 1. scope ---------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Server citati nella domanda per host, machine name o nome istanza. */
export function matchServers(question: string, servers: StoredServer[]): StoredServer[] {
  const q = question.toLowerCase()
  return servers.filter((s) => {
    const names = [s.host, s.ip, s.machineName, s.instanceName, s.host?.split('.')[0]]
      .filter((n): n is string => !!n && n.length >= 3)
      .map((n) => n.toLowerCase())
    return names.some((n) => new RegExp(`(^|[^a-z0-9_-])${escapeRe(n)}($|[^a-z0-9_-])`).test(q))
  })
}

function label(s: StoredServer): string {
  return `${s.host}:${s.port}${s.machineName && s.machineName.toLowerCase() !== s.host.toLowerCase() ? ` (${s.machineName})` : ''}`
}

function tzLabel(now: Date): string {
  const off = -now.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const a = Math.abs(off)
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

// --- main entry ---------------------------------------------------------------

export async function retrieveTelemetry(
  question: string,
  targetServerId?: string | null,
  now: Date = new Date()
): Promise<TelemetryRetrieval> {
  const servers = serverStore.getAllStripped()
  const empty: TelemetryRetrieval = {
    block: '',
    display: 'No telemetry history available.',
    temporal: false,
    windowDigests: 0,
    anomalous: 0,
    precedents: []
  }
  if (servers.length === 0) return empty

  // 1. scope
  const mentioned = matchServers(question, servers)
  const scope: StoredServer[] =
    mentioned.length > 0
      ? mentioned
      : targetServerId
        ? servers.filter((s) => s.id === targetServerId)
        : []
  const fleetWide = scope.length === 0

  // 2. finestra
  const parsed = parseTimeRange(question, now)
  const wantsHistory = asksForHistory(question)
  const temporal = parsed != null || wantsHistory
  const range: TimeRange = parsed ?? {
    from: new Date(now.getTime() - DEFAULT_WINDOW_HOURS * HOUR),
    to: now,
    label: `last ${DEFAULT_WINDOW_HOURS}h`
  }

  // 3. digest della finestra
  let digests: StoredDigest[] = []
  if (fleetWide) {
    digests = await listDigestsInWindow(null, range.from, range.to, 200)
  } else {
    const per = await Promise.all(
      scope.map((s) => listDigestsInWindow(s.id, range.from, range.to, 200))
    )
    digests = per.flat()
  }
  const totalInWindow = digests.length
  const anomalousAll = digests.filter((d) => d.anomalyScore >= PRECEDENT_MIN_SCORE)

  // Senza domanda temporale e senza anomalie recenti il blocco sarebbe solo
  // rumore nel prompt: in quel caso ci limitiamo a una riga di riepilogo.
  let selected: StoredDigest[]
  if (temporal) {
    // Le ore più anomale prima, ma sempre almeno qualche ora "di contesto"
    selected = digests.slice(0, MAX_WINDOW_DIGESTS)
  } else {
    selected = anomalousAll.slice(0, 6)
  }
  selected.sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())

  // 4. baseline (solo con scope a server singolo: per la fleet non ha senso)
  let baselineLine = ''
  if (scope.length === 1 && (temporal || anomalousAll.length > 0)) {
    try {
      const hist = await loadBaselineHistory(scope[0].id, range.from)
      const b = computeBaseline(hist, range.from)
      if (b && b.samples >= 3) {
        baselineLine =
          `Usual behaviour of ${label(scope[0])} (previous 7 days, ${b.samples} hourly digests): ` +
          `CPU avg ~${b.cpuAvgMedian != null ? Math.round(b.cpuAvgMedian) : 'n/a'}%` +
          `${b.sameHourOfDay ? ' at this hour of day' : ''}, blocking max ~${b.blockingMaxMedian ?? 0} sessions` +
          (b.usualWaits.length ? `, usual top waits: ${b.usualWaits.slice(0, 4).join(', ')}` : '')
      }
    } catch {
      /* best-effort */
    }
  }

  // 5. precedenti simili (fuori dalla finestra corrente)
  let precedents: { title: string; score: number; text: string }[] = []
  const symptom = anomalousAll[0]?.text ?? (wantsHistory ? question : null)
  if (symptom && (wantsHistory || anomalousAll.length > 0)) {
    try {
      await ensureIndex()
      if (_index.length > 0) {
        const qv = await getQueryEmbedding(
          symptom === question ? question : `${question}\n${symptom}`
        )
        const scopeIds = new Set(scope.map((s) => s.id))
        precedents = _index
          .filter((e) => e.bucketStart < range.from || e.bucketStart >= range.to)
          // Server nominati esplicitamente → solo i loro precedenti; altrimenti
          // anche episodi di altri server (stesso sintomo altrove è un indizio).
          .filter((e) => mentioned.length === 0 || scopeIds.has(e.serverId))
          .map((e) => ({ e, score: cosineSimilarity(qv, e.vec) }))
          .filter((x) => x.score >= PRECEDENT_SIMILARITY)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((x) => ({ title: x.e.text.slice(0, 80), score: x.score, text: x.e.text }))
      }
    } catch {
      /* embedder giù: niente precedenti, il resto resta valido */
    }
  }

  // 6. render
  if (selected.length === 0 && !baselineLine && precedents.length === 0) {
    if (totalInWindow === 0) {
      return {
        ...empty,
        temporal,
        display: `No digests for ${range.label}${fleetWide ? '' : ` on ${scope.map(label).join(', ')}`}.`
      }
    }
    // Finestra tranquilla: una riga sola, così l'LLM sa che "non è successo nulla"
    const cpuMax = Math.max(...digests.map((d) => d.cpuMax ?? 0))
    const block = `Window: ${range.label} — ${totalInWindow} hourly digests, no anomalies detected (peak CPU ${Math.round(cpuMax)}%).`
    return {
      block,
      display: block,
      temporal,
      windowDigests: totalInWindow,
      anomalous: 0,
      precedents: []
    }
  }

  const header =
    `Times are local (${tzLabel(now)}). Window: ${range.label} ` +
    `(${fmtLocal(range.from)} → ${fmtLocal(range.to)}) · scope: ${fleetWide ? 'all servers' : scope.map(label).join(', ')}` +
    ` · ${totalInWindow} hourly digests, ${anomalousAll.length} anomalous` +
    (totalInWindow > selected.length ? ` (showing ${selected.length}; quiet hours omitted)` : '')
  const lines: string[] = [header]
  if (selected.length > 0) {
    lines.push('Hourly digests:')
    for (const d of selected) lines.push(`- ${d.text}`)
  }
  if (baselineLine) lines.push(baselineLine)
  if (precedents.length > 0) {
    lines.push('Similar past episodes (precedents, outside the window):')
    for (const p of precedents) lines.push(`- (similarity ${p.score.toFixed(2)}) ${p.text}`)
  }

  let block = ''
  for (const line of lines) {
    if (block.length + line.length + 1 > MAX_BLOCK_CHARS) break
    block += (block ? '\n' : '') + line
  }

  return {
    block,
    display:
      `${range.label}: ${totalInWindow} digests (${anomalousAll.length} anomalous), ` +
      `${precedents.length} precedent(s)${baselineLine ? ', baseline' : ''}`,
    temporal,
    windowDigests: totalInWindow,
    anomalous: anomalousAll.length,
    precedents: precedents.map((p) => ({ title: p.title, score: p.score }))
  }
}
