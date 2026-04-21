export interface StoredServer {
  id: string
  ip: string
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  /** Encrypted password — never log this field */
  encryptedPassword?: string
  addedAt: Date
  lastSeenAt: Date | null
  lastMetricsAt: Date | null
}

export interface MetricsSnapshot {
  id: string
  serverId: string
  collectedAt: Date
  /** ServerMetrics serialized as JSON */
  metricsJson: string
}
