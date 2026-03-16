export interface StoredServer {
  id: string
  ip: string
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  /** Password cifrata — mai loggare questo campo */
  encryptedPassword?: string
  addedAt: Date
  lastSeenAt: Date | null
  lastMetricsAt: Date | null
}

export interface MetricsSnapshot {
  id: string
  serverId: string
  collectedAt: Date
  /** ServerMetrics serializzato come JSON */
  metricsJson: string
}
