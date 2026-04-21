import { createContext } from 'react'
import type { CollectMetricsRequest, ServerMetrics } from '../../../preload/index'
import type { MetricsHistoryPoint } from '../hooks/useMetrics'

export interface WorkerContextValue {
  /** Seconds between refreshes. 0 = disabled. */
  intervalSeconds: number
  /** Server currently monitored by the worker. */
  connection: CollectMetricsRequest | null
  /** Retention minutes — determines how many snapshots to keep per server. */
  retentionMinutes: number
  setIntervalSeconds: (s: number) => void
  setConnection: (c: CollectMetricsRequest | null) => void
  /** Adds a point to the history of the specified server. */
  pushSnapshot: (serverId: string, m: ServerMetrics) => void
  /** Batch version of pushSnapshot — single Zustand transaction for all updates. */
  pushSnapshotBatch: (batch: Array<{ serverId: string; metrics: ServerMetrics }>) => void
  /** Reads the history for a server. Depends on historyVersion → re-render guaranteed. */
  getHistory: (serverId: string) => MetricsHistoryPoint[]
  setRetentionMinutes: (minutes: number) => void
  /** Pre-populates history at boot from SQLite (called once only from App.tsx). */
  seedHistory: (allHistory: Record<string, ServerMetrics[]>) => void
}

export const WorkerContext = createContext<WorkerContextValue>({
  intervalSeconds: 0,
  connection: null,
  retentionMinutes: 60,
  setIntervalSeconds: () => {},
  setConnection: () => {},
  pushSnapshot: () => {},
  pushSnapshotBatch: () => {},
  getHistory: () => [],
  setRetentionMinutes: () => {},
  seedHistory: () => {}
})
