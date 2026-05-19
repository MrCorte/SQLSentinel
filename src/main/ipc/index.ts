import { registerServerHandlers } from './handlers/servers.ipc'
import { registerMetricsHandlers } from './handlers/metrics.ipc'
import { registerAlarmHandlers } from './handlers/alarms.ipc'
import { registerKnowledgeHandlers } from './handlers/knowledge.ipc'
import { registerSystemHandlers } from './handlers/system.ipc'
import { registerStorageHandlers } from './handlers/storage.ipc'
import { registerIncidentHandlers } from './handlers/incidents.ipc'
import { registerAiSettingsHandlers } from './handlers/aiSettings.ipc'

export function registerIpcHandlers(): void {
  registerServerHandlers()
  registerMetricsHandlers()
  registerAlarmHandlers()
  registerKnowledgeHandlers()
  registerSystemHandlers()
  registerStorageHandlers()
  registerIncidentHandlers()
  registerAiSettingsHandlers()
}
