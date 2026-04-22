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

  // maxPoints: based on worst-case 30s interval
  const maxPoints = Math.ceil((retentionMinutes * 60) / 30)

  const pushSnapshot = useCallback(
    (serverId: string, m: ServerMetrics) => {
      // Apply delta or full update to the metrics store
      useMetricsStore.getState().applyDelta(serverId, m)
      const map = historyMapRef.current
      const existing = map.get(serverId) ?? []
      const newPoint = metricsToHistoryPoint(m)
      const updated = [...existing, newPoint].slice(-maxPoints)
      map.set(serverId, updated)
    },
    [maxPoints]
  )

  const pushSnapshotBatch = useCallback(
    (batch: Array<{ serverId: string; metrics: ServerMetrics }>) => {
      // Single Zustand set() for all servers in the batch
      useMetricsStore.getState().applyDeltaBatch(batch)
      const map = historyMapRef.current
      for (const { serverId, metrics: m } of batch) {
        const existing = map.get(serverId) ?? []
        const newPoint = metricsToHistoryPoint(m)
        map.set(serverId, [...existing, newPoint].slice(-maxPoints))
      }
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
