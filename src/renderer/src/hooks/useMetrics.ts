import { useState, useCallback, useEffect, useRef } from 'react'
import type { CollectMetricsRequest, ServerMetrics } from '../../../preload/index'

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

export function useMetrics(
  connection: CollectMetricsRequest | null,
  options?: UseMetricsOptions
) {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connectionRef = useRef(connection)
  connectionRef.current = connection

  const onReceivedRef = useRef(options?.onReceived)
  onReceivedRef.current = options?.onReceived

  /** Called by Dashboard when a push metric arrives via onMetricsUpdated */
  const receiveMetrics = useCallback((m: ServerMetrics) => {
    setMetrics(m)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const conn = connectionRef.current
    if (!conn) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.sqlSentinel.collectMetrics(conn)
      if (result.ok) {
        setMetrics(result.data)
        const serverId = `${conn.ip}:${conn.port}`
        onReceivedRef.current?.(serverId, result.data)
      } else {
        setError(result.error)
      }
    } catch {
      setError('Raccolta metriche fallita inaspettatamente')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Resetta solo l'errore al cambio server — le metriche rimangono visibili
  // fino all'arrivo dei nuovi dati (evita blank screen durante il caricamento)
  useEffect(() => {
    setError(null)
  }, [connection?.ip, connection?.port])

  return { metrics, isLoading, error, refresh, receiveMetrics }
}
