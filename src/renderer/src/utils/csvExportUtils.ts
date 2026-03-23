/**
 * Pure utility for building the per-database inventory CSV rows.
 * Extracted from Inventory.tsx so that it can be unit-tested without
 * rendering React or going through IPC.
 */
import type { ServerMetrics, DbCustomFields } from '../../../preload/index'
import type { InventoryStats } from '../types/index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date | string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString('it-IT') : 'Mai'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the flat array of CSV rows for the inventory export.
 * One row per database; if a server has no databases, one placeholder row
 * with empty database columns is emitted so the server still appears.
 *
 * Column order (19 columns, matches the headers in Inventory.tsx):
 *   Ambiente | Tipo | AG Nome | Server | Alias | Referente | Ruolo AG |
 *   Database | Stato DB | Dati (MB) | Log (MB) |
 *   Ultimo Backup Full | Ultimo Backup Log |
 *   Versione SQL | Uptime Server (giorni) | Stato Server | Tipo Infrastruttura |
 *   CPU Logici | CPU Fisici
 */
export function buildInventoryCsvRows(
  inventory: InventoryStats,
  serverAliases: Record<string, string>,
  metricsMap: Record<string, ServerMetrics>,
  dbCustomFields: Record<string, DbCustomFields>,
  allowedServerIds?: Set<string>
): string[][] {
  return inventory.groups.flatMap((group) => {
    // ── STANDALONE ────────────────────────────────────────────────────────
    const standaloneRows = group.standaloneServers.flatMap((srv) => {
      if (allowedServerIds && !allowedServerIds.has(srv.serverId)) return []
      const srvLabel = `${srv.ip}:${srv.port}`
      const alias = serverAliases[srvLabel] ?? ''
      const metrics = metricsMap[srvLabel]
      const databases = metrics?.databases ?? []
      const backupMap = Object.fromEntries(
        (metrics?.backupStatus ?? []).map((b) => [b.databaseName, b])
      )

      const hosting = srv.hostingType ?? 'on-premise'

      // Server con 0 DB → 1 riga placeholder
      if (databases.length === 0) {
        return [
          [
            group.groupName, 'Standalone', '', srvLabel, alias, '', '',
            '', '', '', '', '', '',
            srv.version ?? '',
            srv.uptimeDays?.toFixed(0) ?? '',
            srv.unreachable ? 'UNREACHABLE' : 'ONLINE',
            hosting,
            srv.logicalCpus?.toString() ?? '',
            srv.physicalCpus?.toString() ?? ''
          ]
        ]
      }

      return databases.map((db) => {
        const cfKey = `${srv.serverId}/${db.name}`
        const dbFields = dbCustomFields[cfKey] ?? {}
        const backup = backupMap[db.name]
        return [
          group.groupName, 'Standalone', '', srvLabel, alias,
          dbFields.referente ?? '',
          '',
          db.name,
          db.stateDesc ?? '',
          db.sizeMb?.toFixed(1) ?? '',
          db.logSizeMb?.toFixed(1) ?? '',
          backup?.lastFullBackup ? formatDate(backup.lastFullBackup) : 'Mai',
          backup?.lastLogBackup
            ? formatDate(backup.lastLogBackup)
            : db.recoveryModel === 'SIMPLE' ? 'N/A' : 'Mai',
          srv.version ?? '',
          srv.uptimeDays?.toFixed(0) ?? '',
          srv.unreachable ? 'UNREACHABLE' : 'ONLINE',
          hosting,
          srv.logicalCpus?.toString() ?? '',
          srv.physicalCpus?.toString() ?? ''
        ]
      })
    })

    // ── ALWAYS ON ─────────────────────────────────────────────────────────
    const agRows = group.agClusters.flatMap((ag) =>
      ag.replicas.flatMap((srv) => {
        if (allowedServerIds && !allowedServerIds.has(srv.serverId)) return []
        const srvLabel = `${srv.ip}:${srv.port}`
        const alias = serverAliases[srvLabel] ?? ''
        const metrics = metricsMap[srvLabel]
        const databases = metrics?.databases ?? []
        const backupMap = Object.fromEntries(
          (metrics?.backupStatus ?? []).map((b) => [b.databaseName, b])
        )

        const agHosting = srv.hostingType ?? 'on-premise'

        if (databases.length === 0) {
          return [
            [
              group.groupName, 'Always On', ag.agName, srvLabel, alias, '', srv.agRole ?? '',
              '', '', '', '', '', '',
              srv.version ?? '',
              srv.uptimeDays?.toFixed(0) ?? '',
              srv.unreachable ? 'UNREACHABLE' : 'ONLINE',
              agHosting,
              srv.logicalCpus?.toString() ?? '',
              srv.physicalCpus?.toString() ?? ''
            ]
          ]
        }

        return databases.map((db) => {
          const cfKey = `${srv.serverId}/${db.name}`
          const dbFields = dbCustomFields[cfKey] ?? {}
          const backup = backupMap[db.name]
          const isPrimary = srv.agRole === 'PRIMARY'
          return [
            group.groupName, 'Always On', ag.agName, srvLabel, alias,
            dbFields.referente ?? '',
            srv.agRole ?? '',
            db.name,
            db.stateDesc ?? '',
            isPrimary ? (db.sizeMb?.toFixed(1) ?? '') : '(replica)',
            isPrimary ? (db.logSizeMb?.toFixed(1) ?? '') : '(replica)',
            isPrimary
              ? (backup?.lastFullBackup ? formatDate(backup.lastFullBackup) : 'Mai')
              : '',
            isPrimary
              ? (backup?.lastLogBackup
                ? formatDate(backup.lastLogBackup)
                : db.recoveryModel === 'SIMPLE' ? 'N/A' : 'Mai')
              : '',
            srv.version ?? '',
            srv.uptimeDays?.toFixed(0) ?? '',
            srv.unreachable ? 'UNREACHABLE' : 'ONLINE',
            agHosting,
            srv.logicalCpus?.toString() ?? '',
            srv.physicalCpus?.toString() ?? ''
          ]
        })
      })
    )

    return [...standaloneRows, ...agRows]
  })
}
