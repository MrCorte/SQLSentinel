import { useSyncExternalStore } from 'react'
import { useMetricsStore } from '../store/metricsStore'
import type { ServerMetrics } from '../../../preload/index'

/**
 * Throttled snapshot of metricsStore: at most one snapshot update per
 * `THROTTLE_MS` window, regardless of how many components subscribe.
 *
 * Previous implementation: each consumer ran its own setTimeout + Zustand
 * subscription, so 5 components meant 5 timers and 5 setState calls per fire.
 * Now there is a single module-level timer; consumers attach via
 * `useSyncExternalStore`, which is the React-recommended primitive for
 * subscribing to an external store with stable referential identity.
 */

const THROTTLE_MS = 1000

type StoreState = ReturnType<typeof useMetricsStore.getState>

let _snapshot: StoreState = useMetricsStore.getState()
const _listeners = new Set<() => void>()
let _timer: ReturnType<typeof setTimeout> | null = null

// Subscribe only to metricsMap changes — skips re-fires from setServerHealth
// and other fields that don't affect the throttled snapshot consumers need.
// Invariant: summaries is always mutated in the same immer set() call as
// metricsMap (see applyFullSnapshot / applyOne). If a future mutator ever
// updates summaries independently, add it as a second subscription here.
useMetricsStore.subscribe(
  (state) => state.metricsMap,
  () => {
    if (_timer) return
    _timer = setTimeout(() => {
      _timer = null
      _snapshot = useMetricsStore.getState()
      for (const l of _listeners) l()
    }, THROTTLE_MS)
  }
)

function subscribe(listener: () => void): () => void {
  _listeners.add(listener)
  return () => {
    _listeners.delete(listener)
  }
}

function getSnapshot(): StoreState {
  return _snapshot
}

/**
 * Throttled metricsMap snapshot. Reference is stable between throttle ticks,
 * so consumers can pass it to `useMemo` deps without firing extra recomputes.
 */
export function useThrottledMetricsMap(): StoreState['metricsMap'] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).metricsMap
}

/**
 * Throttled metricsMap + summaries snapshot. Both fields share the same
 * snapshot identity so equality checks remain cheap.
 */
export function useThrottledMetrics(): {
  metricsMap: StoreState['metricsMap']
  summaries: StoreState['summaries']
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { metricsMap: snap.metricsMap, summaries: snap.summaries }
}

/**
 * Throttled snapshot for a SINGLE server. Re-renders only when the specific
 * server's record reference changes between throttle ticks — components that
 * render one server (Dashboard, ServerHistoryChart) avoid re-rendering when
 * unrelated servers update.
 */
export function useThrottledServerMetric(serverId: string): ServerMetrics | undefined {
  return useSyncExternalStore(
    subscribe,
    () => _snapshot.metricsMap[serverId],
    () => _snapshot.metricsMap[serverId]
  )
}
