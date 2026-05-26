import * as serverStore from '../store/serverStore'
import * as metricsRepository from '../store/metricsRepository'
import { getAlerts } from '../metricsWorker'

export interface AiContext {
  servers: {
    id: string
    host: string
    port: number
    instance?: string
    notes?: string
    unreachable?: boolean
  }[]
  metrics: {
    serverId: string
    cpuPct: number
    memUsedMb: number
    memTargetMb: number
    blockingCount: number
    offlineDbs: string[]
  }[]
  alerts: {
    serverId: string
    category: string
    severity: string
    message: string
    detectedAt: string
  }[]
}

export async function gatherContext(): Promise<AiContext> {
  const servers = serverStore.getAllStripped().map((s) => ({
    id: s.id,
    host: s.host,
    port: s.port,
    instance: s.instanceName,
    notes: s.notes,
    unreachable: s.unreachable
  }))

  const ids = servers.map((s) => s.id)
  const bulk = metricsRepository.findLastNBulk(ids, 1)

  const metrics = Object.entries(bulk)
    .filter(([, snaps]) => snaps.length > 0)
    .map(([serverId, snaps]) => {
      const m = snaps[0]
      return {
        serverId,
        cpuPct: m.instanceInfo.cpuUsagePercent,
        memUsedMb: m.instanceInfo.memoryUsedMb,
        memTargetMb: m.instanceInfo.memoryTargetMb,
        blockingCount: m.activeSessions.filter((s) => s.blockingSessionId > 0).length,
        offlineDbs: m.databases.filter((d) => d.stateDesc !== 'ONLINE').map((d) => d.name)
      }
    })

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const alerts = getAlerts()
    .filter((a) => new Date(a.detectedAt) >= cutoff)
    .slice(-15)
    .map((a) => ({
      serverId: a.serverId,
      category: a.category,
      severity: a.severity,
      message: a.message,
      detectedAt: new Date(a.detectedAt).toISOString()
    }))

  return { servers, metrics, alerts }
}
