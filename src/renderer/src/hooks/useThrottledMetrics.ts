import { useState, useEffect } from 'react'
import { useMetricsStore } from '../store/metricsStore'

/**
 * Returns throttled snapshots of metricsMap (and optionally summaries) from metricsStore.
 * At most one update fires per `intervalMs` (default 1000 ms) to prevent re-render storms
 * when many servers push metrics simultaneously.
 */
export function useThrottledMetricsMap(intervalMs = 1000) {
  const [metricsMap, setMetricsMap] = useState(() => useMetricsStore.getState().metricsMap)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useMetricsStore.subscribe(() => {
      if (timer) return
      timer = setTimeout(() => {
        setMetricsMap(useMetricsStore.getState().metricsMap)
        timer = null
      }, intervalMs)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [intervalMs])
  return metricsMap
}

export function useThrottledMetrics(intervalMs = 1000) {
  const [metricsMap, setMetricsMap] = useState(() => useMetricsStore.getState().metricsMap)
  const [summaries, setSummaries] = useState(() => useMetricsStore.getState().summaries)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useMetricsStore.subscribe(() => {
      if (timer) return
      timer = setTimeout(() => {
        setMetricsMap(useMetricsStore.getState().metricsMap)
        setSummaries(useMetricsStore.getState().summaries)
        timer = null
      }, intervalMs)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [intervalMs])
  return { metricsMap, summaries }
}
