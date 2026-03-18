/**
 * Dev-only memory audit utility.
 *
 * Logs the current Zustand store sizes to the console and projects
 * how much renderer heap a 200-server / 1500-DB scenario would consume.
 *
 * Usage:
 *   import { auditMemory } from '@renderer/utils/memoryAudit'
 *   auditMemory()   // call from DevTools console or a useEffect in dev
 */

import { useMetricsStore } from '../store/metricsStore'
import { useAlertsStore } from '../store/alertsStore'
import { useServersStore } from '../store/serversStore'

const isDev = import.meta.env.DEV

/** Rough JSON-serialised size of a value in bytes. */
function roughBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

function fmt(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function auditMemory(): void {
  if (!isDev) return

  const metrics = useMetricsStore.getState()
  const alerts = useAlertsStore.getState()
  const servers = useServersStore.getState()

  const serverCount = servers.servers.length
  const metricsCount = Object.keys(metrics.metricsMap).length
  const summaryCount = Object.keys(metrics.summaries).length
  const historyCount = Object.keys(metrics.historyMap).length
  const alertCount = alerts.alerts.length

  const metricsBytes = roughBytes(metrics.metricsMap)
  const summaryBytes = roughBytes(metrics.summaries)
  const historyBytes = roughBytes(metrics.historyMap)
  const alertBytes = roughBytes(alerts.alerts)

  console.group('[MemoryAudit] SQLSentinel renderer store sizes')
  console.table({
    servers:      { count: serverCount,  size: fmt(roughBytes(servers.servers)) },
    metricsMap:   { count: metricsCount, size: fmt(metricsBytes) },
    summaries:    { count: summaryCount, size: fmt(summaryBytes) },
    historyMap:   { count: historyCount, size: fmt(historyBytes) },
    alerts:       { count: alertCount,   size: fmt(alertBytes) }
  })

  // ── 200-server projection ─────────────────────────────────────────────────
  // Per-server averages (from current data, fallback to baseline estimates)
  const perServerMetrics = metricsCount > 0
    ? metricsBytes / metricsCount
    : 8 * 1024           // ~8 KB baseline per server (no detailed DB list)

  const perServerSummary = summaryCount > 0
    ? summaryBytes / summaryCount
    : 128                // ~128 B per summary (7 numeric fields)

  const perServerHistory = historyCount > 0
    ? historyBytes / historyCount
    : 60 * 2 * 16        // 60 points × 2 arrays × 16 B per HistoryPoint

  const TARGET_SERVERS = 200
  const TARGET_DBS = 1500

  // metricsMap projection: only active server kept full + rest as summaries
  const projMetrics  = perServerMetrics  * 1  // 1 active server full
  const projSummary  = perServerSummary  * TARGET_SERVERS
  const projHistory  = perServerHistory  * TARGET_SERVERS
  // DB rows per server in full metrics (~1 KB per DB row)
  const projDbRows   = (TARGET_DBS / TARGET_SERVERS) * 1024 // per-server avg

  const projTotal = projMetrics + projSummary + projHistory + projDbRows * TARGET_SERVERS

  console.group('[MemoryAudit] 200-server / 1500-DB projection')
  console.table({
    'metricsMap (1 active)':  fmt(projMetrics),
    'summaries (200 servers)': fmt(projSummary),
    'historyMap (200×60pts)':  fmt(projHistory),
    'DB rows in fullMetrics':  fmt(projDbRows * TARGET_SERVERS),
    'TOTAL (estimated)':       fmt(projTotal)
  })
  console.groupEnd()
  console.groupEnd()
}
