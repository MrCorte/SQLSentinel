// Typed IPC wrapper — all invoke methods are guarded by a 5-second timeout.
// Push-subscription helpers are passed through directly (no timeout needed).

import type { IpcResult, StoredServer, ServerAddResult } from '../../../preload/index'

const DEFAULT_TIMEOUT_MS = 5_000
export const MUST_CHANGE_PASSWORD_EVENT = 'sqlsentinel:must-change-password'

function isMustChangePasswordError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('MUST_CHANGE_PASSWORD')
}

function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC timeout after ${ms}ms`)), ms)
    )
  ]).catch((err) => {
    if (isMustChangePasswordError(err)) {
      window.dispatchEvent(new CustomEvent(MUST_CHANGE_PASSWORD_EVENT))
    }
    throw err
  })
}

const api = window.sqlSentinel

// ---------------------------------------------------------------------------
// Invoke methods — top-level
// ---------------------------------------------------------------------------

export const scanSubnet = (...args: Parameters<typeof api.scanSubnet>) =>
  withTimeout(api.scanSubnet(...args))

export const addServerManual = (...args: Parameters<typeof api.addServerManual>) =>
  withTimeout(api.addServerManual(...args))

export const getServers = () => withTimeout(api.getServers())

export const removeServer = (...args: Parameters<typeof api.removeServer>) =>
  withTimeout(api.removeServer(...args))

export const detectServerInfo = (...args: Parameters<typeof api.detectServerInfo>) =>
  withTimeout(api.detectServerInfo(...args))

// collectMetrics is long-running — use a 30-second timeout
export const collectMetrics = (...args: Parameters<typeof api.collectMetrics>) =>
  withTimeout(api.collectMetrics(...args), 30_000)

export const workerStart = (...args: Parameters<typeof api.workerStart>) =>
  withTimeout(api.workerStart(...args))

export const workerStop = () => withTimeout(api.workerStop())

export const workerSetActive = (...args: Parameters<typeof api.workerSetActive>) =>
  withTimeout(api.workerSetActive(...args))

export const workerSyncServers = (...args: Parameters<typeof api.workerSyncServers>) =>
  withTimeout(api.workerSyncServers(...args))

export const getAlerts = () => withTimeout(api.getAlerts())

export const acknowledgeAlert = (...args: Parameters<typeof api.acknowledgeAlert>) =>
  withTimeout(api.acknowledgeAlert(...args))

export const getHistory = (...args: Parameters<typeof api.getHistory>) =>
  withTimeout(api.getHistory(...args))

export const getHistoryBulk = () => withTimeout(api.getHistoryBulk())

export const getSettings = () => withTimeout(api.getSettings())

export const saveSettings = (...args: Parameters<typeof api.saveSettings>) =>
  withTimeout(api.saveSettings(...args))

export const getEmailSettings = () => withTimeout(api.getEmailSettings())

export const saveEmailSettings = (...args: Parameters<typeof api.saveEmailSettings>) =>
  withTimeout(api.saveEmailSettings(...args))

export const sendTestEmail = () => withTimeout(api.sendTestEmail())

export const getDbCustomFields = (...args: Parameters<typeof api.getDbCustomFields>) =>
  withTimeout(api.getDbCustomFields(...args))

export const setDbCustomFields = (...args: Parameters<typeof api.setDbCustomFields>) =>
  withTimeout(api.setDbCustomFields(...args))

export const getAllDbCustomFields = () => withTimeout(api.getAllDbCustomFields())

export const exportCustomFields = () => withTimeout(api.exportCustomFields())

export const exportInventory = () => withTimeout(api.exportInventory())

export const exportAlerts = () => withTimeout(api.exportAlerts())

export const exportInventoryCsv = (...args: Parameters<typeof api.exportInventoryCsv>) =>
  withTimeout(api.exportInventoryCsv(...args))

export const saveCsv = (...args: Parameters<typeof api.saveCsv>) =>
  withTimeout(api.saveCsv(...args))

export const login = (...args: Parameters<typeof api.login>) => withTimeout(api.login(...args))

export const logout = () => withTimeout(api.logout())

export const checkAuth = () => withTimeout(api.checkAuth())

export const changePassword = (...args: Parameters<typeof api.changePassword>) =>
  withTimeout(api.changePassword(...args))

export const aiCheck = () => withTimeout(api.aiCheck())

// aiAgentAsk is long-running — backend enforces a 60 s AbortSignal; use 65 s here
// so the backend has time to handle its own timeout before the renderer gives up.
export const aiAgentAsk = (...args: Parameters<typeof api.aiAgentAsk>) =>
  withTimeout(api.aiAgentAsk(...args), 65_000)

// ---------------------------------------------------------------------------
// Invoke methods — db namespace
// ---------------------------------------------------------------------------

export const db = {
  shrinkEstimate: (...args: Parameters<typeof api.db.shrinkEstimate>) =>
    withTimeout(api.db.shrinkEstimate(...args)),
  shrink: (...args: Parameters<typeof api.db.shrink>) => withTimeout(api.db.shrink(...args)),
  shrinkFile: (...args: Parameters<typeof api.db.shrinkFile>) =>
    withTimeout(api.db.shrinkFile(...args))
}

// ---------------------------------------------------------------------------
// Invoke methods — ag namespace
// ---------------------------------------------------------------------------

export const ag = {
  getGroups: (...args: Parameters<typeof api.ag.getGroups>) =>
    withTimeout(api.ag.getGroups(...args)),
  getReplicas: (...args: Parameters<typeof api.ag.getReplicas>) =>
    withTimeout(api.ag.getReplicas(...args)),
  getDatabases: (...args: Parameters<typeof api.ag.getDatabases>) =>
    withTimeout(api.ag.getDatabases(...args))
}

// ---------------------------------------------------------------------------
// Invoke methods — servers namespace
// Unwrap IpcResult envelope so callers receive flat values (no API change).
// ---------------------------------------------------------------------------

async function unwrapServers<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export const servers = {
  getAll: (): Promise<StoredServer[]> => unwrapServers(withTimeout(api.servers.getAll())),
  add: (...args: Parameters<typeof api.servers.add>): Promise<ServerAddResult> =>
    unwrapServers(withTimeout(api.servers.add(...args))),
  update: (...args: Parameters<typeof api.servers.update>): Promise<{ success: boolean }> =>
    unwrapServers(withTimeout(api.servers.update(...args))),
  remove: (...args: Parameters<typeof api.servers.remove>): Promise<{ success: boolean }> =>
    unwrapServers(withTimeout(api.servers.remove(...args))),
  clearMocks: (): Promise<{ success: boolean; removed: number; remaining: number }> =>
    unwrapServers(withTimeout(api.servers.clearMocks()))
}

// ---------------------------------------------------------------------------
// Push subscriptions — passed through directly (no timeout)
// ---------------------------------------------------------------------------

export const onScanProgress = (...args: Parameters<typeof api.onScanProgress>) =>
  api.onScanProgress(...args)

export const onServerHealthUpdate = (...args: Parameters<typeof api.onServerHealthUpdate>) =>
  api.onServerHealthUpdate(...args)

export const onMetricsUpdated = (...args: Parameters<typeof api.onMetricsUpdated>) =>
  api.onMetricsUpdated(...args)

export const onMetricsBatchUpdated = (...args: Parameters<typeof api.onMetricsBatchUpdated>) =>
  api.onMetricsBatchUpdated(...args)

export const onAlertNew = (...args: Parameters<typeof api.onAlertNew>) => api.onAlertNew(...args)

export const onServerUnreachable = (...args: Parameters<typeof api.onServerUnreachable>) =>
  api.onServerUnreachable(...args)

export const onServerRecovered = (...args: Parameters<typeof api.onServerRecovered>) =>
  api.onServerRecovered(...args)

export const onServerConfigUpdated = (...args: Parameters<typeof api.onServerConfigUpdated>) =>
  api.onServerConfigUpdated(...args)

export const onAppBackground = (...args: Parameters<typeof api.onAppBackground>) =>
  api.onAppBackground(...args)

export const onAppForeground = (...args: Parameters<typeof api.onAppForeground>) =>
  api.onAppForeground(...args)
