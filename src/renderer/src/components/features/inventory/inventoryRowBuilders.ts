// Pure functions that build flat row arrays from inventory data.
// Defined outside any component/hook so they can be called cheaply (no closure capture).

import type { GroupInventory, InventoryStats } from '../../../types/index'
import type { ServerMetrics } from '../../../../../preload/index'
import type { InventoryRow, DbViewRow } from './inventoryTypes'
import { ServerHostingType } from '../../../constants/hosting'

// ---------------------------------------------------------------------------
// Server View — row builder
// ---------------------------------------------------------------------------

export function buildRows(
  invGroups: GroupInventory[],
  expandedClusters: Set<string>,
  expandedMachines: Set<string>
): InventoryRow[] {
  const rows: InventoryRow[] = []

  for (const group of invGroups) {
    const envId = group.groupId ?? '__ungrouped__'
    const envName = group.groupName
    const envColor = group.groupColor

    // ── Standalone — group by machineName if 2+ instances on same machine ──
    const machineMap = new Map<string, typeof group.standaloneServers>()
    for (const srv of group.standaloneServers) {
      const key = srv.machineName ?? srv.ip
      if (!machineMap.has(key)) machineMap.set(key, [])
      machineMap.get(key)!.push(srv)
    }

    for (const [machineName, instances] of machineMap) {
      if (instances.length >= 2) {
        const machineKey = `${envId}__machine__${machineName}`
        const isExpanded = expandedMachines.has(machineKey)
        rows.push({
          id: machineKey,
          type: 'machine-header',
          depth: 0,
          serverLabel: machineName,
          host: machineName,
          port: 1433,
          envId,
          envName,
          envColor,
          hostingType: (instances[0]?.hostingType ?? 'on-premise') as ServerHostingType,
          version: instances[0]?.version ?? '—',
          unreachable: instances.every((s) => s.unreachable),
          dbCount: instances.reduce((s, x) => s + x.dbCount, 0),
          onlineCount: instances.reduce((s, x) => s + x.onlineCount, 0),
          offlineCount: instances.reduce((s, x) => s + x.offlineCount, 0),
          totalDataMb: instances.reduce((s, x) => s + x.totalDataMb, 0),
          totalLogMb: instances.reduce((s, x) => s + x.totalLogMb, 0),
          machineName,
          instanceCount: instances.length,
          clusterKey: machineKey,
          logicalCpus: instances.reduce((s, x) => s + (x.logicalCpus ?? 0), 0) || undefined,
          physicalCpus: instances.reduce((s, x) => s + (x.physicalCpus ?? 0), 0) || undefined,
        })
        if (isExpanded) {
          for (const srv of instances) {
            const instanceLabel = srv.instanceName ? `\\${srv.instanceName}` : '(default)'
            rows.push({
              id: `${machineKey}__${srv.serverId}`,
              type: 'standalone',
              depth: 1,
              serverLabel: instanceLabel,
              host: srv.ip,
              port: srv.port,
              envId,
              envName,
              envColor,
              hostingType: (srv.hostingType ?? 'on-premise') as ServerHostingType,
              version: srv.version,
              unreachable: srv.unreachable,
              dbCount: srv.dbCount,
              onlineCount: srv.onlineCount,
              offlineCount: srv.offlineCount,
              totalDataMb: srv.totalDataMb,
              totalLogMb: srv.totalLogMb,
              machineName,
              instanceName: srv.instanceName,
              serverId: srv.serverId,
              uptimeDays: srv.uptimeDays,
              clusterKey: machineKey,
              logicalCpus: srv.logicalCpus,
              physicalCpus: srv.physicalCpus,
              notes: srv.notes,
            })
          }
        }
      } else {
        const srv = instances[0]
        rows.push({
          id: srv.serverId,
          type: 'standalone',
          depth: 0,
          serverLabel: srv.displayName,
          host: srv.ip,
          port: srv.port,
          envId,
          envName,
          envColor,
          hostingType: (srv.hostingType ?? 'on-premise') as ServerHostingType,
          version: srv.version,
          unreachable: srv.unreachable,
          dbCount: srv.dbCount,
          onlineCount: srv.onlineCount,
          offlineCount: srv.offlineCount,
          totalDataMb: srv.totalDataMb,
          totalLogMb: srv.totalLogMb,
          machineName,
          instanceName: srv.instanceName,
          serverId: srv.serverId,
          uptimeDays: srv.uptimeDays,
          logicalCpus: srv.logicalCpus,
          physicalCpus: srv.physicalCpus,
          notes: srv.notes,
        })
      }
    }

    // ── AG clusters ─────────────────────────────────────────────────────
    for (const ag of group.agClusters) {
      const clusterKey = `${envId}__${ag.agName}`
      const primary = ag.replicas.find((r) => r.agRole === 'PRIMARY')
      const isExpanded = expandedClusters.has(clusterKey)

      rows.push({
        id: clusterKey,
        type: 'ag-cluster',
        depth: 0,
        serverLabel: ag.agName,
        host: primary?.ip ?? '',
        port: primary?.port ?? 1433,
        envId,
        envName,
        envColor,
        hostingType: (primary?.hostingType ?? 'on-premise') as ServerHostingType,
        version: primary?.version ?? '',
        unreachable: ag.replicas.every((r) => r.unreachable),
        agName: ag.agName,
        agHealthy: ag.health === 'HEALTHY',
        replicaCount: ag.replicas.length,
        clusterKey,
        dbCount: primary?.dbCount ?? ag.dbCount,
        onlineCount: primary?.onlineCount ?? ag.onlineCount,
        offlineCount: primary?.offlineCount ?? ag.offlineCount,
        totalDataMb: primary?.totalDataMb ?? ag.totalDataMb,
        totalLogMb: primary?.totalLogMb ?? ag.totalLogMb,
        logicalCpus: primary?.logicalCpus,
        physicalCpus: primary?.physicalCpus,
      })

      if (isExpanded) {
        for (const srv of ag.replicas) {
          rows.push({
            id: `${clusterKey}__${srv.serverId}`,
            type: 'ag-replica',
            depth: 1,
            serverLabel: srv.displayName,
            host: srv.ip,
            port: srv.port,
            envId,
            envName,
            envColor,
            hostingType: (srv.hostingType ?? 'on-premise') as ServerHostingType,
            version: srv.version,
            unreachable: srv.unreachable,
            dbCount: srv.dbCount,
            onlineCount: srv.onlineCount,
            offlineCount: srv.offlineCount,
            totalDataMb: srv.agRole === 'PRIMARY' ? srv.totalDataMb : 0,
            totalLogMb: srv.agRole === 'PRIMARY' ? srv.totalLogMb : 0,
            serverId: srv.serverId,
            agRole:
              srv.agRole === 'PRIMARY' || srv.agRole === 'SECONDARY' ? srv.agRole : 'SECONDARY',
            uptimeDays: srv.uptimeDays,
            clusterKey,
            logicalCpus: srv.logicalCpus,
            physicalCpus: srv.physicalCpus,
            notes: srv.notes,
          })
        }
      }
    }
  }

  return rows
}

// ---------------------------------------------------------------------------
// DB View — row builder
// ---------------------------------------------------------------------------

export function buildDbViewRows(
  inventory: InventoryStats,
  metricsMap: Record<string, ServerMetrics>,
  expandedServers: Set<string>
): DbViewRow[] {
  const rows: DbViewRow[] = []

  for (const group of inventory.groups) {
    const allServers = [
      ...group.standaloneServers,
      ...group.agClusters.flatMap((ag) => ag.replicas),
    ]

    for (const srv of allServers) {
      const serverKey = `${srv.ip}:${srv.port}`
      const metrics = metricsMap[serverKey]
      const databases = metrics?.databases ?? []
      const backupMap = Object.fromEntries(
        (metrics?.backupStatus ?? []).map((b) => [b.databaseName, b])
      )
      const isExpanded = expandedServers.has(serverKey)

      rows.push({
        id: serverKey,
        type: 'server-header',
        serverId: srv.serverId,
        serverKey,
        serverLabel: srv.displayName,
        envName: group.groupName,
        envColor: group.groupColor,
        unreachable: srv.unreachable,
        serverVersion: srv.version ?? '—',
        clusterKey: serverKey,
        dbCount: databases.length,
        agRole:
          srv.agRole === 'PRIMARY' || srv.agRole === 'SECONDARY' ? srv.agRole : undefined,
      })

      if (isExpanded) {
        for (const db of databases) {
          const backup = backupMap[db.name]
          rows.push({
            id: `${serverKey}/${db.name}`,
            type: 'db-row',
            serverId: srv.serverId,
            serverKey,
            serverLabel: srv.displayName,
            envName: group.groupName,
            envColor: group.groupColor,
            unreachable: srv.unreachable,
            serverVersion: srv.version ?? '—',
            clusterKey: serverKey,
            dbName: db.name,
            stateDesc: db.stateDesc,
            recoveryModel: db.recoveryModel,
            compatibilityLevel: db.compatibilityLevel,
            isEncrypted: db.isEncrypted,
            isReadOnly: db.isReadOnly,
            owner: db.owner,
            createDate: db.createDate,
            sizeMb: db.sizeMb,
            logSizeMb: db.logSizeMb,
            lastFullBackup: backup?.lastFullBackup ?? null,
            lastLogBackup: backup?.lastLogBackup ?? null,
            alias: db.alias,
            referente: db.referente,
          })
        }
      }
    }
  }

  return rows
}
