import { registerServerHandlers } from './handlers/servers.ipc'
import { registerMetricsHandlers } from './handlers/metrics.ipc'
import { registerAlarmHandlers } from './handlers/alarms.ipc'
import { registerKnowledgeHandlers } from './handlers/knowledge.ipc'
import { registerSystemHandlers } from './handlers/system.ipc'

export function registerIpcHandlers(): void {
  registerServerHandlers()
  registerMetricsHandlers()
  registerAlarmHandlers()
  registerKnowledgeHandlers()
  registerSystemHandlers()
}
