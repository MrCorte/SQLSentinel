import { useState, useCallback, useEffect, useRef } from 'react'
import type { CollectMetricsRequest, ServerMetrics } from '../../../preload/index'

const MAX_HISTORY = 60 // punti di history per i grafici

export interface MetricsHistoryPoint {
  timestamp: number // ms epoch
  memoryUsedMb: number
  cpuUsagePercent: number
}

export function useMetrics(connection: CollectMetricsRequest | null) {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<MetricsHistoryPoint[]>([])
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(0) // 0 = disabilitato

  const connectionRef = useRef(connection)
  connectionRef.current = connection

  const refresh = useCallback(async (): Promise<void> => {
    if (!connectionRef.current) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.sqlSentinel.collectMetrics(connectionRef.current)
      if (result.ok) {
        setMetrics(result.data)
        setHistory((prev) => {
          const point: MetricsHistoryPoint = {
            timestamp: new Date(result.data.collectedAt).getTime(),
            memoryUsedMb: result.data.instanceInfo.memoryUsedMb,
            cpuUsagePercent: result.data.instanceInfo.cpuUsagePercent
          }
          const updated = [...prev, point]
          return updated.length > MAX_HISTORY ? updated.slice(updated.length - MAX_HISTORY) : updated
        })
      } else {
        setError(result.error)
      }
    } catch {
      setError('Raccolta metriche fallita inaspettatamente')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshSeconds <= 0 || !connection) return
    const id = setInterval(() => {
      refresh()
    }, autoRefreshSeconds * 1000)
    return () => clearInterval(id)
  }, [autoRefreshSeconds, connection, refresh])

  // Reset state quando cambia il server selezionato
  useEffect(() => {
    setMetrics(null)
    setHistory([])
    setError(null)
  }, [connection?.ip, connection?.port])

  return { metrics, isLoading, error, history, refresh, autoRefreshSeconds, setAutoRefreshSeconds }
}
