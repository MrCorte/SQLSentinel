import { useState, useCallback, useRef } from 'react'
import type { CollectMetricsRequest, ServerMetrics } from '../../../preload/index'
import { useMetricsStore } from '../store/metricsStore'

export interface MetricsHistoryPoint {
  timestamp: number // ms epoch
  memoryUsedMb: number
  memoryPercent: number // memoryUsedMb / memoryTargetMb * 100
  cpuUsagePercent: number
}

export function metricsToHistoryPoint(m: ServerMetrics): MetricsHistoryPoint {
  const target = m.instanceInfo.memoryTargetMb
  return {
    timestamp: new Date(m.collectedAt).getTime(),
    memoryUsedMb: m.instanceInfo.memoryUsedMb,
    memoryPercent: target > 0 ? Math.min(100, (m.instanceInfo.memoryUsedMb / target) * 100) : 0,
    cpuUsagePercent: m.instanceInfo.cpuUsagePercent
  }
}

interface UseMetricsOptions {
  /** Called whenever metrics are received (push or manual refresh) — used to feed historyMap in WorkerContext */
  onReceived?: (serverId: string, m: ServerMetrics) => void
}

function connKey(conn: CollectMetricsRequest | null): string {
  return conn ? `${conn.ip}:${conn.port}` : ''
}

export function useMetrics(connection: CollectMetricsRequest | null, options?: UseMetricsOptions) {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track which connection the current metrics belong to.
  // When connection changes we clear stale local metrics synchronously
  // (before the next render) so server A's data never shows while server B is selected.
  const [trackedKey, setTrackedKey] = useState(() => connKey(connection))
  const currentKey = connKey(connection)
  if (trackedKey !== currentKey) {
    setTrackedKey(currentKey)
    setMetrics(null)
    setError(null)
  }

  const connectionRef = useRef(connection)
  connectionRef.current = connection

  const onReceivedRef = useRef(options?.onReceived)
  onReceivedRef.current = options?.onReceived

  /** Called by Dashboard when a push metric arrives via onMetricsUpdated */
  const receiveMetrics = useCallback((m: ServerMetrics) => {
    setError(null)
    setMetrics(m)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const conn = connectionRef.current
    if (!conn) return
    const keyAtStart = connKey(conn)
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.sqlSentinel.collectMetrics(conn)

      // Guard: if the user switched to a different server while this was in-flight,
      // still persist to the global store (so the data isn't lost) but don't
      // update local component state — that would show a different server's data.
      const serverId = `${conn.ip}:${conn.port}`
      if (result.ok) {
        useMetricsStore.getState().setMetrics(serverId, result.data)
        onReceivedRef.current?.(serverId, result.data)
        if (connKey(connectionRef.current) === keyAtStart) {
          setMetrics(result.data)
        }
      } else {
        if (connKey(connectionRef.current) === keyAtStart) {
          setError(result.error)
        }
      }
    } catch {
      if (connKey(connectionRef.current) === keyAtStart) {
        setError('Raccolta metriche fallita inaspettatamente')
      }
    } finally {
      if (connKey(connectionRef.current) === keyAtStart) {
        setIsLoading(false)
      }
    }
  }, [])

  return { metrics, isLoading, error, refresh, receiveMetrics }
}
