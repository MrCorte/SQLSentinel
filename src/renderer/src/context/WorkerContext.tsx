import { useState, useEffect, useCallback, useRef } from 'react'
import type { CollectMetricsRequest, ServerMetrics } from '../../../preload/index'
import { metricsToHistoryPoint, type MetricsHistoryPoint } from '../hooks/useMetrics'
import { WorkerContext } from './WorkerContextDef'
import { useMetricsStore } from '../store/metricsStore'

// Re-export for consumers that import WorkerContextValue from this file
export type { WorkerContextValue } from './WorkerContextDef'

export function WorkerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [intervalSeconds, setIntervalSeconds] = useState(0)
  const [connection, setConnection] = useState<CollectMetricsRequest | null>(null)
  const [retentionMinutes, setRetentionMinutes] = useState(60)

  // useRef for the Map: never recreated → no data loss on re-render
  const historyMapRef = useRef<Map<string, MetricsHistoryPoint[]>>(new Map())
  // Pending snapshots held while document is hidden; flushed on visibilitychange.
  // Keyed by serverId so the latest snapshot per server replaces the previous in
  // O(1) (was an array with an O(n) findIndex per push → O(n²) per hidden flush).
  const pendingBatchRef = useRef<Map<string, ServerMetrics>>(new Map())

  // maxPoints: worst-case 30s interval, but clamped. retentionMinutes can be set
  // up to a year (settings allows 525600), which would otherwise hold ~1M points
  // per server in memory; charts can't render more than a few thousand points
  // anyway. 2880 ≈ 24h at the 30s worst-case interval.
  const MAX_CHART_POINTS = 2880
  const maxPoints = Math.min(Math.ceil((retentionMinutes * 60) / 30), MAX_CHART_POINTS)

  // Flush pending store updates when the page becomes visible again.
  // Also flush on unmount so metrics buffered during a hidden window are not lost.
  useEffect(() => {
    function flush(): void {
      if (pendingBatchRef.current.size === 0) return
      const batch = Array.from(pendingBatchRef.current, ([serverId, metrics]) => ({
        serverId,
        metrics
      }))
      useMetricsStore.getState().applyDeltaBatch(batch)
      pendingBatchRef.current.clear()
    }
    function onVisibilityChange(): void {
      // Fires on both hidden→visible and visible→hidden; only flush when becoming visible
      if (!document.hidden) flush()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      flush() // drain any buffered snapshots on unmount
    }
  }, [])

  const pushSnapshot = useCallback(
    (serverId: string, m: ServerMetrics) => {
      // Always update history (no re-renders); skip store update when hidden
      const map = historyMapRef.current
      const existing = map.get(serverId) ?? []
      const newPoint = metricsToHistoryPoint(m)
      // Avoid double-allocation: only spread+slice when under cap, otherwise shift oldest
      map.set(
        serverId,
        existing.length < maxPoints
          ? [...existing, newPoint]
          : [...existing.slice(existing.length - maxPoints + 1), newPoint]
      )
      if (document.hidden) {
        pendingBatchRef.current.set(serverId, m)
        return
      }
      useMetricsStore.getState().applyDelta(serverId, m)
    },
    [maxPoints]
  )

  const pushSnapshotBatch = useCallback(
    (batch: Array<{ serverId: string; metrics: ServerMetrics }>) => {
      // Always update history; only update store when visible
      const map = historyMapRef.current
      for (const { serverId, metrics: m } of batch) {
        const existing = map.get(serverId) ?? []
        const newPoint = metricsToHistoryPoint(m)
        map.set(
          serverId,
          existing.length < maxPoints
            ? [...existing, newPoint]
            : [...existing.slice(existing.length - maxPoints + 1), newPoint]
        )
      }
      if (document.hidden) {
        // Replace pending entry for each server with the latest snapshot (O(1) each)
        for (const entry of batch) {
          pendingBatchRef.current.set(entry.serverId, entry.metrics)
        }
        return
      }
      useMetricsStore.getState().applyDeltaBatch(batch)
    },
    [maxPoints]
  )

  // When retentionMinutes changes, trim existing entries in-place
  useEffect(() => {
    const map = historyMapRef.current
    for (const [serverId, points] of map) {
      if (points.length > maxPoints) {
        map.set(serverId, points.slice(points.length - maxPoints))
      }
    }
  }, [maxPoints])

  // getHistory reads from the up-to-date ref: empty deps because refs are always current.
  // Consumers re-render via useMetricsStore (updated by pushSnapshot).
  const getHistory = useCallback(
    (serverId: string): MetricsHistoryPoint[] => historyMapRef.current.get(serverId) ?? [],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Called once from App.tsx at boot to pre-populate history from SQLite.
  // Sets historyMapRef (detail charts) + metricsStore (KPIs + current sparkline).
  const seedHistory = useCallback(
    (allHistory: Record<string, ServerMetrics[]>) => {
      const map = historyMapRef.current
      for (const [sid, snapshots] of Object.entries(allHistory)) {
        if (snapshots.length === 0) continue
        map.set(sid, snapshots.map((m) => metricsToHistoryPoint(m)).slice(-maxPoints))
      }
      useMetricsStore.getState().seedFromHistory(allHistory)
    },
    [maxPoints] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Notifies the main process which server is "active" (receives more frequent polling).
  // The global worker is started from App.tsx with all servers.
  // NO cleanup on unmount: the worker must survive navigation.
  useEffect(() => {
    if (!connection) return
    window.sqlSentinel.workerSetActive({ serverId: `${connection.ip}:${connection.port}` })
  }, [connection?.ip, connection?.port]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <WorkerContext.Provider
      value={{
        intervalSeconds,
        connection,
        retentionMinutes,
        setIntervalSeconds,
        setConnection,
        pushSnapshot,
        pushSnapshotBatch,
        getHistory,
        setRetentionMinutes,
        seedHistory
      }}
    >
      {children}
    </WorkerContext.Provider>
  )
}
