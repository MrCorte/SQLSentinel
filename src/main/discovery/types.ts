export interface DiscoveredServer {
  ip: string
  port: number
  reachable: boolean
  responseTimeMs: number
  discoveredAt: Date
}

export interface ScanOptions {
  cidr: string
  ports: number[]
  timeoutMs: number
  concurrency: number
}

export interface ScanProgress {
  total: number
  completed: number
  found: number
}
