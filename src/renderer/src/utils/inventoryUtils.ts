import type { StoredServer } from '../../../preload/index'
import type {
  ServerSummary,
  AgClusterSummary,
  GroupInventory,
  InventoryStats
} from '../types/index'
import { useServersStore } from '../store/serversStore'
import { useGroupsStore } from '../store/groupsStore'
import { useMetricsStore } from '../store/metricsStore'
import { useAgStore } from '../store/agStore'

function serverLabel(s: StoredServer): string {
  return `${s.ip}:${s.port}`
}

function buildServerSummary(
  srv: StoredServer,
  serverAliases: Record<string, string>,
  agGroups: ReturnType<typeof useAgStore.getState>['agGroups']
): ServerSummary {
  const metricsMap = useMetricsStore.getState().metricsMap
  const m = metricsMap[serverLabel(srv)]
  const dbs = m?.databases ?? []
  const ag = srv.agGroupId
    ? Object.values(agGroups).find((a) => a.id === srv.agGroupId)
    : undefined
  const alias = serverAliases[serverLabel(srv)]
  return {
    serverId: srv.id,
    displayName: alias?.trim() || serverLabel(srv),
    ip: srv.ip ?? srv.host,
    port: srv.port,
    version: m?.instanceInfo.version ?? '—',
    edition: m?.instanceInfo.edition ?? '—',
    uptimeDays: m?.instanceInfo.uptimeDays ?? 0,
    dbCount: dbs.length,
    onlineCount: dbs.filter((d) => d.stateDesc === 'ONLINE').length,
    offlineCount: dbs.filter((d) => d.stateDesc !== 'ONLINE').length,
    totalDataMb: dbs.reduce((s, d) => s + (d.sizeMb ?? 0), 0),
    totalLogMb: dbs.reduce((s, d) => s + (d.logSizeMb ?? 0), 0),
    unreachable: srv.unreachable ?? false,
    isAg: !!srv.agGroupId,
    agName: ag?.ag_name,
    agRole: srv.agRole
  }
}

function buildGroupInventory(
  groupId: string | null,
  groupName: string,
  groupColor: string,
  groupServers: StoredServer[],
  serverAliases: Record<string, string>,
  agGroups: ReturnType<typeof useAgStore.getState>['agGroups']
): GroupInventory {
  const summaries = groupServers.map((s) => buildServerSummary(s, serverAliases, agGroups))
  const standalone = summaries.filter((s) => !s.isAg)
  const agServerList = summaries.filter((s) => s.isAg)

  // Group AG servers by agName
  const agMap: Record<string, ServerSummary[]> = {}
  agServerList.forEach((s) => {
    const key = s.agName ?? 'unknown'
    if (!agMap[key]) agMap[key] = []
    agMap[key].push(s)
  })

  const agClusters: AgClusterSummary[] = Object.entries(agMap).map(([agName, replicas]) => {
    const agInfo = Object.values(agGroups).find((a) => a.ag_name === agName)
    // Count DBs only from PRIMARY to avoid double-counting
    const primary = replicas.find((r) => r.agRole === 'PRIMARY') ?? replicas[0]
    return {
      agName,
      health: agInfo?.health ?? 'NOT_HEALTHY',
      primaryReplica: agInfo?.primary_replica ?? '—',
      replicas,
      dbCount: primary?.dbCount ?? 0,
      onlineCount: primary?.onlineCount ?? 0,
      offlineCount: primary?.offlineCount ?? 0,
      totalDataMb: primary?.totalDataMb ?? 0,
      totalLogMb: primary?.totalLogMb ?? 0
    }
  })

  return {
    groupId,
    groupName,
    groupColor,
    standaloneServers: standalone,
    standaloneDbCount: standalone.reduce((s, x) => s + x.dbCount, 0),
    standaloneOnline: standalone.reduce((s, x) => s + x.onlineCount, 0),
    standaloneOffline: standalone.reduce((s, x) => s + x.offlineCount, 0),
    standaloneDataMb: standalone.reduce((s, x) => s + x.totalDataMb, 0),
    standaloneLogMb: standalone.reduce((s, x) => s + x.totalLogMb, 0),
    agClusters,
    agDbCount: agClusters.reduce((s, a) => s + a.dbCount, 0),
    agOnline: agClusters.reduce((s, a) => s + a.onlineCount, 0),
    agOffline: agClusters.reduce((s, a) => s + a.offlineCount, 0),
    agDataMb: agClusters.reduce((s, a) => s + a.totalDataMb, 0),
    agLogMb: agClusters.reduce((s, a) => s + a.totalLogMb, 0)
  }
}

export function computeInventory(): InventoryStats {
  const servers = useServersStore.getState().servers
  const { groups, serverGroups, serverAliases } = useGroupsStore.getState()
  const agGroups = useAgStore.getState().agGroups

  const sortedGroups = [...groups].sort((a, b) => a.order - b.order)
  const groupInventories: GroupInventory[] = []

  // Per-group sections
  for (const g of sortedGroups) {
    const gs = servers.filter((s) => serverGroups[serverLabel(s)] === g.id)
    if (gs.length === 0) continue
    groupInventories.push(buildGroupInventory(g.id, g.name, g.color, gs, serverAliases, agGroups))
  }

  // Ungrouped servers
  const ungrouped = servers.filter((s) => !serverGroups[serverLabel(s)])
  if (ungrouped.length > 0) {
    groupInventories.push(
      buildGroupInventory(null, 'Senza gruppo', '#737373', ungrouped, serverAliases, agGroups)
    )
  }

  const allSummaries = servers.map((s) => buildServerSummary(s, serverAliases, agGroups))
  return {
    groups: groupInventories,
    totals: {
      servers: servers.length,
      standaloneServers: allSummaries.filter((s) => !s.isAg).length,
      agServers: allSummaries.filter((s) => s.isAg).length,
      agClusters: Object.keys(agGroups).length,
      databases: allSummaries.reduce((s, x) => s + x.dbCount, 0),
      onlineDbs: allSummaries.reduce((s, x) => s + x.onlineCount, 0),
      offlineDbs: allSummaries.reduce((s, x) => s + x.offlineCount, 0),
      totalDataMb: allSummaries.reduce((s, x) => s + x.totalDataMb, 0),
      totalLogMb: allSummaries.reduce((s, x) => s + x.totalLogMb, 0)
    }
  }
}
