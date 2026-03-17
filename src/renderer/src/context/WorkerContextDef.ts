import { createContext } from 'react'
import type { CollectMetricsRequest, ServerMetrics } from '../../../preload/index'
import type { MetricsHistoryPoint } from '../hooks/useMetrics'

export interface WorkerContextValue {
  /** Secondi tra un refresh e l'altro. 0 = disabilitato. */
  intervalSeconds: number
  /** Server attualmente monitorato dal worker. */
  connection: CollectMetricsRequest | null
  /** Minuti di retention — determina quanti snapshot conservare per server. */
  retentionMinutes: number
  setIntervalSeconds: (s: number) => void
  setConnection: (c: CollectMetricsRequest | null) => void
  /** Aggiunge un punto allo storico del server specificato. */
  pushSnapshot: (serverId: string, m: ServerMetrics) => void
  /** Legge lo storico per un server. Dipende da historyVersion → re-render garantito. */
  getHistory: (serverId: string) => MetricsHistoryPoint[]
  setRetentionMinutes: (minutes: number) => void
}

export const WorkerContext = createContext<WorkerContextValue>({
  intervalSeconds: 0,
  connection: null,
  retentionMinutes: 60,
  setIntervalSeconds: () => {},
  setConnection: () => {},
  pushSnapshot: () => {},
  getHistory: () => [],
  setRetentionMinutes: () => {}
})
