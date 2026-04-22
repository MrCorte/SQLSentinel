/**
 * AREA 5 — CSV Export
 *
 * Tests in isolation (no IPC, no React):
 *  - escapeCsvValue (src/main/csvUtils.ts)
 *  - buildCsvContent (src/main/csvUtils.ts) — BOM, \r\n, cell escaping
 *  - buildInventoryCsvRows (src/renderer/src/utils/csvExportUtils.ts)
 *      · one row per DB
 *      · server with no DBs → 1 placeholder row
 *      · SECONDARY replica → "(replica)" in Data/Log/Backup columns
 *      · DB referente takes priority over server referente (fallback not applied here:
 *        buildInventoryCsvRows uses only dbCustomFields, not serverCustomFields)
 *      · UNREACHABLE server → Server Status column = "UNREACHABLE"
 *      · PRIMARY replica → shows numeric values
 */
import { describe, it, expect } from 'vitest'
import { escapeCsvValue, buildCsvContent } from '../../../main/csvUtils'
import { buildInventoryCsvRows } from '../utils/csvExportUtils'
import type {
  InventoryStats,
  GroupInventory,
  ServerSummary,
  AgClusterSummary
} from '../types/index'
import type { ServerMetrics, DatabaseInfo, BackupInfo } from '../../../preload/index'

// ═══════════════════════════════════════════════════════════════════════════════
// escapeCsvValue
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 5 — escapeCsvValue', () => {
  it('wraps a simple value in double quotes', () => {
    expect(escapeCsvValue('hello')).toBe('"hello"')
  })

  it('wraps values containing a comma in double quotes', () => {
    const result = escapeCsvValue('Rossi, Mario')
    expect(result).toBe('"Rossi, Mario"')
    // the wrapped value contains the comma — it must be distinct from the separator
    expect(result.startsWith('"')).toBe(true)
    expect(result.endsWith('"')).toBe(true)
  })

  it('wraps values containing a newline in double quotes', () => {
    const result = escapeCsvValue('line1\nline2')
    expect(result).toBe('"line1\nline2"')
  })

  it('escapes internal quotes (doubled-quote)', () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""')
  })

  it('handles empty string → ""', () => {
    expect(escapeCsvValue('')).toBe('""')
  })

  it('handles values with \\r\\n (internal CRLF)', () => {
    const result = escapeCsvValue('a\r\nb')
    expect(result).toBe('"a\r\nb"')
    expect(result.startsWith('"')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildCsvContent
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 5 — buildCsvContent', () => {
  it('CSV starts with BOM \uFEFF', () => {
    const csv = buildCsvContent(['Col'], [['val']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('uses \r\n as line separator (RFC 4180)', () => {
    const csv = buildCsvContent(
      ['A', 'B'],
      [
        ['1', '2'],
        ['3', '4']
      ]
    )
    // Strips the BOM
    const body = csv.slice(1)
    const lines = body.split('\r\n')
    expect(lines).toHaveLength(3) // header + 2 data rows
    expect(body).not.toContain('\n\r') // no inverted line endings
  })

  it('every cell is escaped with quotes', () => {
    const csv = buildCsvContent(['H'], [['value']])
    expect(csv).toContain('"H"')
    expect(csv).toContain('"value"')
  })

  it('generates correct header as first row (after BOM)', () => {
    const headers = ['Environment', 'Server', 'Database']
    const csv = buildCsvContent(headers, [])
    const firstLine = csv.slice(1).split('\r\n')[0]
    expect(firstLine).toBe('"Environment";"Server";"Database"')
  })

  it('generates N+1 rows for N data rows (header + data)', () => {
    const rows = [
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f']
    ]
    const csv = buildCsvContent(['X', 'Y'], rows)
    const lines = csv.slice(1).split('\r\n')
    expect(lines).toHaveLength(4) // 1 header + 3 data rows
  })

  it('double-escapes a cell with internal quotes', () => {
    const csv = buildCsvContent(['col'], [['"quoted"']])
    expect(csv).toContain('"""quoted"""')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildInventoryCsvRows — helpers for building fixtures
// ═══════════════════════════════════════════════════════════════════════════════

function makeDb(name: string, overrides: Partial<DatabaseInfo> = {}): DatabaseInfo {
  return {
    name,
    stateDesc: 'ONLINE',
    recoveryModel: 'FULL',
    sizeMb: 500,
    logSizeMb: 50,
    compatibilityLevel: 150,
    isEncrypted: false,
    isReadOnly: false,
    owner: 'sa',
    createDate: '2020-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeBackup(
  dbName: string,
  opts: {
    lastFull?: Date | null
    lastLog?: Date | null
  } = {}
): BackupInfo {
  return {
    databaseName: dbName,
    lastFullBackup: opts.lastFull ?? new Date('2024-01-15'),
    lastDiffBackup: null,
    lastLogBackup: opts.lastLog ?? new Date('2024-01-15')
  }
}

function makeMetrics(dbs: DatabaseInfo[], backups?: BackupInfo[]): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: '2019',
      edition: 'Dev',
      memoryUsedMb: 100,
      memoryTargetMb: 200,
      cpuUsagePercent: 10,
      uptimeDays: 42,
      logicalCpus: 8,
      physicalCpus: 4
    },
    databases: dbs,
    activeSessions: [],
    topQueries: [],
    backupStatus: backups ?? dbs.map((d) => makeBackup(d.name)),
    waitStats: [],
    diskVolumes: [],
    databaseFiles: []
  }
}

function makeServer(ip: string, id: string, opts: Partial<ServerSummary> = {}): ServerSummary {
  return {
    serverId: id,
    displayName: ip,
    ip,
    port: 1433,
    version: '2019',
    edition: 'Dev',
    uptimeDays: 42,
    dbCount: 0,
    onlineCount: 0,
    offlineCount: 0,
    totalDataMb: 0,
    totalLogMb: 0,
    unreachable: false,
    isAg: false,
    ...opts
  }
}

function makeInventory(groups: GroupInventory[]): InventoryStats {
  return {
    groups,
    totals: {
      servers: 0,
      standaloneServers: 0,
      agServers: 0,
      agClusters: 0,
      databases: 0,
      onlineDbs: 0,
      offlineDbs: 0,
      totalDataMb: 0,
      totalLogMb: 0
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildInventoryCsvRows
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 5 — buildInventoryCsvRows', () => {
  it('generates one row per server database', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const metrics = makeMetrics([makeDb('DB_A'), makeDb('DB_B'), makeDb('DB_C')])
    const inventory = makeInventory([
      {
        groupId: 'g1',
        groupName: 'Prod',
        groupColor: '#00f',
        standaloneServers: [srv],
        standaloneDbCount: 3,
        standaloneOnline: 3,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])

    const rows = buildInventoryCsvRows(inventory, {}, { '10.0.0.1:1433': metrics }, {})

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r[7])).toEqual(['DB_A', 'DB_B', 'DB_C']) // col 7 = Database
  })

  it('server with 0 DBs generates exactly 1 placeholder row (empty DB fields)', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const inventory = makeInventory([
      {
        groupId: 'g1',
        groupName: 'Prod',
        groupColor: '#00f',
        standaloneServers: [srv],
        standaloneDbCount: 0,
        standaloneOnline: 0,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {}) // no metrics

    expect(rows).toHaveLength(1)
    expect(rows[0][7]).toBe('') // Database = empty
    expect(rows[0][8]).toBe('') // DB Status = empty
    expect(rows[0][9]).toBe('') // Data (MB) = empty
  })

  it('UNREACHABLE server → Server Status column = "UNREACHABLE"', () => {
    const srv = makeServer('10.0.0.1', 'srv1', { unreachable: true })
    const inventory = makeInventory([
      {
        groupId: null,
        groupName: 'No group',
        groupColor: '#777',
        standaloneServers: [srv],
        standaloneDbCount: 0,
        standaloneOnline: 0,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})

    expect(rows[0][15]).toBe('UNREACHABLE') // column index 15 = Server Status
  })

  it('ONLINE server → Server Status column = "ONLINE"', () => {
    const srv = makeServer('10.0.0.1', 'srv1', { unreachable: false })
    const inventory = makeInventory([
      {
        groupId: null,
        groupName: 'No group',
        groupColor: '#777',
        standaloneServers: [srv],
        standaloneDbCount: 0,
        standaloneOnline: 0,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})
    expect(rows[0][15]).toBe('ONLINE')
  })

  it('DB owner takes priority: uses dbCustomFields when present', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const db = makeDb('DB_A')
    const metrics = makeMetrics([db], [makeBackup('DB_A')])
    const inventory = makeInventory([
      {
        groupId: 'g1',
        groupName: 'Prod',
        groupColor: '#0f0',
        standaloneServers: [srv],
        standaloneDbCount: 1,
        standaloneOnline: 1,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])
    const dbCf = { 'srv1/DB_A': { referente: 'Mario Rossi' } }

    const rows = buildInventoryCsvRows(inventory, {}, { '10.0.0.1:1433': metrics }, dbCf)

    expect(rows[0][5]).toBe('Mario Rossi') // Referente column (index 5)
  })

  it('referente is empty string when dbCustomFields does not contain the key', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const db = makeDb('DB_A')
    const metrics = makeMetrics([db], [makeBackup('DB_A')])
    const inventory = makeInventory([
      {
        groupId: 'g1',
        groupName: 'Prod',
        groupColor: '#0f0',
        standaloneServers: [srv],
        standaloneDbCount: 1,
        standaloneOnline: 1,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])

    const rows = buildInventoryCsvRows(inventory, {}, { '10.0.0.1:1433': metrics }, {})
    expect(rows[0][5]).toBe('')
  })

  describe('Always On — replica SECONDARY', () => {
    function makeAgInventory(role: 'PRIMARY' | 'SECONDARY'): {
      inv: InventoryStats
      metrics: Record<string, ServerMetrics>
    } {
      const rep = makeServer('10.0.0.1', 'srv1', { isAg: true, agRole: role, agName: 'AG_PROD' })
      const db = makeDb('DB_AG')
      const metrics = makeMetrics([db], [makeBackup('DB_AG')])
      const ag: AgClusterSummary = {
        agName: 'AG_PROD',
        health: 'HEALTHY',
        primaryReplica: '10.0.0.1',
        replicas: [rep],
        dbCount: 1,
        onlineCount: 1,
        offlineCount: 0,
        totalDataMb: 500,
        totalLogMb: 50
      }
      const inv = makeInventory([
        {
          groupId: 'g1',
          groupName: 'Prod',
          groupColor: '#f0f',
          standaloneServers: [],
          standaloneDbCount: 0,
          standaloneOnline: 0,
          standaloneOffline: 0,
          standaloneDataMb: 0,
          standaloneLogMb: 0,
          agClusters: [ag],
          agDbCount: 1,
          agOnline: 1,
          agOffline: 0,
          agDataMb: 500,
          agLogMb: 50
        }
      ])
      return { inv, metrics: { '10.0.0.1:1433': metrics } }
    }

    it('SECONDARY replica → Data and Log columns show "(replica)"', () => {
      const { inv, metrics } = makeAgInventory('SECONDARY')
      const rows = buildInventoryCsvRows(inv, {}, metrics, {})

      expect(rows[0][9]).toBe('(replica)') // Dati (MB)
      expect(rows[0][10]).toBe('(replica)') // Log (MB)
    })

    it('SECONDARY replica → Full and Log Backup columns are empty string', () => {
      const { inv, metrics } = makeAgInventory('SECONDARY')
      const rows = buildInventoryCsvRows(inv, {}, metrics, {})

      expect(rows[0][11]).toBe('') // Last Full Backup
      expect(rows[0][12]).toBe('') // Last Log Backup
    })

    it('PRIMARY replica → Data and Log columns show the numeric value', () => {
      const { inv, metrics } = makeAgInventory('PRIMARY')
      const rows = buildInventoryCsvRows(inv, {}, metrics, {})

      expect(rows[0][9]).not.toBe('(replica)')
      expect(parseFloat(rows[0][9])).toBeGreaterThan(0) // e.g. "500.0"
      expect(rows[0][10]).not.toBe('(replica)')
    })

    it('PRIMARY replica → Backup columns show the date (not empty string)', () => {
      const { inv, metrics } = makeAgInventory('PRIMARY')
      const rows = buildInventoryCsvRows(inv, {}, metrics, {})

      expect(rows[0][11]).not.toBe('') // Last Full Backup
    })
  })

  it('Type column = "Standalone" for standalone servers', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const inventory = makeInventory([
      {
        groupId: 'g1',
        groupName: 'Prod',
        groupColor: '#f0f',
        standaloneServers: [srv],
        standaloneDbCount: 0,
        standaloneOnline: 0,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})
    expect(rows[0][1]).toBe('Standalone') // Type column
  })

  it('Type column = "Always On" for AG replicas', () => {
    const rep = makeServer('10.0.0.1', 'srv1', { isAg: true, agRole: 'PRIMARY', agName: 'AG1' })
    const ag: AgClusterSummary = {
      agName: 'AG1',
      health: 'HEALTHY',
      primaryReplica: '10.0.0.1',
      replicas: [rep],
      dbCount: 0,
      onlineCount: 0,
      offlineCount: 0,
      totalDataMb: 0,
      totalLogMb: 0
    }
    const inventory = makeInventory([
      {
        groupId: 'g1',
        groupName: 'Prod',
        groupColor: '#f0f',
        standaloneServers: [],
        standaloneDbCount: 0,
        standaloneOnline: 0,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [ag],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})
    expect(rows[0][1]).toBe('Always On')
  })

  it('DB with SIMPLE recovery model and null lastLogBackup → "N/A" (not "Never")', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const db = makeDb('DB_SIMPLE', { recoveryModel: 'SIMPLE' })
    const metrics = makeMetrics(
      [db],
      [
        {
          databaseName: 'DB_SIMPLE',
          lastFullBackup: new Date('2024-01-01'),
          lastDiffBackup: null,
          lastLogBackup: null
        }
      ]
    )
    const inventory = makeInventory([
      {
        groupId: 'g1',
        groupName: 'Prod',
        groupColor: '#0f0',
        standaloneServers: [srv],
        standaloneDbCount: 1,
        standaloneOnline: 1,
        standaloneOffline: 0,
        standaloneDataMb: 0,
        standaloneLogMb: 0,
        agClusters: [],
        agDbCount: 0,
        agOnline: 0,
        agOffline: 0,
        agDataMb: 0,
        agLogMb: 0
      }
    ])

    const rows = buildInventoryCsvRows(inventory, {}, { '10.0.0.1:1433': metrics }, {})
    expect(rows[0][12]).toBe('N/A') // Last Log Backup
  })
})
