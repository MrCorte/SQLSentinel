/**
 * AREA 5 — Export CSV
 *
 * Testa in modo isolato (senza IPC, senza React):
 *  - escapeCsvValue (src/main/csvUtils.ts)
 *  - buildCsvContent (src/main/csvUtils.ts) — BOM, \r\n, escape celle
 *  - buildInventoryCsvRows (src/renderer/src/utils/csvExportUtils.ts)
 *      · una riga per DB
 *      · server senza DB → 1 riga placeholder
 *      · replica SECONDARY → "(replica)" nelle colonne Dati/Log/Backup
 *      · referente DB ha priorità sul referente server (fallback non applicato qui:
 *        buildInventoryCsvRows usa solo dbCustomFields, non serverCustomFields)
 *      · server UNREACHABLE → colonna Stato Server = "UNREACHABLE"
 *      · replica PRIMARY → mostra valori numerici
 */
import { describe, it, expect } from 'vitest'
import { escapeCsvValue, buildCsvContent } from '../../../main/csvUtils'
import { buildInventoryCsvRows } from '../utils/csvExportUtils'
import type { InventoryStats, GroupInventory, ServerSummary, AgClusterSummary } from '../types/index'
import type { ServerMetrics, DatabaseInfo, BackupInfo } from '../../../preload/index'

// ═══════════════════════════════════════════════════════════════════════════════
// escapeCsvValue
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 5 — escapeCsvValue', () => {

  it('wrappa in virgolette doppie un valore semplice', () => {
    expect(escapeCsvValue('hello')).toBe('"hello"')
  })

  it('wrappa in "" i valori con virgola', () => {
    const result = escapeCsvValue('Rossi, Mario')
    expect(result).toBe('"Rossi, Mario"')
    // il valore wrappato contiene la virgola — deve essere distinto da separatore
    expect(result.startsWith('"')).toBe(true)
    expect(result.endsWith('"')).toBe(true)
  })

  it('wrappa in "" i valori con newline', () => {
    const result = escapeCsvValue('riga1\nriga2')
    expect(result).toBe('"riga1\nriga2"')
  })

  it('esegue l\'escape delle virgolette interne (doubled-quote)', () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""')
  })

  it('gestisce stringa vuota → ""', () => {
    expect(escapeCsvValue('')).toBe('""')
  })

  it('gestisce valori con \r\n (CRLF interno)', () => {
    const result = escapeCsvValue('a\r\nb')
    expect(result).toBe('"a\r\nb"')
    expect(result.startsWith('"')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildCsvContent
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 5 — buildCsvContent', () => {

  it('il CSV inizia con BOM \\uFEFF', () => {
    const csv = buildCsvContent(['Col'], [['val']])
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
  })

  it('usa \\r\\n come line separator (RFC 4180)', () => {
    const csv = buildCsvContent(['A', 'B'], [['1', '2'], ['3', '4']])
    // Rimuove il BOM
    const body = csv.slice(1)
    const lines = body.split('\r\n')
    expect(lines).toHaveLength(3)   // header + 2 righe dati
    expect(body).not.toContain('\n\r')  // no line ending invertiti
  })

  it('ogni cella è escapata con virgolette', () => {
    const csv = buildCsvContent(['H'], [['value']])
    expect(csv).toContain('"H"')
    expect(csv).toContain('"value"')
  })

  it('genera intestazione corretta come prima riga (dopo il BOM)', () => {
    const headers = ['Ambiente', 'Server', 'Database']
    const csv = buildCsvContent(headers, [])
    const firstLine = csv.slice(1).split('\r\n')[0]
    expect(firstLine).toBe('"Ambiente";"Server";"Database"')
  })

  it('genera N+1 righe per N righe di dati (header + dati)', () => {
    const rows = [['a', 'b'], ['c', 'd'], ['e', 'f']]
    const csv = buildCsvContent(['X', 'Y'], rows)
    const lines = csv.slice(1).split('\r\n')
    expect(lines).toHaveLength(4)  // 1 header + 3 righe
  })

  it('doppio escape su cella con virgolette interne', () => {
    const csv = buildCsvContent(['col'], [['"quoted"']])
    expect(csv).toContain('"""quoted"""')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildInventoryCsvRows — helpers per costruire fixture
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

function makeBackup(dbName: string, opts: {
  lastFull?: Date | null
  lastLog?: Date | null
} = {}): BackupInfo {
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

function makeServer(
  ip: string,
  id: string,
  opts: Partial<ServerSummary> = {}
): ServerSummary {
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
      servers: 0, standaloneServers: 0, agServers: 0, agClusters: 0,
      databases: 0, onlineDbs: 0, offlineDbs: 0, totalDataMb: 0, totalLogMb: 0
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildInventoryCsvRows
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 5 — buildInventoryCsvRows', () => {

  it('genera una riga per ogni database del server', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const metrics = makeMetrics([makeDb('DB_A'), makeDb('DB_B'), makeDb('DB_C')])
    const inventory = makeInventory([{
      groupId: 'g1', groupName: 'Prod', groupColor: '#00f',
      standaloneServers: [srv],
      standaloneDbCount: 3, standaloneOnline: 3, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])

    const rows = buildInventoryCsvRows(inventory, {}, { '10.0.0.1:1433': metrics }, {})

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r[7])).toEqual(['DB_A', 'DB_B', 'DB_C'])  // col 7 = Database
  })

  it('server con 0 DB genera esattamente 1 riga placeholder (campi DB vuoti)', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const inventory = makeInventory([{
      groupId: 'g1', groupName: 'Prod', groupColor: '#00f',
      standaloneServers: [srv],
      standaloneDbCount: 0, standaloneOnline: 0, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})  // nessuna metrica

    expect(rows).toHaveLength(1)
    expect(rows[0][7]).toBe('')   // Database = vuoto
    expect(rows[0][8]).toBe('')   // Stato DB = vuoto
    expect(rows[0][9]).toBe('')   // Dati (MB) = vuoto
  })

  it('server UNREACHABLE → colonna Stato Server = "UNREACHABLE"', () => {
    const srv = makeServer('10.0.0.1', 'srv1', { unreachable: true })
    const inventory = makeInventory([{
      groupId: null, groupName: 'Senza gruppo', groupColor: '#777',
      standaloneServers: [srv],
      standaloneDbCount: 0, standaloneOnline: 0, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})

    expect(rows[0][15]).toBe('UNREACHABLE')  // colonna indice 15 = Stato Server
  })

  it('server ONLINE → colonna Stato Server = "ONLINE"', () => {
    const srv = makeServer('10.0.0.1', 'srv1', { unreachable: false })
    const inventory = makeInventory([{
      groupId: null, groupName: 'Senza gruppo', groupColor: '#777',
      standaloneServers: [srv],
      standaloneDbCount: 0, standaloneOnline: 0, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})
    expect(rows[0][15]).toBe('ONLINE')
  })

  it('referente DB ha priorità: usa dbCustomFields se presente', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const db = makeDb('DB_A')
    const metrics = makeMetrics([db], [makeBackup('DB_A')])
    const inventory = makeInventory([{
      groupId: 'g1', groupName: 'Prod', groupColor: '#0f0',
      standaloneServers: [srv],
      standaloneDbCount: 1, standaloneOnline: 1, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])
    const dbCf = { 'srv1/DB_A': { referente: 'Mario Rossi' } }

    const rows = buildInventoryCsvRows(inventory, {}, { '10.0.0.1:1433': metrics }, dbCf)

    expect(rows[0][5]).toBe('Mario Rossi')  // colonna Referente (indice 5)
  })

  it('referente è stringa vuota quando dbCustomFields non contiene la chiave', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const db = makeDb('DB_A')
    const metrics = makeMetrics([db], [makeBackup('DB_A')])
    const inventory = makeInventory([{
      groupId: 'g1', groupName: 'Prod', groupColor: '#0f0',
      standaloneServers: [srv],
      standaloneDbCount: 1, standaloneOnline: 1, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])

    const rows = buildInventoryCsvRows(inventory, {}, { '10.0.0.1:1433': metrics }, {})
    expect(rows[0][5]).toBe('')
  })

  describe('Always On — replica SECONDARY', () => {

    function makeAgInventory(role: 'PRIMARY' | 'SECONDARY'): { inv: InventoryStats; metrics: Record<string, ServerMetrics> } {
      const rep = makeServer('10.0.0.1', 'srv1', { isAg: true, agRole: role, agName: 'AG_PROD' })
      const db = makeDb('DB_AG')
      const metrics = makeMetrics([db], [makeBackup('DB_AG')])
      const ag: AgClusterSummary = {
        agName: 'AG_PROD',
        health: 'HEALTHY',
        primaryReplica: '10.0.0.1',
        replicas: [rep],
        dbCount: 1, onlineCount: 1, offlineCount: 0, totalDataMb: 500, totalLogMb: 50
      }
      const inv = makeInventory([{
        groupId: 'g1', groupName: 'Prod', groupColor: '#f0f',
        standaloneServers: [],
        standaloneDbCount: 0, standaloneOnline: 0, standaloneOffline: 0,
        standaloneDataMb: 0, standaloneLogMb: 0,
        agClusters: [ag],
        agDbCount: 1, agOnline: 1, agOffline: 0, agDataMb: 500, agLogMb: 50
      }])
      return { inv, metrics: { '10.0.0.1:1433': metrics } }
    }

    it('replica SECONDARY → colonne Dati e Log mostrano "(replica)"', () => {
      const { inv, metrics } = makeAgInventory('SECONDARY')
      const rows = buildInventoryCsvRows(inv, {}, metrics, {})

      expect(rows[0][9]).toBe('(replica)')   // Dati (MB)
      expect(rows[0][10]).toBe('(replica)')  // Log (MB)
    })

    it('replica SECONDARY → colonne Backup Full e Log sono stringa vuota', () => {
      const { inv, metrics } = makeAgInventory('SECONDARY')
      const rows = buildInventoryCsvRows(inv, {}, metrics, {})

      expect(rows[0][11]).toBe('')  // Ultimo Backup Full
      expect(rows[0][12]).toBe('')  // Ultimo Backup Log
    })

    it('replica PRIMARY → colonne Dati e Log mostrano il valore numerico', () => {
      const { inv, metrics } = makeAgInventory('PRIMARY')
      const rows = buildInventoryCsvRows(inv, {}, metrics, {})

      expect(rows[0][9]).not.toBe('(replica)')
      expect(parseFloat(rows[0][9])).toBeGreaterThan(0)  // es. "500.0"
      expect(rows[0][10]).not.toBe('(replica)')
    })

    it('replica PRIMARY → colonne Backup mostrano la data (non stringa vuota)', () => {
      const { inv, metrics } = makeAgInventory('PRIMARY')
      const rows = buildInventoryCsvRows(inv, {}, metrics, {})

      expect(rows[0][11]).not.toBe('')   // Ultimo Backup Full
    })
  })

  it('colonna Tipo = "Standalone" per server standalone', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const inventory = makeInventory([{
      groupId: 'g1', groupName: 'Prod', groupColor: '#f0f',
      standaloneServers: [srv],
      standaloneDbCount: 0, standaloneOnline: 0, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})
    expect(rows[0][1]).toBe('Standalone')  // colonna Tipo
  })

  it('colonna Tipo = "Always On" per repliche AG', () => {
    const rep = makeServer('10.0.0.1', 'srv1', { isAg: true, agRole: 'PRIMARY', agName: 'AG1' })
    const ag: AgClusterSummary = {
      agName: 'AG1', health: 'HEALTHY', primaryReplica: '10.0.0.1',
      replicas: [rep], dbCount: 0, onlineCount: 0, offlineCount: 0, totalDataMb: 0, totalLogMb: 0
    }
    const inventory = makeInventory([{
      groupId: 'g1', groupName: 'Prod', groupColor: '#f0f',
      standaloneServers: [],
      standaloneDbCount: 0, standaloneOnline: 0, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [ag], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])

    const rows = buildInventoryCsvRows(inventory, {}, {}, {})
    expect(rows[0][1]).toBe('Always On')
  })

  it('DB con recoveryModel SIMPLE e lastLogBackup null → "N/A" (non "Mai")', () => {
    const srv = makeServer('10.0.0.1', 'srv1')
    const db = makeDb('DB_SIMPLE', { recoveryModel: 'SIMPLE' })
    const metrics = makeMetrics([db], [{ databaseName: 'DB_SIMPLE', lastFullBackup: new Date('2024-01-01'), lastDiffBackup: null, lastLogBackup: null }])
    const inventory = makeInventory([{
      groupId: 'g1', groupName: 'Prod', groupColor: '#0f0',
      standaloneServers: [srv],
      standaloneDbCount: 1, standaloneOnline: 1, standaloneOffline: 0,
      standaloneDataMb: 0, standaloneLogMb: 0,
      agClusters: [], agDbCount: 0, agOnline: 0, agOffline: 0, agDataMb: 0, agLogMb: 0
    }])

    const rows = buildInventoryCsvRows(inventory, {}, { '10.0.0.1:1433': metrics }, {})
    expect(rows[0][12]).toBe('N/A')  // Ultimo Backup Log
  })
})
