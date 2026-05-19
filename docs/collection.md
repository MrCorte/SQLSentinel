# SQLSentinel — Raccolta e caricamento dati

## Indice

1. [Architettura generale](#1-architettura-generale)
2. [Scoperta dei server](#2-scoperta-dei-server)
3. [Raccolta metriche SQL Server](#3-raccolta-metriche-sql-server)
4. [Worker di scheduling e polling](#4-worker-di-scheduling-e-polling)
5. [Arricchimento dati](#5-arricchimento-dati)
6. [Algoritmo delta vs full update](#6-algoritmo-delta-vs-full-update)
7. [Persistenza SQLite](#7-persistenza-sqlite)
8. [Canali IPC (Main → Renderer)](#8-canali-ipc-main--renderer)
9. [Boot sequence del renderer](#9-boot-sequence-del-renderer)
10. [Store Zustand — summaries vs metricsMap](#10-store-zustand--summaries-vs-metricsmap)
11. [Valutazione alert](#11-valutazione-alert)
12. [Mappa dei file chiave](#12-mappa-dei-file-chiave)

---

## 1. Architettura generale

SQLSentinel separa nettamente la logica di raccolta dati (processo **Main** di Electron) dalla visualizzazione (processo **Renderer** React). Nessun codice Node/SQL gira nel renderer.

```
┌─────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node + Electron)                                 │
│                                                                 │
│  ┌────────────────┐    ┌──────────────────┐   ┌─────────────┐  │
│  │  metricsWorker │───▶│  sqlCollector    │──▶│  SQL Server │  │
│  │  (scheduler)   │    │  (T-SQL queries) │   │  instances  │  │
│  └───────┬────────┘    └──────────────────┘   └─────────────┘  │
│          │                                                      │
│          │ delta/full metrics                                   │
│          ▼                                                      │
│  ┌────────────────┐    ┌──────────────────┐                    │
│  │  metricsRepo   │    │  alertEngine     │                    │
│  │  (SQLite)      │    │  (deduplicated)  │                    │
│  └────────────────┘    └──────────────────┘                    │
│          │                       │                             │
│          └──────────┬────────────┘                             │
│                     │ IPC (contextBridge)                      │
└─────────────────────┼───────────────────────────────────────────┘
                      │
┌─────────────────────┼───────────────────────────────────────────┐
│  RENDERER (React)   │                                           │
│                     ▼                                           │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  WorkerContext  →  metricsStore (Zustand)                  │ │
│  │  (boot seeding)     summaries | metricsMap | historyMap    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Identificatore server:** `${ip}:${port}` (es. `"192.168.1.10:1433"`) — chiave usata in tutte le Map interne del worker e come `serverId` nei payload IPC.

---

## 2. Scoperta dei server

**File:** `src/main/discovery/tcpScanner.ts` — `src/main/store/serverStore.ts`

### 2.1 Scan automatico

Il TCP scanner prova la porta 1433 (e porte custom) su ogni IP del CIDR specificato. PowerShell e SQL Server Browser UDP 1434 sono disabilitati — tutte le connessioni usano TCP diretto. Timeout per singola probe: 500ms.

```
scanSubnet(cidr, ports, { timeoutMs: 500, concurrency: N })
  └─ scanHost(ip, port, timeoutMs)  →  DiscoveredServer { reachable, responseTimeMs }
```

Lo scan trasmette il progresso via `SCAN_PROGRESS` IPC in tempo reale.

### 2.2 Aggiunta manuale

L'utente può inserire `host:port:instanceName` manualmente. Il formato `instanceName` è solo display — non viene passato al driver (le porte dinamiche non sono scopribili con Browser disabilitato).

### 2.3 Persistenza

Dopo la conferma, `serverStore.add()`:

- Genera un UUID come `id`
- Cifra la password con `safeStorage` (DPAPI su Windows, Keychain su macOS)
- Persiste in `electron-store` (JSON cifrato sul disco)
- Esegue `detectServerInfo()` → `SERVERPROPERTY('MachineName')` per popolare `machineName`

**Struttura `StoredServer` (campi rilevanti):**

| Campo                  | Tipo      | Note                                         |
| ---------------------- | --------- | -------------------------------------------- |
| `id`                   | `string`  | UUID v4                                      |
| `host`                 | `string`  | Indirizzo canonico                           |
| `port`                 | `number`  | Sempre esplicito                             |
| `useWindowsAuth`       | `boolean` | Windows Auth vs SQL Auth                     |
| `unreachable`          | `boolean` | Aggiornato dall'health check                 |
| `unreachableSince`     | `string`  | ISO 8601 prima irraggiungibilità             |
| `agGroupId` / `agRole` | `string`  | Rilevati da `agCollector` dopo il primo poll |

---

## 3. Raccolta metriche SQL Server

**File:** `src/main/collectors/sqlCollector.ts`

### 3.1 Due modalità di raccolta

| Funzione                   | Query eseguite   | Uso                                                                  |
| -------------------------- | ---------------- | -------------------------------------------------------------------- |
| `collectMetrics()`         | 8 query complete | Polling standard e background "full"                                 |
| `collectMetricsCritical()` | 5 query (subset) | Background mode "light" — salta topQueries, waitStats, databaseFiles |

La selezione avviene in `runJob` tramite `intervalOverrides?.lightCollectors`:

```typescript
const collectFn = intervalOverrides?.lightCollectors ? collectMetricsCritical : collectMetrics
const metrics = await Promise.race([collectFn(job.server), timeoutPromise])
```

### 3.2 Dati raccolti per istanza

**Instance info** (`sys.dm_os_sys_info`, `@@VERSION`, `sys.dm_os_process_memory`):

- Versione e edition SQL Server
- Memoria usata / target (MB)
- CPU% istantaneo
- Uptime in giorni
- Conteggio CPU logici e fisici

**Databases** (`sys.databases`):

- Nome, stato (`stateDesc`), recovery model
- Dimensioni MDF + LDF (MB)
- Compatibility level, TDE, read-only, owner, data di creazione

**Active sessions** (`sys.dm_exec_sessions` + `sys.dm_exec_requests`):

- Solo sessioni con `status != 'sleeping'` o `blockingSessionId > 0`
- Tipo di wait, tempo attesa, CPU time, logical reads

**Top queries** (`sys.dm_exec_query_stats` + `sys.dm_exec_sql_text`):

- Top 20 per elapsed time totale
- Execution count, avg CPU, avg logical reads

**Backup status** (`msdb.dbo.backupset`):

- Ultimo backup full/diff/log per ogni database

**Wait stats** (`sys.dm_os_wait_stats`):

- Top 20, filtrate per wait types idle non significativi

**Disk volumes** (`sys.dm_os_volume_stats`):

- Per ogni volume: totale GB, libero GB, percentuale libera

**Database files** (`sys.master_files` + `sys.dm_db_file_space_usage`):

- Dimensione, spazio usato, crescita automatica configurata

### 3.3 Gestione connessione

Il driver `mssql` (Tedious) apre una connessione TCP per ogni ciclo di raccolta. Non è mantenuto un connection pool permanente per evitare risorse orfane in caso di server non raggiungibile.

### 3.4 Timeout per job

Ogni chiamata a `collectMetrics` è avvolta in un `Promise.race` con un timeout fisso di **90 secondi** (`POLL_TIMEOUT_MS`). Se la raccolta supera questo limite, il job fallisce e scatta il backoff esponenziale come per qualsiasi altro errore.

---

## 4. Worker di scheduling e polling

**File:** `src/main/metricsWorker.ts`

### 4.1 Struttura `PollJob`

Per ogni server viene mantenuto un `PollJob`:

```typescript
interface PollJob {
  server: CollectMetricsRequest
  nextRun: number // timestamp (ms) prossima esecuzione
  priority: number // 0=active, 1=idle, 2=offline/failing
  lastFailed: boolean
  failCount: number // fallimenti consecutivi — guida il backoff esponenziale
  lastSuccess: number | null
  pollCount: number // poll riusciti — guida la scrittura su SQLite
}
```

### 4.2 Intervalli di polling

| Priorità      | Condizione                                | Intervallo default                                  |
| ------------- | ----------------------------------------- | --------------------------------------------------- |
| `0` — active  | Server attivo nell'UI (`setActiveServer`) | `activeIntervalMs` (default 60s)                    |
| `1` — idle    | Tutti gli altri server                    | 300s (`INTERVAL_IDLE_MS`)                           |
| `2` — offline | Dopo almeno 1 fallimento                  | 600s + backoff esponenziale (`INTERVAL_OFFLINE_MS`) |

**Clamping `intervalSeconds`:** il valore passato a `startWorker` viene forzato nell'intervallo [30s, 300s]:

```typescript
activeIntervalMs = Math.max(30_000, Math.min(300_000, req.intervalSeconds * 1000))
```

**Backoff esponenziale:** `min(INTERVAL_OFFLINE_MS × 2^(failCount-1), 3_600_000ms)` — sale da 600s a un massimo di 1 ora.

**Debounce su `setActiveServer`:** un ritardo di 300ms previene burst di fetch quando l'utente scorre rapidamente la lista server.

### 4.3 Loop di scheduling

```
scheduleTick()
  ├─ Filtra jobs con nextRun ≤ now
  ├─ Ordina per priority ASC, nextRun ASC
  ├─ Prende al massimo BATCH_SIZE=30 jobs
  ├─ Per ogni job: runJob(job) — incrementa running
  │    └─ .finally(() => { running--; scheduleTick() })
  └─ Schedula setTimeout al prossimo nextRun (minimo 1s)
```

### 4.4 `runJob` — flusso interno

```
runJob(job)
  1. collectMetrics(server) con timeout 90s (Promise.race)
  2. Merge custom fields (alias, referente) da dbCustomFields store
  3. Enrichment offline timestamps → offlineSince per DB non-ONLINE (§5)
  4. Aggiorna metricsHistory in-memory (rolling window, cap MAX_HISTORY=20)
  5. computeDelta(previous, fresh) → { delta, isDelta }
  6. Se finestra visibile: enqueueBatchPush(sid, delta)
  7. processAlerts(sid, fresh)
  8. Persistenza logicalCpus/physicalCpus su electron-store se cambiati
  9. detectAndSyncReplicaRoles() fire-and-forget (AG detection)
 10. Ogni SAVE_EVERY_N=5 poll riusciti: queueSave() per SQLite
 11. Reset circuit-breaker (failCount=0, aggiorna nextRun)

 In caso di errore:
  - failCount++, backoff esponenziale su nextRun
  - Dopo 50 fallimenti consecutivi: previousMetrics.delete(sid)
    (previene ~1 MB di memory leak per server offline a lungo)
```

**Nota:** `enqueueBatchPush` e `pushToRenderer(SERVER_HEALTH_UPDATE)` vengono saltati se nessuna finestra è visibile, ma `alertCallback` (usato da `BackgroundService`) viene sempre invocato.

### 4.5 Batch coalescing delle push IPC

Più job completano nella stessa microtask queue. Invece di inviare N IPC separati:

```typescript
function enqueueBatchPush(sid, metrics) {
  pendingBatch.push({ serverId: sid, metrics })
  if (!batchFlushScheduled) {
    batchFlushScheduled = true
    // Microtask: scatta dopo tutti i .finally() del ciclo corrente,
    // prima di qualsiasi setTimeout. Funziona trasparentemente con i fake timers di Vitest.
    Promise.resolve().then(flushMetricsBatch)
  }
}
```

Il renderer riceve un unico `METRICS_BATCH_UPDATED` con tutti gli aggiornamenti del ciclo.

### 4.6 Background mode e thundering herd

Quando `BackgroundService` attiva la modalità background, chiama `setIntervalOverrides(overrides)`. A questo punto i job vengono **staggerati** randomicamente su `[now, now + idleMs/2]` per evitare che tutti i server vengano pollati in simultanea dopo un lungo sleep:

```typescript
jobs.forEach((job) => {
  job.nextRun = Date.now() + Math.random() * (overrides.idleMs / 2)
})
```

---

## 5. Arricchimento dati

### 5.1 Custom fields (alias, referente)

Prima della push, per ogni database viene fatto un lookup in `dbCustomFields` store (SQLite) per aggiungere i campi `alias` e `referente` — informazioni inserite manualmente dall'utente. La chiave di lookup è `${serverId}/${dbName}`.

### 5.2 Offline timestamps (`dbOfflineTimestamps`)

Per ogni server viene mantenuta una `Map<dbName, ISO8601>` che registra **la prima volta** che un database viene rilevato in stato non-ONLINE (OFFLINE, RESTORING, RECOVERING, ecc.).

```
Per ogni database nel poll:
  se stateDesc !== 'ONLINE':
    se NON presente in offlineMap → offlineMap.set(dbName, collectedAt.toISOString())
    return { ...db, offlineSince: offlineMap.get(dbName) }
  se stateDesc === 'ONLINE':
    offlineMap.delete(dbName)   // torna online → rimuovi timestamp
    return db
```

**Proprietà `offlineSince`:** ISO 8601 del momento del _primo rilevamento_ dell'anomalia, non del momento effettivo di caduta (SQL Server non espone questa informazione).

La mappa viene pulita in:

- `syncServers()` — quando un server viene rimosso dalla lista
- `stopWorker()` → `__resetForTests()` — nei test

---

## 6. Algoritmo delta vs full update

**File:** `src/main/deltaUtils.ts`

Dopo ogni poll, `computeDelta()` confronta i database precedenti con quelli nuovi.

### 6.1 Cosa viene differenziato

Un database viene incluso nel payload delta se è **nuovo** (non presente nel poll precedente) oppure se è cambiato in almeno uno di questi **tre campi**:

```typescript
prevDb.sizeMb !== db.sizeMb ||
  prevDb.logSizeMb !== db.logSizeMb ||
  prevDb.stateDesc !== db.stateDesc
```

Campi come `compatibilityLevel`, `owner`, `isEncrypted`, `offlineSince` non scatenano un delta da soli — vengono inclusi solo se il DB è già nel payload per altri motivi.

Database rimossi dall'istanza finiscono in `removedDbs: string[]`.

### 6.2 Soglia di invio

```typescript
// changedCount = DB modificati + DB rimossi
// totalCount   = DB nel fresh snapshot + DB rimossi
shouldSendDelta(changedCount, totalCount):
  return changedCount <= 5                                    // DELTA_THRESHOLD_ABS
      || (totalCount > 0 && changedCount / totalCount <= 0.2) // DELTA_THRESHOLD_PERC
```

Se **entrambe** le soglie vengono superate (>5 DB cambiati AND >20% del totale), viene inviato il payload completo.

Al **primo poll** (nessun `previousMetrics`), viene sempre inviato il payload completo.

### 6.3 Payload delta

```typescript
{
  ...freshMetrics,
  isDelta: true,
  removedDbs: ['DroppedDb1'],
  databases: [/* solo i DB nuovi o modificati */]
  // ATTENZIONE: waitStats, topQueries, diskVolumes, databaseFiles
  // vengono comunque inclusi nel payload anche nei delta — sono campi istanza
}
```

Il renderer rileva il flag `isDelta` e fa merge invece di replace (§10.3).

---

## 7. Persistenza SQLite

**File:** `src/main/store/metricsRepository.ts` — `src/main/store/database.ts`

### 7.1 Schema

```sql
CREATE TABLE metrics_snapshots (
  id           TEXT PRIMARY KEY,           -- UUID v4
  server_id    TEXT NOT NULL,
  collected_at TEXT NOT NULL,              -- ISO 8601
  metrics_json TEXT NOT NULL               -- ServerMetrics serializzato
);

CREATE INDEX idx_snapshots_server_time ON metrics_snapshots(server_id, collected_at DESC);
CREATE INDEX idx_snapshots_time        ON metrics_snapshots(collected_at);
```

Il database è aperto in WAL mode per ridurre i lock durante le letture concorrenti.

### 7.2 Strategia di scrittura a due stadi

Le scritture seguono un meccanismo a due stadi per minimizzare l'I/O:

**Stadio 1 — trigger per poll:** ogni `SAVE_EVERY_N = 5` poll riusciti, `runJob` chiama `queueSave()` che aggiunge lo snapshot a `saveQueue` (array in-memory) e arma un timer:

```typescript
if (!saveFlushTimer) {
  saveFlushTimer = setTimeout(flushSaveQueue, SAVE_FLUSH_MS) // 300_000ms = 5min
}
```

**Stadio 2 — flush a tempo:** `flushSaveQueue()` esegue `batchSave(saveQueue)` in un'unica transazione SQLite e azzera la coda.

**Flush immediato allo shutdown:** `stopWorker()` cancella il timer e chiama `flushSaveQueue()` direttamente, garantendo che nessun dato venga perso alla chiusura dell'app.

Pulizia automatica: `cleanup(retentionMinutes)` cancella i record più vecchi del periodo configurato, chiamata all'avvio del worker.

### 7.3 Lettura al boot

```typescript
findLastNBulk(serverIds, (n = 20))
// Usa ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY collected_at DESC)
// Restituisce gli ultimi N snapshot per ogni server in una sola roundtrip SQLite
// Risultato ordinato ASC per server_id e collected_at
```

Il risultato popola `metricsHistory` (Map in-memory nel worker) prima che il renderer faccia la prima richiesta.

Le date nel JSON vengono deserializzate tramite un `dateReviver` che riconosce le stringhe ISO 8601 e le converte in `Date`.

---

## 8. Canali IPC (Main → Renderer)

**File:** `src/main/ipc/handlers.ts` — `src/main/ipc/types.ts`

### 8.1 Push events (main → renderer, subscribe)

| Canale                              | Payload                        | Quando                                     |
| ----------------------------------- | ------------------------------ | ------------------------------------------ |
| `METRICS_BATCH_UPDATED`             | `Array<{ serverId, metrics }>` | Dopo ogni ciclo di polling                 |
| `SERVER_HEALTH_UPDATE`              | `ServerHealthPayload`          | Ogni poll (successo o fallimento)          |
| `ALERT_NEW`                         | `Alert`                        | Primo rilevamento di un alert (post-dedup) |
| `SERVER_CONFIG_UPDATED`             | `StoredServer[]`               | AG role detection o cambio logicalCpus     |
| `SERVER_UNREACHABLE`                | `ServerUnreachableEvent`       | Health check fallito                       |
| `SERVER_RECOVERED`                  | `serverId`                     | Health check tornato positivo              |
| `APP_BACKGROUND` / `APP_FOREGROUND` | —                              | Finestra minimizzata/ripristinata          |

**Nota:** `METRICS_BATCH_UPDATED` e `SERVER_HEALTH_UPDATE` vengono soppressi se nessuna finestra è visibile (`BrowserWindow.getAllWindows().some(w => w.isVisible())`). `ALERT_NEW` viene sempre inviato poiché alimenta anche il `BackgroundService`.

### 8.2 Invoke channels (renderer → main, request/response)

| Canale                             | Descrizione                                                      |
| ---------------------------------- | ---------------------------------------------------------------- |
| `WORKER_START`                     | Avvia il worker con lista server e intervallo                    |
| `WORKER_STOP`                      | Ferma tutti i job                                                |
| `WORKER_SET_ACTIVE`                | Imposta il server attivo (priorità 0, fetch immediata debounced) |
| `WORKER_SYNC_SERVERS`              | UPSERT server list senza riavvio, preserva failCount/lastSuccess |
| `METRICS_HISTORY_BULK`             | Restituisce tutto lo storico SQLite al boot                      |
| `COLLECT_METRICS`                  | Raccolta one-shot manuale                                        |
| `GET_ALERTS` / `ACKNOWLEDGE_ALERT` | Gestione alert                                                   |
| `GET_SETTINGS` / `SAVE_SETTINGS`   | Impostazioni app                                                 |

---

## 9. Boot sequence del renderer

**File:** `src/renderer/src/App.tsx` — `src/renderer/src/context/WorkerContext.tsx`

```
1. App.tsx monta
   │
2. loadServers()  →  IPC servers.getAll()  →  electron-store
   │                 Popola serversStore Zustand
   │
3. workerStart({ servers, intervalSeconds: 60 })
   │  ├─ Main: startWorker() crea PollJob per ogni server
   │  ├─ Main: cleanup() SQLite (retention)
   │  ├─ Main: findLastNBulk() → popola metricsHistory in-memory
   │  └─ Main: scheduleTick() avvia il loop di polling
   │
4. getHistoryBulk()  →  IPC  →  worker.getHistoryAll()
   │  Ritorna Record<"ip:port", ServerMetrics[]>
   │  (gli stessi snapshot caricati da SQLite al passo 3)
   │
5. seedFromHistory(allHistory) in WorkerContext
   │  Per ogni server con storico:
   │  ├─ metricsStore.metricsMap[sid]   ←  snapshot più recente
   │  ├─ metricsStore.summaries[sid]    ←  buildSummary(latest)
   │  └─ metricsStore.historyMap[sid]   ←  ring buffer { cpu[], memory[] }
   │       cap = MAX_HISTORY_ACTIVE(60) se active, MAX_HISTORY_IDLE(10) altrimenti
   │
6. IPC listeners registrati:
   ├─ METRICS_BATCH_UPDATED  →  applyDeltaBatch()
   ├─ SERVER_HEALTH_UPDATE   →  setServerHealth()
   ├─ ALERT_NEW              →  addAlert()
   ├─ SERVER_CONFIG_UPDATED  →  updateServer()
   ├─ SERVER_UNREACHABLE     →  updateServer({ unreachable: true })
   └─ SERVER_RECOVERED       →  updateServer({ unreachable: false })
   │
7. Primo poll arriva via METRICS_BATCH_UPDATED
   └─ applyDeltaBatch() → aggiorna metricsMap, summaries, historyMap
```

---

## 10. Store Zustand — summaries vs metricsMap

**File:** `src/renderer/src/store/metricsStore.ts`

### 10.1 Due livelli di dati

| Store            | Contenuto                     | Dimensione        | Quando popolato                                             |
| ---------------- | ----------------------------- | ----------------- | ----------------------------------------------------------- |
| **`summaries`**  | KPI leggeri per server        | ~200 byte/server  | Boot se ha storico, altrimenti al primo poll                |
| **`metricsMap`** | `ServerMetrics` completo      | ~50–100 KB/server | Boot (tutti i server con storico) + aggiornato ad ogni poll |
| **`historyMap`** | Ring buffer `{ cpu, memory }` | ~1 KB/server      | Boot da storico + ogni poll                                 |

`metricsMap` viene evicto con `evictFullMetrics(serverId)` quando l'utente naviga via dal dettaglio server, per liberare memoria nel renderer.

### 10.2 `ServerSummary` — struttura

```typescript
interface ServerSummary {
  cpuUsagePercent: number
  memoryUsedMb: number
  memoryTargetMb: number
  uptimeDays: number
  collectedAt: Date
  dbCount: number // numero totale di database (tutti gli stati)
  offlineDbCount: number // database con stateDesc !== 'ONLINE'
}
```

### 10.3 Ring buffer `historyMap`

Ogni server ha due ring buffer separati, aggiornati ad ogni poll:

```typescript
interface ServerHistory {
  cpu: HistoryPoint[] // { ts: number, value: cpuUsagePercent }
  memory: HistoryPoint[] // { ts: number, value: memPercent }
}
```

Capacità: `MAX_HISTORY_ACTIVE = 60` punti per il server attivo, `MAX_HISTORY_IDLE = 10` per tutti gli altri.

### 10.4 Merge delta nel renderer

```typescript
applyDelta(serverId, delta):
  if (!delta.isDelta):
    // Full replace — aggiorna metricsMap, summaries e historyMap
    metricsMap[serverId] = delta
    summaries[serverId]  = buildSummary(delta)
    // aggiunge punto a historyMap.cpu e historyMap.memory
    return

  existing = metricsMap[serverId]
  if (!existing):
    // Nessuno stato precedente (es. dopo evict) → usa il delta as-is
    metricsMap[serverId] = delta
    summaries[serverId]  = buildSummary(delta)
    return

  // 1. Rimuovi DB dropped
  if (delta.removedDbs?.length):
    existing.databases = existing.databases.filter(d => !removedSet.has(d.name))

  // 2. Aggiorna / aggiungi DB modificati (match per nome)
  delta.databases.forEach(db => mergeByName(existing.databases, db))

  // 3. Campi istanza — sempre sostituiti anche nel delta
  Object.assign(existing.instanceInfo, delta.instanceInfo)
  existing.activeSessions = delta.activeSessions
  existing.backupStatus   = delta.backupStatus
  existing.collectedAt    = delta.collectedAt

  // 4. waitStats, topQueries, diskVolumes, databaseFiles NON vengono aggiornati
  //    nel delta: restano i valori del poll completo precedente

  // 5. Pulizia flag transitori
  delete existing.isDelta
  delete existing.removedDbs

  summaries[serverId] = buildSummary(existing)
  // aggiunge punto a historyMap
```

---

## 11. Valutazione alert

**File:** `src/main/metricsWorker.ts` — funzione `evaluateAlerts` + `processAlerts`

Alert generati automaticamente dopo ogni poll su dati **non arricchiti** (metriche raw, prima dell'enrichment offline timestamp):

| Categoria           | Soglia WARNING                           | Soglia CRITICAL                                                     |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `cpu_high`          | >70%                                     | >90%                                                                |
| `blocking_sessions` | ≥1 sessione bloccante                    | ≥5 sessioni                                                         |
| `database_offline`  | —                                        | `stateDesc === 'OFFLINE'` (solo questo stato, non altri non-ONLINE) |
| `backup_overdue`    | Full backup assente o >24h (DB utente)   | —                                                                   |
| `disk_space_low`    | Volume <30% libero                       | Volume <10% libero                                                  |
| `disk_space_low`    | Autogrowth=0 con <100 MB liberi nel file | —                                                                   |

**DB di sistema esclusi dal backup check:** `master`, `tempdb`, `model`, `msdb`, `distribution`.

**Deduplicazione:** chiave `${serverId}:${category}:${severity}`. Un alert già aperto (non acknowledged) non genera un secondo push. Gli alert acknowledged da più di 24h vengono rimossi automaticamente da `storedAlerts`.

**Notifiche:**

- Email: per tutti i nuovi alert (dedup 15 minuti per indirizzo, se email configurata)
- Toast / tray icon: solo CRITICAL, solo quando la finestra è in background

---

## 12. Mappa dei file chiave

| File                                         | Responsabilità                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `src/main/metricsWorker.ts`                  | Scheduler, PollJob, backoff, enrichment, delta, alert, batch IPC         |
| `src/main/collectors/sqlCollector.ts`        | Query T-SQL, parsing risultati, timeout connessione                      |
| `src/main/collectors/agCollector.ts`         | Rilevamento e sync ruoli Availability Group                              |
| `src/main/deltaUtils.ts`                     | `shouldSendDelta()` — soglie DELTA_THRESHOLD_ABS/PERC                    |
| `src/main/ipc/handlers.ts`                   | Handler IPC, validazione parametri, routing verso worker/store           |
| `src/main/ipc/types.ts`                      | Nomi canali, interfacce request/response, tipi Alert                     |
| `src/main/store/metricsRepository.ts`        | CRUD SQLite snapshot, `findLastNBulk`, `batchSave`, `dateReviver`        |
| `src/main/store/serverStore.ts`              | electron-store con password cifrate via `safeStorage`                    |
| `src/main/store/database.ts`                 | Inizializzazione SQLite, DDL, WAL mode                                   |
| `src/main/store/dbCustomFields.ts`           | Alias e referente per database (SQLite)                                  |
| `src/main/backgroundService.ts`              | Polling background, tray icon, notifiche, `setIntervalOverrides`         |
| `src/main/discovery/tcpScanner.ts`           | TCP scan CIDR, singola probe 500ms, progress streaming                   |
| `src/renderer/src/store/metricsStore.ts`     | Zustand — due livelli dati, ring buffer, `applyDelta`, `seedFromHistory` |
| `src/renderer/src/store/serversStore.ts`     | Zustand — CRUD server lato renderer                                      |
| `src/renderer/src/context/WorkerContext.tsx` | Boot seeding, wiring IPC listeners                                       |
| `src/renderer/src/App.tsx`                   | Inizializzazione app, sequenza boot, setup listeners                     |
| `src/renderer/src/hooks/useNow.ts`           | Ticker 30s per label "X min fa" nei component                            |
| `src/preload/index.ts`                       | Bridge IPC, esposizione `window.sqlSentinel` via contextBridge           |
| `src/preload/index.d.ts`                     | Dichiarazioni TypeScript condivise renderer/preload                      |
