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

  // useRef per la Map: non viene mai ricreata → nessuna perdita di dati al re-render
  const historyMapRef = useRef<Map<string, MetricsHistoryPoint[]>>(new Map())

  // maxPoints: basato su worst-case 30s di intervallo
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

  // Quando cambia retentionMinutes, taglia le entry esistenti in-place
  useEffect(() => {
    const map = historyMapRef.current
    for (const [serverId, points] of map) {
      if (points.length > maxPoints) {
        map.set(serverId, points.slice(points.length - maxPoints))
      }
    }
  }, [maxPoints])

  // getHistory legge dalla ref aggiornata: deps vuote perché i ref sono sempre correnti.
  // I consumer si ri-renderizzano tramite useMetricsStore (aggiornato da pushSnapshot).
  const getHistory = useCallback(
    (serverId: string): MetricsHistoryPoint[] => historyMapRef.current.get(serverId) ?? [],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Chiamata una volta sola da App.tsx al boot per pre-popolare la history da SQLite.
  // Setta historyMapRef (grafici dettaglio) + metricsStore (KPI + sparkline corrente).
  const seedHistory = useCallback(
    (allHistory: Record<string, ServerMetrics[]>) => {
      const map = historyMapRef.current
      for (const [sid, snapshots] of Object.entries(allHistory)) {
        if (snapshots.length === 0) continue
        map.set(
          sid,
          snapshots.map((m) => metricsToHistoryPoint(m)).slice(-maxPoints)
        )
      }
      useMetricsStore.getState().seedFromHistory(allHistory)
    },
    [maxPoints] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Notifica il main process quale server è "attivo" (riceve polling più frequente).
  // Il worker globale viene avviato da App.tsx con tutti i server.
  // NON ha cleanup su unmount: il worker deve sopravvivere alla navigazione.
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
