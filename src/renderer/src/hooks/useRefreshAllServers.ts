import { useState, useCallback } from 'react'
import { useServersStore } from '../store/serversStore'
import { useMetricsStore } from '../store/metricsStore'
import { serverKey } from '../components/features/home/useHomeDashboard'
import type { StoredServer } from '../../../preload/index'

const CONCURRENCY = 10

interface UseRefreshAllServersResult {
  refreshing: boolean
  lastRefresh: Date | null
  handleRefresh: () => Promise<void>
}

async function refreshServer(srv: StoredServer): Promise<void> {
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
    useMetricsStore.getState().setMetrics(serverKey(srv), result.data)
  }
}

export function useRefreshAllServers(): UseRefreshAllServersResult {
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    const servers = useServersStore.getState().servers
    for (let i = 0; i < servers.length; i += CONCURRENCY) {
      await Promise.allSettled(servers.slice(i, i + CONCURRENCY).map(refreshServer))
    }
    setRefreshing(false)
    setLastRefresh(new Date())
  }, [])

  return { refreshing, lastRefresh, handleRefresh }
}
