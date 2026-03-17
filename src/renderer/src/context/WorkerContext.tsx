import { useState, useEffect, useCallback, useRef } from 'react'
import type { CollectMetricsRequest, ServerMetrics } from '../../../preload/index'
import { metricsToHistoryPoint } from '../hooks/useMetrics'
import type { MetricsHistoryPoint } from '../hooks/useMetrics'
import { WorkerContext } from './WorkerContextDef'

// Re-export for consumers that import WorkerContextValue from this file
export type { WorkerContextValue } from './WorkerContextDef'

export function WorkerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [intervalSeconds, setIntervalSeconds] = useState(0)
  const [connection, setConnection] = useState<CollectMetricsRequest | null>(null)
  const [retentionMinutes, setRetentionMinutes] = useState(60)

  // useRef per la Map: non viene mai ricreata → nessuna perdita di dati al re-render
  // historyVersion: contatore che forza il re-render quando la Map cambia
  const historyMapRef = useRef<Map<string, MetricsHistoryPoint[]>>(new Map())
  const [historyVersion, setHistoryVersion] = useState(0)

  // maxPoints: basato su worst-case 30s di intervallo
  const maxPoints = Math.ceil((retentionMinutes * 60) / 30)

  const pushSnapshot = useCallback(
    (serverId: string, m: ServerMetrics) => {
      const map = historyMapRef.current
      const existing = map.get(serverId) ?? []
      const newPoint = metricsToHistoryPoint(m)
      const updated = [...existing, newPoint].slice(-maxPoints)
      map.set(serverId, updated)
      console.log(
        '[WorkerContext] pushSnapshot',
        serverId,
        'map size:',
        map.size,
        'punti per questo server:',
        updated.length
      )
      setHistoryVersion((v) => v + 1)
    },
    [maxPoints]
  )

  // Quando cambia retentionMinutes, taglia le entry esistenti in-place
  useEffect(() => {
    const map = historyMapRef.current
    let changed = false
    for (const [serverId, points] of map) {
      if (points.length > maxPoints) {
        map.set(serverId, points.slice(points.length - maxPoints))
        changed = true
      }
    }
    if (changed) setHistoryVersion((v) => v + 1)
  }, [maxPoints])

  // getHistory legge sempre dalla ref aggiornata.
  // historyVersion come dep garantisce che i consumer ricevano una nuova funzione
  // (e quindi si ri-rendano) ogni volta che la Map viene aggiornata.
  const getHistory = useCallback(
    (serverId: string): MetricsHistoryPoint[] => {
      const snapshots = historyMapRef.current.get(serverId) ?? []
      console.log(
        '[WorkerContext] getHistory',
        serverId,
        'punti:',
        snapshots.length,
        'map size:',
        historyMapRef.current.size
      )
      return snapshots
    },
    [historyVersion] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Gestisce workerStart / workerStop in base allo stato.
  // NON ha cleanup su unmount: il worker deve sopravvivere alla navigazione.
  useEffect(() => {
    if (intervalSeconds <= 0 || !connection) {
      console.log(
        '[WorkerContext] workerStop — intervalSeconds=',
        intervalSeconds,
        'connection=',
        connection?.ip
      )
      window.sqlSentinel.workerStop()
      return
    }
    console.log(
      '[WorkerContext] workerStart — intervalSeconds=',
      intervalSeconds,
      'server=',
      `${connection.ip}:${connection.port}`
    )
    window.sqlSentinel.workerStart({ intervalSeconds, servers: [connection] })
    // Nessun cleanup: il worker rimane attivo anche se Dashboard si smonta
  }, [intervalSeconds, connection?.ip, connection?.port]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <WorkerContext.Provider
      value={{
        intervalSeconds,
        connection,
        retentionMinutes,
        setIntervalSeconds,
        setConnection,
        pushSnapshot,
        getHistory,
        setRetentionMinutes
      }}
    >
      {children}
    </WorkerContext.Provider>
  )
}
