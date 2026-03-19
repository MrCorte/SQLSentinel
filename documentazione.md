# SQLSentinel — Documentazione Modifiche

## FASE 1 — Modulo Discovery (2026-03-16)

### File creati

#### `src/main/discovery/types.ts`
Definizioni TypeScript per il modulo discovery:
- `DiscoveredServer` — risultato di una singola probe TCP (ip, port, reachable, responseTimeMs, discoveredAt)
- `ScanOptions` — parametri di input per `scanSubnet` (cidr, ports, timeoutMs, concurrency)
- `ScanProgress` — stato avanzamento scan per la UI (total, completed, found)

#### `src/main/discovery/cidrUtils.ts`
Utility per espansione CIDR:
- `expandCidr(cidr)` — converte notazione CIDR (es. `192.168.1.0/24`) in array di tutti gli IP del range, inclusi indirizzo di rete e broadcast. Usa operatori bitwise su interi unsigned a 32 bit. Lancia errore su CIDR malformato.

#### `src/main/discovery/tcpScanner.ts`
Scanner TCP asincrono:
- `scanHost(ip, port, timeoutMs)` — singola probe TCP via `net.Socket`. Non lancia mai eccezioni: restituisce sempre un `DiscoveredServer`. Il flag `settled` garantisce che `cleanup()` venga eseguita una sola volta anche se più eventi (error + timeout) si sovrappongono.
- `scanSubnet(options, onProgress?)` — scansiona tutte le combinazioni ip×porta del CIDR fornito. Usa un worker pool (pattern indice condiviso) per limitare la concorrenza a `options.concurrency` probe simultanee (default consigliato: 50). Restituisce solo i server raggiungibili. Chiama `onProgress` dopo ogni probe per aggiornare la UI.

Vincoli rispettati:
- Solo `net.Socket` TCP — no PowerShell, no UDP, no SQL Server Browser
- Timeout esplicito su ogni socket via `socket.setTimeout()`
- Cleanup socket esplicita via `socket.destroy()` al termine

#### `src/main/discovery/tcpScanner.test.ts`
Test Vitest con mock di `net.Socket` (nessuna connessione reale):
- Host raggiungibile → evento `connect` → `reachable: true`
- Host non raggiungibile → evento `error` → `reachable: false`
- Timeout → evento `timeout` → `reachable: false`
- Double-fire (error + timeout) → `destroy` chiamata una sola volta
- Verifica che `setTimeout` riceva il valore `timeoutMs` corretto

#### `vitest.config.ts`
Configurazione Vitest per i test del main process:
- `environment: 'node'` (richiesto per moduli Node.js come `net`)
- `include: ['src/main/**/*.test.ts']`

### Modifiche a file esistenti

#### `package.json`
Aggiunti script:
- `"test": "vitest run"` — esecuzione singola (CI)
- `"test:watch": "vitest"` — modalità watch per sviluppo

### Comandi test
```bash
npm run test          # esecuzione singola
npm run test:watch    # watch mode
```

---

## FASE 2 — Modulo IPC (2026-03-16)

### File creati

#### `src/main/ipc/types.ts`
Definizioni dei canali IPC e tipi request/response:
- `IpcChannel` (enum) — nomi canali come stringhe tipizzate. Usato `enum` invece di `const enum` per evitare problemi di inlining cross-file con esbuild/electron-vite.
- `IpcResult<T>` — envelope unificato `{ ok: true; data: T } | { ok: false; error: string }`. Garantisce che il renderer non riceva mai stack trace raw.
- Tipi request: `ManualServerRequest`, `RemoveServerRequest`
- Tipi response: alias `ScanSubnetResponse`, `AddServerManualResponse`, `GetServersResponse`, `RemoveServerResponse`

#### `src/main/ipc/handlers.ts`
Registrazione handler `ipcMain.handle()` per tutti i canali:
- `SCAN_SUBNET` — chiama `scanSubnet()`, invia progress via `event.sender.send(SCAN_PROGRESS, ...)`, restituisce solo i server reachable.
- `ADD_SERVER_MANUAL` — esegue `scanHost()` (timeout 2s) per popolare `reachable`/`responseTimeMs`, poi persiste il server.
- `GET_SERVERS` — restituisce copia dello store in-memory.
- `REMOVE_SERVER` — filtra lo store per chiave `ip:port`.
- Store in-memory temporaneo (array `knownServers`) — verrà sostituito da SQLite in FASE 4.
- Errori loggati via `console.error` con solo `err.message`, mai stack trace al renderer.

### File modificati

#### `src/preload/index.ts`
Espone oggetto `sqlSentinel` tipizzato via `contextBridge.exposeInMainWorld('sqlSentinel', ...)`:
- `scanSubnet(options)` → `ipcRenderer.invoke(SCAN_SUBNET)`
- `onScanProgress(callback)` → `ipcRenderer.on(SCAN_PROGRESS, ...)`, ritorna cleanup `() => void`
- `addServerManual(req)` → `ipcRenderer.invoke(ADD_SERVER_MANUAL)`
- `getServers()` → `ipcRenderer.invoke(GET_SERVERS)`
- `removeServer(req)` → `ipcRenderer.invoke(REMOVE_SERVER)`

#### `src/preload/index.d.ts`
Aggiunta dichiarazione `window.sqlSentinel: SqlSentinelAPI`. Tipi ridichiarati inline (non importati da `src/main/`) perché questo file è compilato con `tsconfig.web.json` che non include il main process. I tipi exportati (`DiscoveredServer`, `ScanOptions`, `ScanProgress`, ecc.) sono importabili dal renderer via path relativo.

#### `src/main/index.ts`
Aggiunto import e chiamata `registerIpcHandlers()` nella callback `app.whenReady()`.

### File creati (renderer)

#### `src/renderer/src/hooks/useDiscovery.ts`
Hook React per la pagina Discovery:
- Stato: `servers: DiscoveredServer[]`, `isScanning: boolean`, `progress: ScanProgress | null`, `error: string | null`
- `scan(options)` — chiama `window.sqlSentinel.scanSubnet()`, sottoscrive progress events, gestisce cleanup del listener nel `finally`.
- Importa i tipi da `src/preload/index.d.ts` (path relativo `../../../preload/index`) — funziona perché `tsconfig.web.json` include `src/preload/*.d.ts`.

---

## FASE 3 — Modulo Collectors (2026-03-16)

### File creati

#### `src/main/collectors/types.ts`
Tipi per le metriche SQL Server:
- `ServerConnection` — credenziali e coordinate di connessione. `instanceName` è solo per display: non viene passato al driver perché SQL Browser è disabilitato e la porta è sempre esplicita.
- `InstanceInfo` — versione, edizione, RAM usata, CPU%, uptime
- `DatabaseInfo` — nome, stato, recovery model, dimensioni data/log
- `SessionInfo` — sessioni attive con blocking, wait type, CPU, logical reads
- `QueryInfo` — top query per elapsed time (testo, execution count, medie CPU/IO)
- `BackupInfo` — ultimo backup Full/Diff/Log per database
- `ServerMetrics` — aggregato di tutti i tipi sopra con timestamp

#### `src/main/collectors/sqlCollector.ts`
Collector principale:
- `buildConfig(conn)` — costruisce `mssql.config`. `connectTimeout` in `options` (via IOptions), `requestTimeout` direttamente su config. `instanceName` NON passato al driver.
- Auth: `type: 'ntlm'` (Windows Auth) oppure `type: 'default'` (SQL Auth), come richiede l'interfaccia `tds.ConnectionAuthentication`.
- `collectMetrics(connection)` — apre un pool, esegue 5 query in `Promise.all()`, ogni query con `.catch()` indipendente → una query fallita non blocca le altre. Pool sempre chiuso nel `finally`.
- Errori loggati con solo `err.message`, mai stack trace o credenziali.

**Query T-SQL implementate (alias snake_case, commenti in italiano):**
- `queryInstanceInfo` — `sys.dm_os_process_memory` CROSS JOIN `sys.dm_os_sys_info` + subquery su `sys.dm_os_ring_buffers` per CPU%
- `queryDatabases` — `sys.databases` INNER JOIN `sys.master_files` GROUP BY, DECIMAL(18,2) per le dimensioni
- `querySessions` — `sys.dm_exec_requests WHERE session_id > 50`
- `queryTopQueries` — `sys.dm_exec_query_stats` CROSS APPLY `sys.dm_exec_sql_text`, TOP 20 per elapsed time totale
- `queryBackupStatus` — `msdb.dbo.backupset` GROUP BY database_name, type='D'/'I'/'L', ultimi 7 giorni

#### `src/main/collectors/sqlCollector.test.ts`
4 test con mock di `mssql` via factory `vi.mock('mssql', () => ({ connect: vi.fn() }))`:
- Connessione riuscita → verifica mapping completo di tutti i campi
- Connessione fallita → `rejects.toThrow('Login failed')`
- Timeout → `rejects.toThrow('Connection timeout')`
- Query parziale fallita (backup negato su msdb) → `backupStatus: []`, le altre query OK, `close()` sempre chiamato

---

## FASE 4 — Modulo Store (2026-03-16)

### File creati

#### `src/main/store/types.ts`
- `StoredServer` — record persistito su SQLite. `encryptedPassword` marcato con commento "mai loggare".
- `MetricsSnapshot` — snapshot grezzo con `metricsJson: string` (ServerMetrics serializzato).

#### `src/main/store/database.ts`
- Pattern `initDb(path) / getDb() / closeDb()` — il path viene passato dall'esterno (main process usa `app.getPath('appData')`, test usa `':memory:'`). Nessuna dipendenza da Electron in questo modulo.
- `defaultDbPath(appDataPath)` — helper per costruire il path in produzione (`%APPDATA%/sqlsentinel/data.db`).
- Schema DDL: tabella `servers` con UNIQUE su `(ip, port)`, tabella `metrics_snapshots` con FK CASCADE, indici su `server_id` e `collected_at`.
- WAL mode e `foreign_keys = ON` impostati via `PRAGMA`.

#### `src/main/store/serverRepository.ts`
- `upsert(server)` — `INSERT ... ON CONFLICT(ip, port) DO UPDATE SET ...`. Non aggiorna `id` né `added_at` su conflitto. Restituisce il record effettivo (risolve l'id pre-esistente).
- `findAll()`, `findById(id)`, `remove(id)`, `updateLastSeen(id, date)`, `updateLastMetrics(id, date)`.
- Mapping `ServerRow` → `StoredServer`: INTEGER → boolean per `use_windows_auth`, TEXT ISO 8601 → Date per i campi data.

#### `src/main/store/metricsRepository.ts`
- `save(serverId, metrics)` — `JSON.stringify(metrics)` + UUID generato con `randomUUID()`.
- `findLatest(serverId)` — `ORDER BY collected_at DESC LIMIT 1`, deserializza con reviver per ripristinare le `Date` da stringhe ISO 8601.
- `findHistory(serverId, limitDays)` — usa `datetime('now', '-N days')` di SQLite.
- `cleanup(retentionDays)` — `DELETE WHERE collected_at < datetime('now', '-N days')`.

#### `src/main/store/store.test.ts`
- `initDb(':memory:')` in `beforeEach`, `closeDb()` in `afterEach` — ogni test parte da schema vuoto.
- **serverRepository**: insert, upsert (no duplicati per ip:port), findById, remove, updateLastSeen, conversione boolean/Date.
- **metricsRepository**: save+findLatest, deserializzazione Date, snapshot più recente su più record, findHistory, cleanup (verifica eliminazione vecchi + conservazione recenti).

---

## FASE 5 — Pagina Discovery UI (2026-03-16)

### File creati

#### `src/renderer/src/components/ServerStatusChip.tsx`
Chip MUI riutilizzabile. Props: `reachable: boolean | null`, `responseTimeMs?: number`. Tre stati: verde "Raggiungibile Xms" / rosso "Non raggiungibile" / grigio "Sconosciuto" (null).

#### `src/renderer/src/components/AddServerDialog.tsx`
Dialog MUI con form completo: IP/Hostname (obbligatorio), Porta (1-65535, default 1433), Nome Istanza (opzionale), toggle Windows Auth / SQL Auth, campi Username+Password se SQL Auth. Validazione inline con `helperText`. `useEffect` per pre-compilare ip/porta quando aperto da una riga della tabella.

#### `src/renderer/src/pages/Discovery.tsx`
Pagina principale con:
- Alert warning per named instances dinamiche
- Form scan: CIDR, porte (comma-separated, parse + validazione formato CIDR), concorrenza (1-200)
- LinearProgress `determinate` durante scan con label "X/Y host scansionati, Z trovati"
- DataGrid con 6 colonne: IP, Porta, Stato (ServerStatusChip), Risposta ms, Tipo discovery (chip), Azioni ("+ Monitora")
- `getRowId={(row) => \`${row.ip}:${row.port}\`` — nessun campo `id` necessario sui dati
- AddServerDialog aperto sia da "Aggiungi Manualmente" (form vuoto) sia da riga (pre-compilato)

### File modificati

#### `src/renderer/src/hooks/useDiscovery.ts`
- Aggiunto tipo `DiscoveryRow` (estende `DiscoveredServer` con `discoveryType: 'auto-tcp' | 'manual'`)
- Aggiunto tipo `AddServerParams` (include credenziali per uso futuro in FASE 6)
- `scan` ora produce `DiscoveryRow[]` preservando i server manuali pre-esistenti su conflitto ip:porta
- Aggiunta funzione `addServer(params)` che chiama `window.sqlSentinel.addServerManual` e aggiorna la lista

#### `src/renderer/src/App.tsx`
Sostituito il template demo Electron con `<Discovery />`. Nessun router — pagina singola per FASE 5/6.

---

## FASE 6 — Dashboard Monitoraggio (2026-03-16)

### File creati

#### `src/renderer/src/hooks/useMetrics.ts`
Hook per raccolta e history metriche:
- `useMetrics(connection)` — prende `CollectMetricsRequest | null` come input.
- Stato: `metrics: ServerMetrics | null`, `isLoading`, `error`, `history: MetricsHistoryPoint[]`, `autoRefreshSeconds`, `setAutoRefreshSeconds`.
- `refresh()` — chiama `window.sqlSentinel.collectMetrics()`, appende un punto alla history (max 60 punti).
- Auto-refresh tramite `setInterval` con cleanup `useEffect`; si resetta quando cambia il server selezionato (`ip:port`).
- `MetricsHistoryPoint`: `{ timestamp, memoryUsedMb, cpuUsagePercent }` per i grafici.

#### `src/renderer/src/components/MemoryChart.tsx`
Grafico recharts con doppio asse Y: Memoria (MB) a sinistra, CPU (%) a destra. `isAnimationActive: false` per performance con aggiornamenti frequenti.

#### `src/renderer/src/components/MetricsPanel.tsx`
5 tab MUI per visualizzare tutte le metriche:
- **Panoramica**: InfoCard per versione, edizione, memoria, CPU, uptime + `MemoryChart` (visibile con ≥2 campioni).
- **Database**: DataGrid con nome, stato, recovery model, dimensioni data/log.
- **Sessioni**: DataGrid con `blockingSessionId` evidenziato in rosso (MUI Chip error) se > 0.
- **Backup**: DataGrid con celle colorate in rosso se backup > 24h fa o `null`.
- **Top Query**: DataGrid con testo query in monospace, `_idx` come row ID sintetico (QueryInfo non ha chiave naturale).

#### `src/renderer/src/pages/Dashboard.tsx`
Pagina principale con layout sidebar + area destra:
- Sidebar sinistra (220px): lista server da `getServers()`, selezione attiva, `ServerStatusChip` per ogni entry.
- Area destra: toolbar con label server, Select auto-refresh (30s/60s/2min/5min/disabilitato), pulsante "Aggiorna metriche" con CircularProgress.
- Windows Auth di default per la raccolta metriche (credenziali estese previste in FASE futura).
- Messaggi informativi per stato vuoto / nessun server selezionato.

### File modificati

#### `src/main/ipc/types.ts`
- Aggiunto `COLLECT_METRICS = 'metrics:collect'` a `IpcChannel`.
- Aggiunto `CollectMetricsRequest` (credenziali complete per la connessione).
- Aggiunto `CollectMetricsResponse = IpcResult<ServerMetrics>`.
- Re-export `ServerMetrics` da `../collectors/types`.

#### `src/main/ipc/handlers.ts`
- Import `collectMetrics` da `../collectors/sqlCollector`.
- Aggiunto handler `COLLECT_METRICS`: chiama `collectMetrics()` con i parametri della richiesta, restituisce `IpcResult<ServerMetrics>`. Errore loggato solo con `err.message`.

#### `src/preload/index.ts`
- Aggiunto `collectMetrics` all'oggetto `sqlSentinel` esposto via contextBridge.
- Re-export `CollectMetricsRequest`, `ServerMetrics`, `InstanceInfo`, `DatabaseInfo`, `SessionInfo`, `QueryInfo`, `BackupInfo`.

#### `src/preload/index.d.ts`
- Dichiarazioni inline per `CollectMetricsRequest`, `InstanceInfo`, `DatabaseInfo`, `SessionInfo`, `QueryInfo`, `BackupInfo`, `ServerMetrics`.
- Aggiunto `collectMetrics(req: CollectMetricsRequest): Promise<IpcResult<ServerMetrics>>` a `SqlSentinelAPI`.

#### `src/renderer/src/App.tsx`
Sostituito `<Discovery />` diretto con navigazione a 2 tab MUI: "Discovery" e "Dashboard". La Discovery usa `overflow: auto`, la Dashboard usa `overflow: hidden` (layout interno gestisce lo scroll).

---

## 2026-03-17 — MetricsWorker, Sistema di Alert, Badge notifiche

### Nuovi file

#### `src/main/metricsWorker.ts`
Worker che gira nel main process (Electron) con `setInterval`. Responsabilità:
- Raccolta periodica metriche per tutti i server configurati (via `collectMetrics`).
- History per server con rolling buffer di 20 snapshot (`Map<serverId, ServerMetrics[]>`).
- Push al renderer via `BrowserWindow.getAllWindows()[0].webContents.send()`:
  - `IpcChannel.METRICS_UPDATED` — `{ serverId, metrics }` ad ogni raccolta riuscita.
  - `IpcChannel.ALERT_NEW` — `Alert` quando un nuovo alert viene generato.
- Motore di alerting con soglie:
  - **CPU > 90%** → CRITICAL | **> 70%** → WARNING (categoria `cpu_high`)
  - **Sessioni bloccate ≥ 5** → CRITICAL | **≥ 1** → WARNING (categoria `blocking_sessions`)
  - **Database OFFLINE** → CRITICAL (categoria `database_offline`)
  - **Backup full assente o > 24h** → WARNING (categoria `backup_overdue`)
- Deduplicazione alert: non genera un nuovo alert se esiste già uno aperto (non riconosciuto) con lo stesso `serverId:category:severity`.
- API pubblica: `startWorker(req)`, `stopWorker()`, `getAlerts()`, `acknowledgeAlert(id)`, `getHistory(ip, port)`.
- Intervallo min 30s, max 300s.

#### `src/renderer/src/components/AlertsDrawer.tsx`
Drawer MUI ancorato a destra (larghezza 400px) con lista alert. Features:
- Alert aperti mostrati prima (CRITICAL sopra WARNING, via sort).
- Alert riconosciuti in sezione separata con opacità ridotta.
- Pulsante "Ack" per ciascun alert aperto → chiama `acknowledgeAlert`.
- Icona colored per severità (ErrorOutlineIcon / WarningAmberIcon).
- Chip categoria + serverId + messaggio + timestamp.

### File modificati

#### `src/main/ipc/types.ts`
Aggiunti canali IPC:
- `METRICS_UPDATED`, `ALERT_NEW` (push-only main → renderer)
- `WORKER_START`, `WORKER_STOP`, `ALERTS_GET_ALL`, `ALERTS_ACKNOWLEDGE`

Aggiunti tipi: `AlertCategory`, `AlertSeverity`, `Alert`, `WorkerStartRequest`, `AcknowledgeAlertRequest`.

#### `src/main/ipc/handlers.ts`
Registrati 4 nuovi handler: `WORKER_START`, `WORKER_STOP`, `ALERTS_GET_ALL`, `ALERTS_ACKNOWLEDGE`.

#### `src/preload/index.d.ts`
Aggiunti: `Alert`, `WorkerStartRequest`, `AcknowledgeAlertRequest`.
`SqlSentinelAPI` estesa con: `workerStart`, `workerStop`, `getAlerts`, `acknowledgeAlert`, `onMetricsUpdated`, `onAlertNew`.

#### `src/preload/index.ts`
Implementazioni reali (IPC) e mock per i 6 nuovi metodi API. Mock `getAlerts()` restituisce 3 alert pre-impostati (CRITICAL + 2 WARNING). Mock `onMetricsUpdated` e `onAlertNew` restituiscono no-op unsubscribe.

#### `src/renderer/src/hooks/useMetrics.ts`
- Rimosso `autoRefreshSeconds`/`setAutoRefreshSeconds` e relativo `setInterval` interno (ora gestito dal worker nel main process).
- Aggiunto `pushMetrics(m: ServerMetrics)` per iniettare metriche arrivate via push dal worker.
- Refactored history update in `addHistoryPoint` helper condiviso da `refresh` e `pushMetrics`.

#### `src/renderer/src/pages/Dashboard.tsx`
- `autoRefreshSeconds` ora è stato locale del componente.
- `useEffect` che chiama `workerStart`/`workerStop` al variare di `autoRefreshSeconds` o server selezionato.
- `useEffect` che si sottoscrive a `onMetricsUpdated` e filtra per `serverId` corrente → chiama `pushMetrics`.
- Rimosso import `autoRefreshSeconds` e `setAutoRefreshSeconds` da `useMetrics`.

#### `src/renderer/src/App.tsx`
- Stato `alerts: Alert[]` caricato all'avvio da `getAlerts()`.
- Sottoscrizione a `onAlertNew` per aggiungere alert in tempo reale.
- `handleAcknowledge(alertId)` chiama `acknowledgeAlert` e aggiorna stato locale.
- `IconButton` con `Badge` MUI nella tab bar: mostra conteggio alert CRITICAL non riconosciuti, colore `error`.
- Click sul badge apre `AlertsDrawer`.

---

## FASE 5 — Persistenza server + alert irraggiungibilità (2026-03-17)

### File creati

#### `src/main/store/serverStore.ts`
Store persistente per i server monitorati tramite `electron-store@8` (JSON su disco).
- `StoredServer` — tipo principale con: `id` (UUID), `ip`, `port`, `instanceName?`, `useWindowsAuth`, `username?`, `password?`, `addedAt` (ISO 8601), `lastSeen?`, `unreachable?`, `unreachableSince?`.
- API pubblica: `getAll()`, `getById(id)`, `getByIpPort(ip, port)`, `add(params)`, `update(id, patch)`, `remove(id)`, `upsertByIpPort(params)`.
- Il file JSON viene salvato come `sql-sentinel-data.json` nella directory dati dell'app Electron.
- `add()` impedisce duplicati per ip:porta.
- `upsertByIpPort()` usato dal flusso `ADD_SERVER_MANUAL`: inserisce o aggiorna senza duplicati.

#### `src/renderer/src/store/serversStore.ts`
Zustand store lato renderer (no persist middleware — electron-store è source of truth).
- `servers: StoredServer[]` — lista in memoria, inizializzata da `loadServers()`.
- `addServer`, `removeServer`, `updateServer` — chiamano IPC e aggiornano lo stato locale.
- `initialized: boolean` — indica se `loadServers()` ha completato.

### File modificati

#### `src/main/ipc/types.ts`
Aggiunti canali IPC al enum `IpcChannel`:
- `SERVERS_GET_ALL`, `SERVERS_ADD`, `SERVERS_UPDATE`, `SERVERS_REMOVE_BY_ID`
- `SERVER_UNREACHABLE`, `SERVER_RECOVERED` (push main → renderer)

Aggiunti tipi/interfacce: `ServerAddResult`, `UpdateServerRequest`, `ServerUnreachableEvent`.
Re-export di `StoredServer` da `serverStore`.

#### `src/main/ipc/handlers.ts`
- Rimosso `let knownServers: DiscoveredServer[]` (stato in-memory).
- Import `* as serverStore` dal nuovo store.
- `toDiscovered(s: StoredServer): DiscoveredServer` — adapter backward-compat per canali legacy.
- `ADD_SERVER_MANUAL` ora chiama `serverStore.upsertByIpPort()` per persistere.
- `GET_SERVERS` ora serve da `serverStore.getAll().map(toDiscovered)`.
- `REMOVE_SERVER` lookup per ip:porta via `serverStore.getByIpPort()`, poi rimozione per ID.
- Nuovi handler: `SERVERS_GET_ALL`, `SERVERS_ADD`, `SERVERS_UPDATE`, `SERVERS_REMOVE_BY_ID`.
- `EXPORT_INVENTORY` aggiornato per usare `serverStore.getAll()`.

#### `src/main/index.ts`
- Ref `mainWindow` spostata a livello di modulo (necessaria per push eventi dall'health check).
- `healthCheckAll()` — loop TCP probe (via `scanHost`) su tutti i server salvati ogni 60s:
  - Se server recuperato: aggiorna `unreachable: false`, `lastSeen`, push `server:recovered`.
  - Se server irraggiungibile: aggiorna `unreachable: true`, `unreachableSince`, push `server:unreachable`.
  - Prima esecuzione dopo 5s dall'avvio app.

#### `src/preload/index.ts`
- Re-export di `ServerAddResult`, `UpdateServerRequest`, `ServerUnreachableEvent` da `../main/ipc/types`.
- Mock `mockStoredServers[]` con 2 server pre-impostati.
- `servers.*` API (reale + mock): `getAll`, `add`, `update`, `remove`.
- `onServerUnreachable` / `onServerRecovered` (reale + mock).

#### `src/preload/index.d.ts`
Aggiunte interfacce: `StoredServer`, `ServerAddResult`, `UpdateServerRequest`, `ServerUnreachableEvent`.
`SqlSentinelAPI` estesa con `servers.*` e `onServerUnreachable`/`onServerRecovered`.

#### `src/renderer/src/components/Sidebar.tsx`
- Tipo `servers` e `selectedServer` cambiati da `DiscoveredServer` a `StoredServer`.
- `StatusDot` usa prop `unreachable?: boolean` (in precedenza `reachable: boolean | null`):
  - Pulsazione CSS (keyframes `@mui/system`) quando `unreachable === true` (1.5s ease-in-out, opacity 1→0.25→1).
- Tooltip mostra "Non raggiungibile dal {data}" quando unreachable.
- React key usa `s.id` (UUID) invece di `serverLabel(s)`.
- Comparazione selezione usa `selectedServer.id === s.id`.

#### `src/renderer/src/App.tsx`
- `loadServers()` chiamato al mount dal `useServersStore`.
- Sottoscrizione a `onServerUnreachable` → `updateServer(serverId, { unreachable: true, unreachableSince })`.
- Sottoscrizione a `onServerRecovered` → `updateServer(serverId, { unreachable: false, lastSeen })`.

#### `src/renderer/src/pages/Dashboard.tsx`
- Rimosso stato locale `servers: DiscoveredServer[]` → usa `useServersStore`.
- `selectedServer` tipizzato come `StoredServer | null`.
- `toCollectRequest()` aggiornato per usare `useWindowsAuth`, `username`, `password` da `StoredServer`.
- `handleRemoveServer` chiama `removeServer(server.id)` dallo store.
- Auto-selezione primo server quando store è inizializzato.
- Sync `selectedServer` se aggiornato nello store (es. `unreachable` cambia).
- **Banner irraggiungibilità**: pannello rosso sotto toolbar se server selezionato è `unreachable`:
  - Mostra "Server non raggiungibile — ultimo contatto: {data localizzata}".
  - Pulsante "Riprova ora": chiama `collectMetrics` direttamente; se ok → aggiorna store (`unreachable: false`, `lastSeen`) e inietta le metriche nel pannello.

## Campo hostingType (on-premise | cloud) — 2026-03-19

### Scopo
Permette di classificare ogni server SQL come on-premise o cloud, con badge visivo e modifica inline.

### File modificati

#### `src/main/store/serverStore.ts`
- Aggiunto `export type ServerHostingType = 'on-premise' | 'cloud'`
- Aggiunto campo opzionale `hostingType?: ServerHostingType` a `StoredServer`
- Retrocompatibile: i server esistenti senza il campo usano il default `'on-premise'`

#### `src/renderer/src/types/index.ts`
- Aggiunto `hostingType?: 'on-premise' | 'cloud'` a `ServerSummary`

#### `src/renderer/src/constants/hosting.tsx` — NUOVO
- `ServerHostingType` — tipo re-esportato
- `HOSTING_OPTIONS` — array `[{ value, label, icon }]` per i Select MUI
- `HOSTING_BADGE` — mappa `Record<ServerHostingType, { label, color }>` per i badge

#### `src/renderer/src/components/AddServerDialog.tsx`
- Aggiunto `hostingType: ServerHostingType` a `AddServerFormData` e `EMPTY_FORM`
- Aggiunto `<Select>` "Tipo infrastruttura" dopo il campo Gruppo

#### `src/renderer/src/components/Sidebar.tsx`
- Import `Chip` da MUI, import `HOSTING_BADGE`
- `ServerItem`: badge `<Chip>` ON-PREM / CLOUD accanto all'alias (flexShrink: 0)

#### `src/renderer/src/components/ServerDashboard.tsx`
- Import `useState`, `Select`, `MenuItem`, `Chip`, `Tooltip`, `Box`
- Import `useServersStore`, `HOSTING_OPTIONS`, `HOSTING_BADGE`
- Aggiunto header con badge cliccabile: click apre `<Select>` per modifica inline; onBlur chiude senza salvare

#### `src/renderer/src/components/HomeDashboard.tsx`
- Import `HOSTING_BADGE`
- Aggiunta colonna `INFRASTRUTTURA` nella tabella server (tra AMBIENTE e TIPO)
- Badge `<span>` con colore e label per ogni riga

#### `src/renderer/src/utils/inventoryUtils.ts`
- `buildServerSummary`: aggiunto `hostingType: srv.hostingType` nel return

#### `src/renderer/src/utils/csvExportUtils.ts`
- Aggiunto colonna `Tipo Infrastruttura` (indice 16) in tutte e 4 le varianti di riga (standalone placeholder, standalone per-DB, AG placeholder, AG per-DB)

#### `src/renderer/src/pages/Inventory.tsx`
- Aggiunto `'Tipo Infrastruttura'` all'array `headers` del CSV export
