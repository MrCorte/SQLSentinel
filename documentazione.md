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
