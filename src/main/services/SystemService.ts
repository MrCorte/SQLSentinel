/**
 * SystemService — business logic for system-level operations.
 *
 * Extracts non-trivial CSV generation logic from system.ipc.ts so it can be
 * tested independently of the Electron IPC layer.
 */
import { getAllCustomFields } from '../store/dbCustomFields'
import { getAlerts } from '../metricsWorker'
import * as serverStore from '../store/serverStore'
import type { DbCustomFields } from '../ipc/types'

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/** Escapes a value for RFC-4180 CSV output; also blocks CSV injection. */
export function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  const dangerous = /^[=+\-@\t\r]/.test(s)
  if (dangerous || s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** Returns a canonical `ip:port` key string for a server. */
export function serverKey(ip: string, port: number): string {
  return `${ip}:${port}`
}

// ---------------------------------------------------------------------------
// CSV export builders
// ---------------------------------------------------------------------------

/** Generates a CSV string of all custom DB fields (alias, referente). */
export function exportCustomFieldsCsv(): string {
  const all = getAllCustomFields()
  const rows = Object.entries(all).map(([key, fields]: [string, DbCustomFields]) => {
    const slash = key.indexOf('/')
    const serverId = slash >= 0 ? key.slice(0, slash) : key
    const dbName = slash >= 0 ? key.slice(slash + 1) : ''
    return [serverId, dbName, fields.alias ?? '', fields.referente ?? ''].map(csvEscape).join(',')
  })
  return ['serverId,dbName,alias,referente', ...rows].join('\r\n')
}

/** Generates a CSV string of the full server inventory with DB counts. */
export function exportInventoryCsv(): string {
  const all = getAllCustomFields()
  const header = 'ip,port,reachable,added_at,databases'
  const rows = serverStore.getAll().map((s) => {
    const sid = serverKey(s.host, s.port)
    const dbEntries = Object.entries(all)
      .filter(([key]) => key.startsWith(sid + '/'))
      .map(([key]) => key.slice(sid.length + 1))
      .join('; ')
    return [s.host, String(s.port), s.unreachable ? 'NO' : 'YES', s.addedAt, dbEntries]
      .map(csvEscape)
      .join(',')
  })
  return [header, ...rows].join('\r\n')
}

/** Generates a CSV string of all historical alerts. */
export function exportAlertsCsv(): string {
  const alerts = getAlerts()
  const header = 'id,serverId,category,severity,message,detected_at,acknowledged_at'
  const rows = alerts.map((a) =>
    [
      a.id,
      a.serverId,
      a.category,
      a.severity,
      a.message,
      a.detectedAt instanceof Date ? a.detectedAt.toISOString() : String(a.detectedAt),
      a.acknowledgedAt
        ? a.acknowledgedAt instanceof Date
          ? a.acknowledgedAt.toISOString()
          : String(a.acknowledgedAt)
        : ''
    ]
      .map(csvEscape)
      .join(',')
  )
  return [header, ...rows].join('\r\n')
}
