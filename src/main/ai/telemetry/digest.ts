import type { ServerMetrics } from '../../collectors/types'

// ---------------------------------------------------------------------------
// Telemetry digest — il "documento" del RAG sull'observability.
//
// Gli snapshot grezzi (uno ogni N secondi, diversi KB di JSON ciascuno) sono
// troppi e troppo verbosi per un prompt. Come in una pipeline big-data li
// "arrotoliamo" (rollup) in un digest per server per ora:
//   feature numeriche  → colonne tipizzate (aggregabili in SQL)
//   flag di anomalia   → confronto con la baseline del server stesso
//   testo compatto     → quello che leggerà l'LLM (ed è ciò che viene embeddato)
//
// Funzioni pure: nessun accesso a storage/rete, testabili in isolamento.
// ---------------------------------------------------------------------------

export interface DigestAlert {
  severity: string
  category: string
  message: string
}

export interface DigestIncident {
  category: string
  severity: string
  summary: string | null
  rootCause: string | null
}

/** Aggregati calcolati in SQL su TUTTI gli snapshot dell'ora (non solo il campione). */
export interface BucketAggregates {
  snapshotCount: number
  cpuAvg: number | null
  cpuMax: number | null
  memPctAvg: number | null
}

export interface Baseline {
  /** Numero di digest storici usati (0 = nessuna baseline). */
  samples: number
  /** Mediana CPU media: preferibilmente della stessa ora del giorno (stagionalità). */
  cpuAvgMedian: number | null
  blockingMaxMedian: number | null
  /** Wait type che compaiono più spesso nel top-3 storico. */
  usualWaits: string[]
  sameHourOfDay: boolean
}

export interface WaitDelta {
  waitType: string
  /** Quota % del tempo di attesa accumulato NELL'ORA (delta), non da restart. */
  pct: number
  waitMs: number
}

export type AnomalyFlag =
  | 'cpu_spike'
  | 'blocking'
  | 'unusual_wait'
  | 'disk_low'
  | 'db_offline'
  | 'restart'
  | 'critical_alert'
  | 'incident'

export interface DigestFeatures {
  snapshotCount: number
  cpuAvg: number | null
  cpuMax: number | null
  memPctAvg: number | null
  blockingMax: number
  longestBlockedWaitMs: number
  topWaits: WaitDelta[]
  diskMinFreePct: number | null
  diskMinVolume: string | null
  offlineDbs: string[]
  restartDetected: boolean
  topQuery: { text: string; avgCpuMs: number; executions: number } | null
  alertCount: number
  criticalAlerts: number
  incidentCount: number
}

export interface TelemetryDigest {
  serverId: string
  bucketStart: Date
  bucketEnd: Date
  features: DigestFeatures
  anomalyFlags: AnomalyFlag[]
  anomalyScore: number
  text: string
}

// Wait "benigni" che sys.dm_os_wait_stats accumula anche a server fermo. Il
// collector già filtra gli idle principali; questa è una seconda rete di sicurezza.
const BENIGN_WAITS = new Set([
  'SLEEP_TASK',
  'BROKER_TASK_STOP',
  'SQLTRACE_BUFFER_FLUSH',
  'CLR_AUTO_EVENT',
  'LAZYWRITER_SLEEP',
  'XE_TIMER_EVENT',
  'REQUEST_FOR_DEADLOCK_SEARCH',
  'CHECKPOINT_QUEUE',
  'DIRTY_PAGE_POLL',
  'HADR_FILESTREAM_IOMGR_IOCOMPLETION',
  'SP_SERVER_DIAGNOSTICS_SLEEP',
  'WAITFOR'
])

/**
 * Le wait stats del collector sono cumulative dal restart. Il segnale utile è
 * il DELTA nell'ora: cosa ha atteso SQL Server in quei 60 minuti. Se un delta
 * è negativo (restart o DBCC SQLPERF CLEAR) si ricade sull'ultimo snapshot.
 */
export function computeWaitDeltas(
  first: ServerMetrics,
  last: ServerMetrics,
  topN = 3
): WaitDelta[] {
  const before = new Map(first.waitStats.map((w) => [w.waitType, w.waitTimeMs]))
  let reset = false
  const deltas: { waitType: string; waitMs: number }[] = []
  for (const w of last.waitStats) {
    if (BENIGN_WAITS.has(w.waitType)) continue
    const prev = before.get(w.waitType) ?? 0
    const d = w.waitTimeMs - prev
    if (d < 0) reset = true
    deltas.push({ waitType: w.waitType, waitMs: d })
  }
  const source =
    reset || first === last
      ? last.waitStats
          .filter((w) => !BENIGN_WAITS.has(w.waitType))
          .map((w) => ({ waitType: w.waitType, waitMs: w.waitTimeMs }))
      : deltas.filter((d) => d.waitMs > 0)
  const total = source.reduce((s, d) => s + d.waitMs, 0)
  if (total <= 0) return []
  return source
    .sort((a, b) => b.waitMs - a.waitMs)
    .slice(0, topN)
    .map((d) => ({
      waitType: d.waitType,
      waitMs: d.waitMs,
      pct: Math.round((d.waitMs / total) * 100)
    }))
}

export function extractFeatures(
  snapshots: ServerMetrics[],
  agg: BucketAggregates,
  alerts: DigestAlert[],
  incidents: DigestIncident[]
): DigestFeatures {
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]

  let blockingMax = 0
  let longestBlockedWaitMs = 0
  const offline = new Set<string>()
  let restartDetected = false
  let prevUptime: number | null = null
  for (const s of snapshots) {
    const blocked = s.activeSessions.filter((x) => x.blockingSessionId > 0)
    blockingMax = Math.max(blockingMax, blocked.length)
    for (const b of blocked) longestBlockedWaitMs = Math.max(longestBlockedWaitMs, b.waitTimeMs)
    for (const d of s.databases)
      if (d.stateDesc !== 'ONLINE') offline.add(`${d.name} (${d.stateDesc})`)
    const up = s.instanceInfo.uptimeDays
    if (prevUptime != null && up + 0.001 < prevUptime) restartDetected = true
    prevUptime = up
  }

  let diskMinFreePct: number | null = null
  let diskMinVolume: string | null = null
  for (const v of last?.diskVolumes ?? []) {
    if (diskMinFreePct == null || v.free_pct < diskMinFreePct) {
      diskMinFreePct = v.free_pct
      diskMinVolume = v.volume_mount_point
    }
  }

  const q = last?.topQueries?.[0]
  return {
    snapshotCount: agg.snapshotCount,
    cpuAvg: agg.cpuAvg,
    cpuMax: agg.cpuMax,
    memPctAvg: agg.memPctAvg,
    blockingMax,
    longestBlockedWaitMs,
    topWaits: first && last ? computeWaitDeltas(first, last) : [],
    diskMinFreePct,
    diskMinVolume,
    offlineDbs: Array.from(offline),
    restartDetected,
    topQuery: q
      ? {
          text: q.queryText.replace(/\s+/g, ' ').trim().slice(0, 120),
          avgCpuMs: Math.round(q.avgCpuTimeMs),
          executions: q.executionCount
        }
      : null,
    alertCount: alerts.length,
    criticalAlerts: alerts.filter((a) => a.severity === 'critical').length,
    incidentCount: incidents.length
  }
}

/**
 * Anomaly detection "relativa": un server che gira sempre all'80% non è in
 * anomalia all'80%; uno che gira al 10% sì. Senza baseline (primi giorni) si
 * usano soglie assolute conservative.
 */
export function detectAnomalies(
  f: DigestFeatures,
  b: Baseline | null
): { flags: AnomalyFlag[]; score: number } {
  const flags: AnomalyFlag[] = []
  let score = 0
  const hasBaseline = b != null && b.samples >= 3

  if (f.cpuAvg != null) {
    const usual = hasBaseline ? b!.cpuAvgMedian : null
    const spike =
      usual != null
        ? f.cpuAvg >= 50 && f.cpuAvg >= usual * 1.5 && f.cpuAvg - usual >= 15
        : f.cpuAvg >= 80
    if (spike) {
      flags.push('cpu_spike')
      score += 2 + ((f.cpuMax ?? 0) >= 95 ? 1 : 0)
    }
  }

  const usualBlocking = hasBaseline ? (b!.blockingMaxMedian ?? 0) : 0
  if (f.blockingMax >= 3 && f.blockingMax > usualBlocking * 2) {
    flags.push('blocking')
    score += 2 + (f.longestBlockedWaitMs >= 30_000 ? 1 : 0)
  }

  const top = f.topWaits[0]
  if (
    hasBaseline &&
    top &&
    top.pct >= 30 &&
    b!.usualWaits.length > 0 &&
    !b!.usualWaits.includes(top.waitType)
  ) {
    flags.push('unusual_wait')
    score += 1
  }

  if (f.diskMinFreePct != null && f.diskMinFreePct < 10) {
    flags.push('disk_low')
    score += f.diskMinFreePct < 5 ? 3 : 2
  }
  if (f.offlineDbs.length > 0) {
    flags.push('db_offline')
    score += 3
  }
  if (f.restartDetected) {
    flags.push('restart')
    score += 2
  }
  if (f.criticalAlerts > 0) {
    flags.push('critical_alert')
    score += 2
  } else if (f.alertCount > 0) {
    score += 1
  }
  if (f.incidentCount > 0) {
    flags.push('incident')
    score += 2
  }
  return { flags, score }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** "2026-11-12 14:00" in ora locale. */
export function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDuration(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}min`
  return `${Math.round(ms / 1000)}s`
}

function pct(v: number | null): string {
  return v == null ? 'n/a' : `${Math.round(v)}%`
}

export function renderDigestText(
  serverLabel: string,
  bucketStart: Date,
  bucketEnd: Date,
  f: DigestFeatures,
  flags: AnomalyFlag[],
  baseline: Baseline | null,
  alerts: DigestAlert[],
  incidents: DigestIncident[]
): string {
  const parts: string[] = []
  const usualCpu =
    baseline && baseline.samples >= 3 && baseline.cpuAvgMedian != null
      ? `; usual ${pct(baseline.cpuAvgMedian)}${baseline.sameHourOfDay ? ' at this hour' : ''}`
      : ''
  parts.push(`CPU avg ${pct(f.cpuAvg)} (max ${pct(f.cpuMax)}${usualCpu})`)
  if (f.memPctAvg != null) parts.push(`mem ${pct(f.memPctAvg)} of target`)
  if (f.blockingMax > 0) {
    parts.push(
      `blocking up to ${f.blockingMax} sessions${
        f.longestBlockedWaitMs > 0 ? ` (longest wait ${fmtDuration(f.longestBlockedWaitMs)})` : ''
      }`
    )
  }
  if (f.topWaits.length > 0) {
    parts.push(`top waits: ${f.topWaits.map((w) => `${w.waitType} ${w.pct}%`).join(', ')}`)
  }
  if (f.diskMinFreePct != null && f.diskMinFreePct < 20) {
    parts.push(
      `disk ${f.diskMinVolume ?? ''} ${Math.round(f.diskMinFreePct)}% free`.replace('  ', ' ')
    )
  }
  if (f.offlineDbs.length > 0) parts.push(`NOT ONLINE: ${f.offlineDbs.slice(0, 5).join(', ')}`)
  if (f.restartDetected) parts.push('instance RESTART detected')
  if (f.topQuery && (flags.includes('cpu_spike') || flags.length === 0)) {
    parts.push(
      `top query (avg cpu ${f.topQuery.avgCpuMs}ms × ${f.topQuery.executions}): ${f.topQuery.text}`
    )
  }
  if (alerts.length > 0) {
    const shown = alerts
      .slice()
      .sort((a, b) => (a.severity === 'critical' ? -1 : 0) - (b.severity === 'critical' ? -1 : 0))
      .slice(0, 2)
      .map((a) => `[${a.severity}] ${a.category}: ${a.message.slice(0, 120)}`)
    parts.push(`alerts (${alerts.length}): ${shown.join(' | ')}`)
  }
  for (const inc of incidents.slice(0, 2)) {
    const rc = inc.rootCause
      ? ` — root cause: ${inc.rootCause.replace(/\s+/g, ' ').slice(0, 200)}`
      : ''
    const sm = inc.summary ? ` ${inc.summary.replace(/\s+/g, ' ').slice(0, 160)}` : ''
    parts.push(`incident [${inc.severity}] ${inc.category}:${sm}${rc}`)
  }
  const flagStr = flags.length > 0 ? ` ⚠ ANOMALIES: ${flags.join(', ')}` : ''
  return `[${fmtLocal(bucketStart)}–${pad(bucketEnd.getHours())}:${pad(bucketEnd.getMinutes())}] ${serverLabel} (${f.snapshotCount} samples) — ${parts.join(' · ')}${flagStr}`
}

export function buildDigest(input: {
  serverId: string
  serverLabel: string
  bucketStart: Date
  bucketEnd: Date
  snapshots: ServerMetrics[]
  aggregates: BucketAggregates
  alerts: DigestAlert[]
  incidents: DigestIncident[]
  baseline: Baseline | null
}): TelemetryDigest {
  const features = extractFeatures(input.snapshots, input.aggregates, input.alerts, input.incidents)
  const { flags, score } = detectAnomalies(features, input.baseline)
  return {
    serverId: input.serverId,
    bucketStart: input.bucketStart,
    bucketEnd: input.bucketEnd,
    features,
    anomalyFlags: flags,
    anomalyScore: score,
    text: renderDigestText(
      input.serverLabel,
      input.bucketStart,
      input.bucketEnd,
      features,
      flags,
      input.baseline,
      input.alerts,
      input.incidents
    )
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Baseline dai digest già calcolati degli ultimi 7 giorni. Preferisce la
 * stessa ora del giorno (≥3 campioni): un picco di CPU alle 02:00 durante il
 * job di backup notturno è "normale", alle 15:00 no.
 */
export function computeBaseline(
  history: {
    bucketStart: Date
    cpuAvg: number | null
    blockingMax: number
    topWaits: WaitDelta[]
  }[],
  forBucketStart: Date
): Baseline | null {
  if (history.length === 0) return null
  const sameHour = history.filter((h) => h.bucketStart.getHours() === forBucketStart.getHours())
  const useSameHour = sameHour.length >= 3
  const pool = useSameHour ? sameHour : history
  const waitFreq = new Map<string, number>()
  for (const h of history)
    for (const w of h.topWaits) waitFreq.set(w.waitType, (waitFreq.get(w.waitType) ?? 0) + 1)
  const usualWaits = Array.from(waitFreq.entries())
    .filter(([, n]) => n >= Math.max(2, history.length * 0.2))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w)
  return {
    samples: history.length,
    cpuAvgMedian: median(pool.map((h) => h.cpuAvg).filter((v): v is number => v != null)),
    blockingMaxMedian: median(pool.map((h) => h.blockingMax)),
    usualWaits,
    sameHourOfDay: useSameHour
  }
}
