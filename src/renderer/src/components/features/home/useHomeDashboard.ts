import { useMemo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useServersStore } from '../../../store/serversStore'
import { useMetricsStore } from '../../../store/metricsStore'
import { useGroupsStore } from '../../../store/groupsStore'
import { useAgStore } from '../../../store/agStore'
import { useAlertsStore } from '../../../store/alertsStore'
import { useRefreshAllServers } from '../../../hooks/useRefreshAllServers'
import { useNow } from '../../../hooks/useNow'
import { useThrottledMetrics } from '../../../hooks/useThrottledMetrics'
import type { StoredServer, Alert } from '../../../../../preload/index'
import type { ServerGroup } from '../../../types/index'

// ---------------------------------------------------------------------------
// Helpers — also used by ServerRow, so exported
// ---------------------------------------------------------------------------

export function serverKey(s: StoredServer): string {
  return `${s.host ?? s.ip}:${s.port}`
}

export function dataAge(
  collectedAt: Date | string | undefined,
  now: number
): { label: string; color: string } {
  if (!collectedAt) return { label: '—', color: 'rgba(128,128,128,0.4)' }
  const minAgo = Math.floor((now - new Date(collectedAt).getTime()) / 60_000)
  if (minAgo < 2) return { label: 'just now', color: '#107c10' }
  if (minAgo < 10) return { label: `${minAgo} min ago`, color: 'rgba(128,128,128,0.7)' }
  if (minAgo < 30) return { label: `${minAgo} min ago`, color: '#d83b01' }
  return { label: `${minAgo} min ago`, color: '#a4262c' }
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatTimeShort(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OfflineDb {
  name: string
  serverName: string
  serverId: string
  serverRecordId: string
  stateDesc: string
  offlineSince: string | null | undefined
}

export interface HomeDashboardData {
  // Raw store data
  servers: StoredServer[]
  lastUpdate: Date | null
  metricsMap: ReturnType<typeof useMetricsStore.getState>['metricsMap']
  summaries: ReturnType<typeof useMetricsStore.getState>['summaries']
  serverAliases: Record<string, string>
  now: number

  // KPI derived values
  onlineCount: number
  offlineCount: number
  unreachableCount: number
  totalDbs: number
  activeAlerts: Alert[]
  criticalCount: number
  warningCount: number
  firstOffline: StoredServer | undefined

  // Chart data
  donutFinal: { name: string; value: number; fill: string }[]
  cpuData: { id: string; name: string; cpu: number; fill: string; hasData: boolean }[]
  hasCpuData: boolean
  cpuChartHeight: number

  // Alert feed
  recentAlerts: Alert[]

  // Offline DBs table
  offlineDbs: OfflineDb[]

  // Lookup maps for ServerRow
  alertCountByServer: Record<string, { crit: number; warn: number }>
  groupByServerKey: Record<string, ServerGroup | undefined>

  // AG clusters
  agGroupCount: number

  // Refresh
  refreshing: boolean
  handleRefresh: () => Promise<void>

  // Navigation callbacks
  handleNavigate: (id: string) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHomeDashboard(onNavigateToServer: (id: string) => void): HomeDashboardData {
  const servers = useServersStore((s) => s.servers)
  const lastUpdate = useMetricsStore((s) => s.lastUpdate)

  // Throttled metrics snapshot — max 1 re-render/s to handle 200+ servers
  const { metricsMap, summaries } = useThrottledMetrics()

  const now = useNow()
  const { groups, serverGroups, serverAliases } = useGroupsStore(
    useShallow((s) => ({
      groups: s.groups,
      serverGroups: s.serverGroups,
      serverAliases: s.serverAliases
    }))
  )
  const agGroups = useAgStore((s) => s.agGroups)
  const alerts = useAlertsStore((s) => s.alerts)
  const { refreshing, handleRefresh } = useRefreshAllServers()

  // O(1) alert lookup by serverId
  const alertCountByServer = useMemo(() => {
    const map: Record<string, { crit: number; warn: number }> = {}
    alerts.forEach((a) => {
      if (a.acknowledgedAt !== null) return
      if (!map[a.serverId]) map[a.serverId] = { crit: 0, warn: 0 }
      if (a.severity === 'CRITICAL') map[a.serverId].crit++
      else map[a.serverId].warn++
    })
    return map
  }, [alerts])

  // O(1) group lookup by server key
  const groupByServerKey = useMemo(() => {
    const map: Record<string, ServerGroup | undefined> = {}
    servers.forEach((s) => {
      const key = serverKey(s)
      const groupId = serverGroups[key]
      map[key] = groupId ? groups.find((g) => g.id === groupId) : undefined
    })
    return map
  }, [servers, serverGroups, groups])

  const handleNavigate = useCallback((id: string) => onNavigateToServer(id), [onNavigateToServer])

  // Derived metrics
  const derived = useMemo(() => {
    const onlineCount = servers.filter((s) => !s.unreachable && metricsMap[serverKey(s)]).length
    const offlineCount = servers.filter((s) => s.unreachable).length
    const unreachableCount = servers.filter(
      (s) => !s.unreachable && !metricsMap[serverKey(s)]
    ).length
    const totalDbs = Object.values(summaries).reduce((acc, s) => acc + s.dbCount, 0)
    const activeAlerts: Alert[] = alerts.filter((a) => a.acknowledgedAt === null)
    const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length
    const warningCount = activeAlerts.filter((a) => a.severity === 'WARNING').length
    const firstOffline = servers.find((s) => s.unreachable)

    const donutData = [
      { name: 'Online', value: onlineCount, fill: '#107c10' },
      { name: 'Offline', value: offlineCount, fill: '#a4262c' },
      { name: 'Unreachable', value: unreachableCount, fill: '#d83b01' }
    ].filter((d) => d.value > 0)
    const donutFinal =
      donutData.length > 0 ? donutData : [{ name: 'None', value: 1, fill: '#e0e0e0' }]

    const cpuData = servers
      .map((s) => {
        const m = metricsMap[serverKey(s)]
        const cpu = m?.instanceInfo?.cpuUsagePercent ?? 0
        const hasData = !!m
        return {
          id: serverKey(s),
          name: serverAliases[s.id] || s.host || s.ip || serverKey(s),
          cpu: hasData ? Math.round(cpu * 10) / 10 : 0,
          fill: cpu < 60 ? '#107c10' : cpu < 80 ? '#d83b01' : '#a4262c',
          hasData
        }
      })
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 5)

    const hasCpuData = cpuData.some((d) => d.hasData)
    const cpuChartHeight = Math.max(180, cpuData.length * 40)

    const _sortedAlerts = [...activeAlerts].sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    )
    const _seen = new Set<string>()
    const recentAlerts = _sortedAlerts
      .filter((a) => {
        const k = `${a.serverId}::${a.category}`
        if (_seen.has(k)) return false
        _seen.add(k)
        return true
      })
      .slice(0, 10)

    const offlineDbs: OfflineDb[] = servers.flatMap((s) => {
      const key = serverKey(s)
      // Fast skip: the precomputed summary already counts offline DBs, so we
      // avoid scanning the full database array for the (vast majority) healthy
      // servers on every metrics tick.
      const summary = summaries[key]
      if (!summary || summary.offlineDbCount === 0) return []
      const m = metricsMap[key]
      if (!m) return []
      const srvName = serverAliases[s.id] || s.host || s.ip || key
      return m.databases
        .filter((d) => d.stateDesc !== 'ONLINE')
        .map((d) => ({
          name: d.name,
          serverName: srvName,
          serverId: key,
          serverRecordId: s.id,
          stateDesc: d.stateDesc,
          offlineSince: d.offlineSince
        }))
    })

    return {
      onlineCount,
      offlineCount,
      unreachableCount,
      totalDbs,
      activeAlerts,
      criticalCount,
      warningCount,
      firstOffline,
      donutFinal,
      cpuData,
      hasCpuData,
      cpuChartHeight,
      recentAlerts,
      offlineDbs
    }
  }, [servers, metricsMap, summaries, alerts, serverAliases])

  return {
    servers,
    lastUpdate,
    metricsMap,
    summaries,
    serverAliases,
    now,
    ...derived,
    alertCountByServer,
    groupByServerKey,
    agGroupCount: Object.keys(agGroups).length,
    refreshing,
    handleRefresh,
    handleNavigate
  }
}
