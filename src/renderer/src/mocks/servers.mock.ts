/**
 * Mock data realistici per testare tutti i filtri dell'Inventario.
 *
 * Copertura:
 *   Ambiente  → PRODUZIONE / COLLAUDO / SVILUPPO
 *   Tipo      → AG Primary / AG Secondary / Standalone
 *   Stato     → Online / Offline (unreachable)
 *   Hosting   → Cloud / On-Premise
 *   Alias     → 12 valori distinti
 *   Referente → Andrea Cortesi / Mario Rossi / Luca Bianchi / Sara Verdi / null
 *   Macchina  → SQLPROD03 e SQLPROD04 con 2 istanze → machine-header in inventario
 *               SQLDEV01 con 2 istanze
 *
 * Attivazione: VITE_USE_MOCK=true in .env.development
 */

import type { StoredServer, ServerMetrics, DatabaseInfo } from '../../../preload/index'
import type { AgGroupState } from '../store/agStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServer(
  id: string,
  host: string,
  port: number,
  opts: {
    instanceName?: string
    machineName: string
    agGroupId?: string
    agName?: string
    agRole?: 'PRIMARY' | 'SECONDARY'
    hostingType: 'cloud' | 'on-premise'
    unreachable?: boolean
  }
): StoredServer {
  return {
    id,
    host,
    ip: host,
    port,
    instanceName: opts.instanceName,
    machineName: opts.machineName,
    agGroupId: opts.agGroupId,
    agName: opts.agName,
    agRole: opts.agRole,
    hostingType: opts.hostingType,
    useWindowsAuth: true,
    unreachable: opts.unreachable ?? false,
    addedAt: '2025-01-01T00:00:00.000Z',
    lastSeen: opts.unreachable ? undefined : new Date().toISOString(),
  }
}

function makeDb(
  name: string,
  sizeMb: number,
  opts: { referente?: string; stateDesc?: string; recoveryModel?: string } = {}
): DatabaseInfo {
  return {
    name,
    stateDesc: opts.stateDesc ?? 'ONLINE',
    recoveryModel: opts.recoveryModel ?? 'FULL',
    sizeMb,
    logSizeMb: Math.round(sizeMb * 0.12),
    compatibilityLevel: 150,
    isEncrypted: false,
    isReadOnly: false,
    owner: 'sa',
    createDate: '2020-01-01T00:00:00.000Z',
    referente: opts.referente,
  }
}

function makeMetrics(
  databases: DatabaseInfo[],
  opts: { version?: string; uptimeDays?: number; cpu?: number; logicalCpus?: number; physicalCpus?: number } = {}
): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: opts.version ?? 'Microsoft SQL Server 2019 (RTM-CU23) (KB5030333) - 15.0.4345.5',
      edition: 'Enterprise Edition',
      memoryUsedMb: 4096,
      memoryTargetMb: 8192,
      cpuUsagePercent: opts.cpu ?? 12,
      uptimeDays: opts.uptimeDays ?? 45,
      logicalCpus: opts.logicalCpus ?? 16,
      physicalCpus: opts.physicalCpus ?? 8,
    },
    databases,
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: [],
  }
}

// ---------------------------------------------------------------------------
// Servers (12 totali)
// ---------------------------------------------------------------------------

export const MOCK_SERVERS: StoredServer[] = [
  // ── Produzione — AG Cluster AG-PROD-01 ───────────────────────────────────
  makeServer('mock-s01', '10.0.1.1', 1433, {
    machineName: 'SQLPROD01',
    agGroupId: 'mock-ag-prod-01',
    agName: 'AG-PROD-01',
    agRole: 'PRIMARY',
    hostingType: 'cloud',
  }),
  makeServer('mock-s02', '10.0.1.2', 1433, {
    machineName: 'SQLPROD02',
    agGroupId: 'mock-ag-prod-01',
    agName: 'AG-PROD-01',
    agRole: 'SECONDARY',
    hostingType: 'cloud',
  }),

  // ── Produzione — Standalone, stessa macchina SQLPROD03 (machine-header) ──
  makeServer('mock-s03', '10.0.1.3', 1433, {
    machineName: 'SQLPROD03',
    hostingType: 'on-premise',
  }),
  makeServer('mock-s04', '10.0.1.3', 1434, {
    machineName: 'SQLPROD03',
    hostingType: 'on-premise',
    unreachable: true,
  }),

  // ── Produzione — Standalone, stessa macchina SQLPROD04 (machine-header) ──
  makeServer('mock-s05', '10.0.1.4', 1433, {
    machineName: 'SQLPROD04',
    hostingType: 'on-premise',
  }),
  makeServer('mock-s06', '10.0.1.4', 1435, {
    machineName: 'SQLPROD04',
    instanceName: 'ISTANZA2',
    hostingType: 'on-premise',
  }),

  // ── Collaudo — AG Cluster AG-COLL-01 ─────────────────────────────────────
  makeServer('mock-s07', '10.0.2.1', 1433, {
    machineName: 'SQLCOLL01',
    agGroupId: 'mock-ag-coll-01',
    agName: 'AG-COLL-01',
    agRole: 'PRIMARY',
    hostingType: 'cloud',
  }),
  makeServer('mock-s08', '10.0.2.2', 1433, {
    machineName: 'SQLCOLL02',
    agGroupId: 'mock-ag-coll-01',
    agName: 'AG-COLL-01',
    agRole: 'SECONDARY',
    hostingType: 'on-premise',
  }),

  // ── Collaudo — Standalone offline ────────────────────────────────────────
  makeServer('mock-s09', '10.0.2.3', 1433, {
    machineName: 'SQLCOLL03',
    hostingType: 'on-premise',
    unreachable: true,
  }),

  // ── Sviluppo — Standalone, stessa macchina SQLDEV01 (machine-header) ─────
  makeServer('mock-s10', '10.0.3.1', 1433, {
    machineName: 'SQLDEV01',
    hostingType: 'on-premise',
  }),
  makeServer('mock-s11', '10.0.3.1', 1434, {
    machineName: 'SQLDEV01',
    hostingType: 'on-premise',
  }),

  // ── Sviluppo — Cloud, completamente irraggiungibile ───────────────────────
  makeServer('mock-s12', '10.0.3.2', 1433, {
    machineName: 'SQLDEV02',
    hostingType: 'cloud',
    unreachable: true,
  }),
]

// ---------------------------------------------------------------------------
// Group assignments  (ip:port → groupId)
// ---------------------------------------------------------------------------

export const MOCK_SERVER_GROUPS: Record<string, string> = {
  '10.0.1.1:1433': 'default-prod',
  '10.0.1.2:1433': 'default-prod',
  '10.0.1.3:1433': 'default-prod',
  '10.0.1.3:1434': 'default-prod',
  '10.0.1.4:1433': 'default-prod',
  '10.0.1.4:1435': 'default-prod',
  '10.0.2.1:1433': 'default-coll',
  '10.0.2.2:1433': 'default-coll',
  '10.0.2.3:1433': 'default-coll',
  '10.0.3.1:1433': 'default-dev',
  '10.0.3.1:1434': 'default-dev',
  '10.0.3.2:1433': 'default-dev',
}

// ---------------------------------------------------------------------------
// Server aliases  (server.id UUID → alias)
// ---------------------------------------------------------------------------

export const MOCK_SERVER_ALIASES: Record<string, string> = {
  'mock-s01': 'pw01',
  'mock-s02': 'en01',
  'mock-s03': 'pippo',
  'mock-s04': 'report01',
  'mock-s05': 'PROD-IST1',
  'mock-s06': 'PROD-IST2',
  'mock-s07': 'coll01',
  'mock-s08': 'coll02',
  'mock-s09': 'coll-sa',
  'mock-s10': 'dev01',
  'mock-s11': 'dev02',
  'mock-s12': 'dev-unreachable',
}

// ---------------------------------------------------------------------------
// Metrics map  (ip:port → ServerMetrics)
// dev-unreachable (10.0.3.2) ha no metrics: irraggiungibile, dbCount 0
// ---------------------------------------------------------------------------

const REF_ANDREA = 'Andrea Cortesi'
const REF_MARIO  = 'Mario Rossi'
const REF_LUCA   = 'Luca Bianchi'
const REF_SARA   = 'Sara Verdi'
const V2019      = 'Microsoft SQL Server 2019 (RTM-CU23) - 15.0.4345.5'
const V2022      = 'Microsoft SQL Server 2022 (RTM-CU12) - 16.0.4105.2'

export const MOCK_METRICS_MAP: Record<string, ServerMetrics> = {
  // pw01 — AG PRIMARY, 8 DB, referente: Andrea Cortesi
  '10.0.1.1:1433': makeMetrics(
    [
      makeDb('AppProd',       4200, { referente: REF_ANDREA }),
      makeDb('AppProd_Log',    320, { referente: REF_ANDREA }),
      makeDb('Anagrafica',    1800, { referente: REF_ANDREA }),
      makeDb('Contabilita',   2100, { referente: REF_ANDREA }),
      makeDb('Magazzino',      950, { referente: REF_ANDREA }),
      makeDb('Spedizioni',     610, { referente: REF_ANDREA }),
      makeDb('Archivio2023',  3400, { referente: REF_ANDREA }),
      makeDb('Reporting',      750, { referente: REF_ANDREA }),
    ],
    { version: V2022, uptimeDays: 123, cpu: 18 }
  ),

  // en01 — AG SECONDARY (replica), 8 DB, referente: Andrea Cortesi
  '10.0.1.2:1433': makeMetrics(
    [
      makeDb('AppProd',       4200, { referente: REF_ANDREA }),
      makeDb('AppProd_Log',    320, { referente: REF_ANDREA }),
      makeDb('Anagrafica',    1800, { referente: REF_ANDREA }),
      makeDb('Contabilita',   2100, { referente: REF_ANDREA }),
      makeDb('Magazzino',      950, { referente: REF_ANDREA }),
      makeDb('Spedizioni',     610, { referente: REF_ANDREA }),
      makeDb('Archivio2023',  3400, { referente: REF_ANDREA }),
      makeDb('Reporting',      750, { referente: REF_ANDREA }),
    ],
    { version: V2022, uptimeDays: 123, cpu: 5 }
  ),

  // pippo — Standalone, 3 DB online, referente: Mario Rossi
  '10.0.1.3:1433': makeMetrics(
    [
      makeDb('ReportDB',       980, { referente: REF_MARIO }),
      makeDb('ArchivioSQL',   1560, { referente: REF_MARIO }),
      makeDb('MonitorDB',      230, { referente: REF_MARIO }),
    ],
    { version: V2019, uptimeDays: 210, cpu: 8 }
  ),

  // report01 — Standalone OFFLINE, 2 DB (ultimo stato noto), referente: Mario Rossi
  '10.0.1.3:1434': makeMetrics(
    [
      makeDb('OldReports',    1200, { referente: REF_MARIO, stateDesc: 'OFFLINE' }),
      makeDb('LegacyApp',      430, { referente: REF_MARIO, stateDesc: 'OFFLINE' }),
    ],
    { version: V2019, uptimeDays: 0, cpu: 0 }
  ),

  // PROD-IST1 — Standalone, 5 DB, referente: Luca Bianchi
  '10.0.1.4:1433': makeMetrics(
    [
      makeDb('WebApp',        3100, { referente: REF_LUCA }),
      makeDb('ERP',           5800, { referente: REF_LUCA }),
      makeDb('CRM',           2200, { referente: REF_LUCA }),
      makeDb('HR',             840, { referente: REF_LUCA }),
      makeDb('Finance',       1650, { referente: REF_LUCA }),
    ],
    { version: V2022, uptimeDays: 67, cpu: 24 }
  ),

  // PROD-IST2\ISTANZA2 — Standalone, 4 DB, referente: Luca Bianchi
  '10.0.1.4:1435': makeMetrics(
    [
      makeDb('IST2_Staging',   720, { referente: REF_LUCA }),
      makeDb('IST2_Archive',  1340, { referente: REF_LUCA }),
      makeDb('IST2_Test',      410, { referente: REF_LUCA }),
      makeDb('IST2_Config',     90, { referente: REF_LUCA }),
    ],
    { version: V2022, uptimeDays: 67, cpu: 6 }
  ),

  // coll01 — AG PRIMARY Collaudo, 6 DB, referente: Andrea Cortesi
  '10.0.2.1:1433': makeMetrics(
    [
      makeDb('Coll_AppProd',   800, { referente: REF_ANDREA }),
      makeDb('Coll_Anagrafica', 600, { referente: REF_ANDREA }),
      makeDb('Coll_Contab',    500, { referente: REF_ANDREA }),
      makeDb('Coll_Mag',       300, { referente: REF_ANDREA }),
      makeDb('Coll_Sped',      200, { referente: REF_ANDREA }),
      makeDb('Coll_Report',    150, { referente: REF_ANDREA }),
    ],
    { version: V2019, uptimeDays: 32, cpu: 11 }
  ),

  // coll02 — AG SECONDARY Collaudo, 6 DB, referente: Sara Verdi
  '10.0.2.2:1433': makeMetrics(
    [
      makeDb('Coll_AppProd',   800, { referente: REF_SARA }),
      makeDb('Coll_Anagrafica', 600, { referente: REF_SARA }),
      makeDb('Coll_Contab',    500, { referente: REF_SARA }),
      makeDb('Coll_Mag',       300, { referente: REF_SARA }),
      makeDb('Coll_Sped',      200, { referente: REF_SARA }),
      makeDb('Coll_Report',    150, { referente: REF_SARA }),
    ],
    { version: V2019, uptimeDays: 32, cpu: 4 }
  ),

  // coll-sa — Standalone OFFLINE, 1 DB (ultimo stato noto), referente: Sara Verdi
  '10.0.2.3:1433': makeMetrics(
    [
      makeDb('CollStandalone', 280, { referente: REF_SARA, stateDesc: 'OFFLINE' }),
    ],
    { version: V2019, uptimeDays: 0, cpu: 0 }
  ),

  // dev01 — SQLDEV01 istanza default, 12 DB, referente: Luca Bianchi
  '10.0.3.1:1433': makeMetrics(
    Array.from({ length: 12 }, (_, i) =>
      makeDb(`DevDB_${String(i + 1).padStart(2, '0')}`, 100 + i * 30, {
        referente: REF_LUCA,
        stateDesc: i === 10 ? 'OFFLINE' : 'ONLINE',
      })
    ),
    { version: V2019, uptimeDays: 8, cpu: 33 }
  ),

  // dev02 — SQLDEV01 istanza secondaria, 7 DB, referente: null
  '10.0.3.1:1434': makeMetrics(
    Array.from({ length: 7 }, (_, i) =>
      makeDb(`ExpDB_${String(i + 1).padStart(2, '0')}`, 50 + i * 20)
    ),
    { version: V2019, uptimeDays: 2, cpu: 15 }
  ),

  // dev-unreachable — no entry (irraggiungibile, nessuna metrica disponibile)
}

// ---------------------------------------------------------------------------
// AG Groups  (keyed by ag_name, same convention used by agStore)
// ---------------------------------------------------------------------------

export const MOCK_AG_GROUPS: Record<string, AgGroupState> = {
  'AG-PROD-01': {
    id: 'mock-ag-prod-01',
    ag_name: 'AG-PROD-01',
    health: 'HEALTHY',
    primary_replica: '10.0.1.1',
    serverIds: ['mock-s01', 'mock-s02'],
  },
  'AG-COLL-01': {
    id: 'mock-ag-coll-01',
    ag_name: 'AG-COLL-01',
    health: 'HEALTHY',
    primary_replica: '10.0.2.1',
    serverIds: ['mock-s07', 'mock-s08'],
  },
}
