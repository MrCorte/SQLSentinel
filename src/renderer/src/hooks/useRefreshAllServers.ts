import { useState, useCallback } from 'react'
import { useServersStore } from '../store/serversStore'
import { useMetricsStore } from '../store/metricsStore'

interface UseRefreshAllServersResult {
  refreshing: boolean
  lastRefresh: Date | null
  handleRefresh: () => Promise<void>
}

export function useRefreshAllServers(): UseRefreshAllServersResult {
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    const servers = useServersStore.getState().servers
    await Promise.allSettled(
      servers.map(async (srv) => {
        try {
          const conn = {
            ip: srv.ip ?? srv.host,
            port: srv.port,
            instanceName: srv.instanceName,
            useWindowsAuth: srv.useWindowsAuth,
            username: srv.username,
            password: srv.password
          }
          const result = await window.sqlSentinel.collectMetrics(conn)
          if (result.ok) {
            useMetricsStore.getState().setMetrics(`${srv.ip ?? srv.host}:${srv.port}`, result.data)
          }
        } catch {
          // Server unreachable — skip
        }
      })
    )
    setRefreshing(false)
    setLastRefresh(new Date())
  }, [])

  return { refreshing, lastRefresh, handleRefresh }
}
