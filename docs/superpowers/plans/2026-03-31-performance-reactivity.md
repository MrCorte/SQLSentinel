# Performance & Reactivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminare re-render superflui nel renderer e ridurre il carico T-SQL sui server in background — risultato: UI fluida a 200+ server senza freeze durante i polling.

**Architecture:** Quattro interventi indipendenti: (1) selettori Zustand precisi in Dashboard e Sidebar per evitare re-render a cascata; (2) rimozione del console.log di debug in Sidebar; (3) `collectMetricsCritical()` che salta le 3 query T-SQL non necessarie per i server idle; (4) query SQLite bulk al boot per caricare lo storico in una sola passata invece di N query separate.

**Tech Stack:** React 19 + Zustand 5 (`useShallow` da `zustand/shallow`) + better-sqlite3 (window functions SQLite ≥ 3.25) + mssql v12 + Vitest

---

## File modificati

| File | Modifica |
|------|----------|
| `src/renderer/src/pages/Dashboard.tsx` | Selettore `useServersStore` + `useMetricsStore` precisi |
| `src/renderer/src/components/Sidebar.tsx` | `useGroupsStore` con `useShallow` + rimozione debug log |
| `src/main/collectors/sqlCollector.ts` | Aggiunge `collectMetricsCritical()` — 5 query invece di 8 |
| `src/main/metricsWorker.ts` | Usa `collectMetricsCritical` quando `lightCollectors: true` |
| `src/main/store/metricsRepository.ts` | Aggiunge `findLastNBulk()` — una query SQLite per tutti i server |
| `src/main/collectors/sqlCollector.test.ts` | Test per `collectMetricsCritical` |
| `src/main/store/__tests__/metricsRepository.bulk.test.ts` | Test per `findLastNBulk` |

---

## Task 1 — Dashboard.tsx: selettori Zustand precisi

**Problema:** `useServersStore()` senza selettore (riga 59) causa re-render ad ogni cambio store (aggiunta server, rename, etc.). `useMetricsStore((s) => s.metricsMap)` (riga 78) causa re-render ad ogni aggiornamento di **qualsiasi** server (anche i 199 non visualizzati).

**Files:**
- Modify: `src/renderer/src/pages/Dashboard.tsx` righe 59, 78–85

- [ ] **Step 1: Aggiorna gli import** — aggiungi `useShallow` in cima al file

```typescript
// Cerca la riga con l'import da 'zustand/shallow' o aggiungila dopo gli import React:
import { useShallow } from 'zustand/shallow'
```

- [ ] **Step 2: Sostituisci il selettore useServersStore (riga 59)**

```typescript
// PRIMA (riga 59):
const { servers, initialized, removeServer, updateServer } = useServersStore()

// DOPO — useShallow evita re-render quando cambiano proprietà non usate:
const { servers, initialized, removeServer, updateServer } = useServersStore(
  useShallow((s) => ({
    servers: s.servers,
    initialized: s.initialized,
    removeServer: s.removeServer,
    updateServer: s.updateServer,
  }))
)
```

- [ ] **Step 3: Sposta e sostituisci il selettore useMetricsStore (riga 78)**

La riga `const metricsMap = useMetricsStore((s) => s.metricsMap)` va **spostata** dopo riga 90 dove `selectedServerId` è disponibile, e riscritta per selezionare solo il server attivo:

```typescript
// Rimuovi riga 78:
// const metricsMap = useMetricsStore((s) => s.metricsMap)   ← ELIMINA

// Dopo riga 90 (const selectedServerId = ...):
const cachedMetrics = useMetricsStore(
  (s) => (selectedServerId ? s.metricsMap[selectedServerId] ?? null : null)
)
```

- [ ] **Step 4: Aggiorna l'uso di metricsMap nel render (riga 385)**

```typescript
// PRIMA:
const displayMetrics = metrics ?? (selectedServerId ? metricsMap[selectedServerId] ?? null : null)

// DOPO:
const displayMetrics = metrics ?? cachedMetrics
```

- [ ] **Step 5: Verifica typecheck**

```bash
npm run typecheck
```
Expected: zero errori.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Dashboard.tsx
git commit -m "perf(renderer): narrow Zustand selectors in Dashboard — avoid re-render on unrelated server updates"
```

---

## Task 2 — Sidebar.tsx: useShallow + rimozione debug log

**Problema:** `useGroupsStore()` senza selettore (riga 1011) causa re-render ad ogni cambio del groupsStore — inclusi toggle collapse, rename alias, ecc. Il `console.log` a riga 1026 emette una riga per ogni render (centinaia/secondo con 200+ server).

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx` righe 1011–1026

- [ ] **Step 1: Aggiungi import useShallow** (se non già presente nel file)

Cerca `import { useShallow }` nel file. Se assente, aggiungilo:

```typescript
import { useShallow } from 'zustand/shallow'
```

- [ ] **Step 2: Sostituisci useGroupsStore() con useShallow**

```typescript
// PRIMA (righe 1011-1022):
const {
  groups,
  serverGroups,
  serverAliases,
  expandedAGs,
  expandedMachines,
  toggleCollapse,
  toggleAgCollapse,
  toggleMachineCollapse,
  setServerGroup,
  setServerAlias
} = useGroupsStore()

// DOPO:
const {
  groups,
  serverGroups,
  serverAliases,
  expandedAGs,
  expandedMachines,
  toggleCollapse,
  toggleAgCollapse,
  toggleMachineCollapse,
  setServerGroup,
  setServerAlias
} = useGroupsStore(
  useShallow((s) => ({
    groups: s.groups,
    serverGroups: s.serverGroups,
    serverAliases: s.serverAliases,
    expandedAGs: s.expandedAGs,
    expandedMachines: s.expandedMachines,
    toggleCollapse: s.toggleCollapse,
    toggleAgCollapse: s.toggleAgCollapse,
    toggleMachineCollapse: s.toggleMachineCollapse,
    setServerGroup: s.setServerGroup,
    setServerAlias: s.setServerAlias,
  }))
)
```

- [ ] **Step 3: Rimuovi debug log e storeServers (righe 1025–1026)**

```typescript
// ELIMINA queste due righe:
const storeServers = useServersStore((s) => s.servers)
console.log('[Sidebar] render — props:', servers.length, 'store:', storeServers.length)
```

Se l'import di `useServersStore` non è usato altrove nel file, rimuovilo dall'import statement in cima.

- [ ] **Step 4: Verifica typecheck**

```bash
npm run typecheck
```
Expected: zero errori.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx
git commit -m "perf(renderer): fix Sidebar useGroupsStore selector with useShallow, remove debug console.log"
```

---

## Task 3 — collectMetricsCritical(): salta 3 query T-SQL su server idle

**Problema:** Con `lightCollectors: true` (server background) il worker esegue comunque 8 query T-SQL incluse `topQueries` (CROSS APPLY su query cache), `waitStats` (aggregazione wait stats) e `databaseFiles` (FILEPROPERTY per file), poi scarta i risultati. Su 200 server idle = 600 query T-SQL superflue per ciclo.

**Files:**
- Modify: `src/main/collectors/sqlCollector.ts` — aggiunge `collectMetricsCritical()`
- Modify: `src/main/metricsWorker.ts` — usa la funzione giusta in base a `lightCollectors`
- Modify: `src/main/collectors/sqlCollector.test.ts` — nuovo test

- [ ] **Step 1: Scrivi il test che fallisce**

In `src/main/collectors/sqlCollector.test.ts`, aggiungi dopo l'import `collectMetrics` esistente:

```typescript
import { collectMetrics, collectMetricsCritical } from './sqlCollector'
```

Poi aggiungi un nuovo `describe` dopo quello esistente:

```typescript
describe('collectMetricsCritical', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('esegue solo 5 query (salta dm_exec_query_stats, dm_os_wait_stats, FILEPROPERTY)', async () => {
    const { mockPool, mockRequest } = makeMockPool()
    vi.mocked(mssql.connect as (config: mssql.config | string) => Promise<mssql.ConnectionPool>)
      .mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)

    const result = await collectMetricsCritical(CONN)

    const executedSqls: string[] = mockRequest.query.mock.calls.map(([sql]: [string]) => sql)

    // Le 3 query costose NON devono essere eseguite
    expect(executedSqls.some((sql) => sql.includes('dm_exec_query_stats'))).toBe(false)
    expect(executedSqls.some((sql) => sql.includes('dm_os_wait_stats'))).toBe(false)
    expect(executedSqls.some((sql) => sql.includes('FILEPROPERTY'))).toBe(false)

    // Le 5 query critiche DEVONO essere eseguite
    expect(executedSqls.some((sql) => sql.includes('dm_os_process_memory'))).toBe(true)
    expect(executedSqls.some((sql) => sql.includes('sys.databases'))).toBe(true)
    expect(executedSqls.some((sql) => sql.includes('dm_exec_requests'))).toBe(true)
    expect(executedSqls.some((sql) => sql.includes('backupset'))).toBe(true)
    expect(executedSqls.some((sql) => sql.includes('dm_os_volume_stats'))).toBe(true)

    // Esattamente 5 chiamate .query()
    expect(mockRequest.query).toHaveBeenCalledTimes(5)

    // I campi saltati sono array vuoti
    expect(result.topQueries).toEqual([])
    expect(result.waitStats).toEqual([])
    expect(result.databaseFiles).toEqual([])

    // I campi critici sono valorizzati
    expect(result.instanceInfo.version).toBe(INSTANCE_ROW.version)
    expect(result.databases).toHaveLength(1)
    expect(result.backupStatus).toHaveLength(1)

    // Pool sempre chiuso
    expect(mockPool.close).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Esegui il test — verifica che fallisca**

```bash
npm test -- --testPathPattern="sqlCollector"
```
Expected: FAIL — `collectMetricsCritical is not a function`

- [ ] **Step 3: Implementa collectMetricsCritical in sqlCollector.ts**

Aggiungi alla fine di `src/main/collectors/sqlCollector.ts`, dopo `collectMetrics`:

```typescript
/**
 * Raccoglie solo le metriche necessarie per la valutazione degli alert:
 * CPU/memoria, stato DB, sessioni bloccate, backup age, spazio disco.
 * Salta topQueries (dm_exec_query_stats), waitStats (dm_os_wait_stats) e
 * databaseFiles (FILEPROPERTY) — usato per server idle/background con lightCollectors=true.
 */
export async function collectMetricsCritical(connection: ServerConnection): Promise<ServerMetrics> {
  const config = buildConfig(connection)
  let pool: mssql.ConnectionPool | null = null

  try {
    pool = await mssql.connect(config)

    const [instanceInfo, databases, activeSessions, backupStatus, diskVolumes] = await Promise.all([
      queryInstanceInfo(pool).catch((err: Error) => {
        console.error('[collector] instance info:', err.message)
        return defaultInstanceInfo()
      }),
      queryDatabases(pool).catch((err: Error) => {
        console.error('[collector] databases:', err.message)
        return [] as DatabaseInfo[]
      }),
      querySessions(pool).catch((err: Error) => {
        console.error('[collector] sessions:', err.message)
        return [] as SessionInfo[]
      }),
      queryBackupStatus(pool).catch((err: Error) => {
        console.error('[collector] backup status:', err.message)
        return [] as BackupInfo[]
      }),
      queryDiskVolumes(pool).catch((err: Error) => {
        console.error('[collector] disk volumes:', err.message)
        return [] as DiskVolume[]
      }),
    ])

    return {
      collectedAt: new Date(),
      instanceInfo,
      databases,
      activeSessions,
      topQueries: [],
      backupStatus,
      waitStats: [],
      diskVolumes,
      databaseFiles: [],
    }
  } finally {
    if (pool) {
      await pool.close().catch((err: Error) =>
        console.error('[collector] pool.close:', err.message)
      )
    }
  }
}
```

- [ ] **Step 4: Aggiorna metricsWorker.ts — usa collectMetricsCritical quando lightCollectors=true**

In `src/main/metricsWorker.ts`, aggiorna l'import:

```typescript
// PRIMA:
import { collectMetrics } from './collectors/sqlCollector'

// DOPO:
import { collectMetrics, collectMetricsCritical } from './collectors/sqlCollector'
```

Poi nella funzione `runJob()`, sostituisci la chiamata a `collectMetrics` e rimuovi il blocco di stripping:

```typescript
// PRIMA (righe ~289-318):
const metrics = await Promise.race([
  collectMetrics(job.server),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('poll timeout')), POLL_TIMEOUT_MS)
  ),
])
// ... (blocco enrichedMetrics) ...
if (intervalOverrides?.lightCollectors) {
  enrichedMetrics = {
    ...enrichedMetrics,
    topQueries: [],
    waitStats: [],
    databaseFiles: [],
  }
}

// DOPO — scegli la funzione al momento della chiamata, rimuovi il blocco strip:
const collectFn = intervalOverrides?.lightCollectors ? collectMetricsCritical : collectMetrics
const metrics = await Promise.race([
  collectFn(job.server),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('poll timeout')), POLL_TIMEOUT_MS)
  ),
])
// blocco strip rimosso — non più necessario
```

- [ ] **Step 5: Esegui tutti i test**

```bash
npm test
```
Expected: 169+ passed (aggiunto 1 nuovo test), zero failed.

- [ ] **Step 6: Verifica typecheck**

```bash
npm run typecheck
```
Expected: zero errori.

- [ ] **Step 7: Commit**

```bash
git add src/main/collectors/sqlCollector.ts src/main/collectors/sqlCollector.test.ts src/main/metricsWorker.ts
git commit -m "perf(worker): implement collectMetricsCritical — skip 3 expensive T-SQL queries for idle servers"
```

---

## Task 4 — findLastNBulk(): storico SQLite al boot in una sola query

**Problema:** `loadHistoryFromDb()` esegue una query SQLite separata per ogni server in un loop (riga 154). Con 200 server = 200 round-trip al DB. Una query con window function `ROW_NUMBER() OVER (PARTITION BY server_id ...)` recupera tutto in una passata.

**Files:**
- Modify: `src/main/store/metricsRepository.ts` — aggiunge `findLastNBulk()`
- Modify: `src/main/metricsWorker.ts` — `loadHistoryFromDb()` usa `findLastNBulk`
- Create: `src/main/store/__tests__/metricsRepository.bulk.test.ts`

- [ ] **Step 1: Crea il file di test**

Crea `src/main/store/__tests__/metricsRepository.bulk.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb } from '../database'
import { findLastN, findLastNBulk, batchSave } from '../metricsRepository'
import type { ServerMetrics } from '../../collectors/types'

function makeMetrics(version: string): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version,
      edition: 'Enterprise',
      memoryUsedMb: 1024,
      memoryTargetMb: 4096,
      cpuUsagePercent: 10,
      uptimeDays: 1,
      logicalCpus: 4,
      physicalCpus: 2,
    },
    databases: [],
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: [],
  }
}

describe('findLastNBulk', () => {
  beforeEach(() => {
    initDb(':memory:')
    batchSave([
      { serverId: 'srv-A', metrics: makeMetrics('SQL 2019 v1') },
      { serverId: 'srv-A', metrics: makeMetrics('SQL 2019 v2') },
      { serverId: 'srv-A', metrics: makeMetrics('SQL 2019 v3') },
      { serverId: 'srv-B', metrics: makeMetrics('SQL 2022 v1') },
      { serverId: 'srv-B', metrics: makeMetrics('SQL 2022 v2') },
    ])
  })

  afterEach(() => {
    // SQLite :memory: viene distrutto automaticamente — nessun cleanup necessario
  })

  it('restituisce gli stessi dati di N chiamate findLastN separate', () => {
    const bulk = findLastNBulk(['srv-A', 'srv-B'], 10)
    const singleA = findLastN('srv-A', 10)
    const singleB = findLastN('srv-B', 10)

    expect(bulk['srv-A']).toHaveLength(singleA.length)
    expect(bulk['srv-B']).toHaveLength(singleB.length)

    // Ordine: dal più vecchio al più recente (stesso di findLastN)
    expect(bulk['srv-A']?.[0].instanceInfo.version).toBe('SQL 2019 v1')
    expect(bulk['srv-A']?.[2].instanceInfo.version).toBe('SQL 2019 v3')
    expect(bulk['srv-B']?.[1].instanceInfo.version).toBe('SQL 2022 v2')
  })

  it('rispetta il limite N', () => {
    const bulk = findLastNBulk(['srv-A'], 2)
    // Con N=2 restituisce solo i 2 più recenti
    expect(bulk['srv-A']).toHaveLength(2)
    expect(bulk['srv-A']?.[0].instanceInfo.version).toBe('SQL 2019 v2')
    expect(bulk['srv-A']?.[1].instanceInfo.version).toBe('SQL 2019 v3')
  })

  it('restituisce oggetto vuoto per lista serverIds vuota', () => {
    expect(findLastNBulk([], 10)).toEqual({})
  })

  it('ignora server_id non presenti nel DB', () => {
    const bulk = findLastNBulk(['srv-A', 'srv-INESISTENTE'], 10)
    expect(bulk['srv-A']).toHaveLength(3)
    expect(bulk['srv-INESISTENTE']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Esegui il test — verifica che fallisca**

```bash
npm test -- --testPathPattern="metricsRepository.bulk"
```
Expected: FAIL — `findLastNBulk is not a function`

- [ ] **Step 3: Implementa findLastNBulk in metricsRepository.ts**

Aggiungi dopo `findLastN`:

```typescript
/**
 * Restituisce gli ultimi N snapshot per ciascun server nella lista, in un'unica query SQLite.
 * Usa ROW_NUMBER() OVER (PARTITION BY server_id) — richiede SQLite ≥ 3.25 (disponibile
 * con better-sqlite3 su Node 18+).
 * Più efficiente di N chiamate findLastN() separate su avvii con molti server.
 */
export function findLastNBulk(serverIds: string[], n: number): Record<string, ServerMetrics[]> {
  if (serverIds.length === 0) return {}
  const placeholders = serverIds.map(() => '?').join(',')
  const rows = getDb()
    .prepare<unknown[], SnapshotRow>(`
      SELECT id, server_id, collected_at, metrics_json
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY collected_at DESC) AS rn
        FROM metrics_snapshots
        WHERE server_id IN (${placeholders})
      )
      WHERE rn <= ?
      ORDER BY server_id, collected_at ASC
    `)
    .all([...serverIds, n])

  const result: Record<string, ServerMetrics[]> = {}
  for (const row of rows) {
    if (!result[row.server_id]) result[row.server_id] = []
    result[row.server_id].push(JSON.parse(row.metrics_json, dateReviver) as ServerMetrics)
  }
  return result
}
```

- [ ] **Step 4: Esegui il test — verifica che passi**

```bash
npm test -- --testPathPattern="metricsRepository.bulk"
```
Expected: PASS — tutti i test del file.

- [ ] **Step 5: Aggiorna loadHistoryFromDb in metricsWorker.ts**

```typescript
// PRIMA (righe 149-161):
for (const srv of servers) {
  const sid = serverId(srv.ip, srv.port)
  const record = serverStore.getByIpPort(srv.ip, srv.port)
  if (!record) continue
  try {
    const snapshots = metricsRepository.findLastN(record.id, MAX_HISTORY)
    if (snapshots.length > 0) {
      metricsHistory.set(sid, snapshots)
    }
  } catch (err) {
    console.warn('[worker] SQLite load history', sid, ':', err instanceof Error ? err.message : err)
  }
}

// DOPO — una sola query SQLite per tutti i server:
const recordIdToSid = new Map<string, string>()
for (const srv of servers) {
  const sid = serverId(srv.ip, srv.port)
  const record = serverStore.getByIpPort(srv.ip, srv.port)
  if (record) recordIdToSid.set(record.id, sid)
}

if (recordIdToSid.size > 0) {
  try {
    const allHistory = metricsRepository.findLastNBulk([...recordIdToSid.keys()], MAX_HISTORY)
    for (const [recordId, snapshots] of Object.entries(allHistory)) {
      const sid = recordIdToSid.get(recordId)
      if (sid && snapshots.length > 0) metricsHistory.set(sid, snapshots)
    }
  } catch (err) {
    console.warn('[worker] SQLite load history bulk:', err instanceof Error ? err.message : err)
  }
}
```

- [ ] **Step 6: Esegui tutti i test**

```bash
npm test
```
Expected: 170+ passed, zero failed.

- [ ] **Step 7: Verifica typecheck**

```bash
npm run typecheck
```
Expected: zero errori.

- [ ] **Step 8: Commit**

```bash
git add src/main/store/metricsRepository.ts src/main/store/__tests__/metricsRepository.bulk.test.ts src/main/metricsWorker.ts
git commit -m "perf(store): replace N findLastN() calls with single findLastNBulk() at boot"
```

---

## Verifica end-to-end

```bash
npm run typecheck   # zero errori
npm test            # tutti i test passano
```

**Test manuale (facoltativo con DevTools aperti):**
1. Aprire l'app con DevTools → React Profiler
2. Con 3+ server monitorati: cliccare tra server diversi → il Profiler mostra re-render **solo** nel Dashboard, non nella Sidebar né in altri componenti non pertinenti
3. Aprire Console → verificare assenza di `[Sidebar] render` log
4. In Settings → abilitare "Intervallo ridotto (background)" → verificare nei log `[collector]` che non compaiano più righe `top queries` o `wait stats` per i server idle
5. Riavviare l'app con 10+ server → log `[worker] SQLite load history bulk:` deve apparire una sola volta (non N volte)
