# Changelog — SQL Sentinel

Tutte le modifiche rilevanti vengono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

## [Unreleased]

### Fixed — 2026-03-20
- Sidebar: eliminato il doppio render dei server standalone — la split `agServersInGroup` / `standaloneServers` è ora mutuamente esclusiva basata su `agGroupId != null`; il loop figli AG usa `agServersInGroup.filter(s => s.agGroupId === ag.id)` invece di `ag.serverIds.includes(s.id)`, evitando che server senza `agGroupId` (matchati solo per euristica hostname) compaiano sia dentro il gruppo AG sia fuori come standalone
- Sidebar: server standalone non più inglobati dentro un gruppo AG; un server viene considerato "membro di un AG" solo se ha `agGroupId` valorizzato (confermato dalla propria detection), non per sola corrispondenza euristica del nome replica in `agStore`

### Changed — 2026-03-20
- `database.ts`: aggiunto `PRAGMA synchronous = NORMAL` — riduce fsync da 2 a 1 per transazione, sicuro con WAL mode, ~2x più veloce di `FULL` (default)
- `database.ts`: aggiunto `PRAGMA cache_size = -8192` — cache pagine portata a 8 MB (default: 2 MB)
- `database.ts`: aggiunto `PRAGMA temp_store = MEMORY` — tabelle temporanee allocate in RAM
- `database.ts`: aggiunto indice `idx_metrics_cleanup ON metrics_snapshots(collected_at)` — copre la query `DELETE WHERE collected_at < ?` in `metricsRepository.cleanup()` che non può usare il composito `(server_id, collected_at)` per assenza del filtro su `server_id`; i due indici rimangono complementari: il composito per `findLatest`/`findHistory`, il standalone per il purge

### Analysis — 2026-03-20
- Audit schema SQLite completo via MCP: identificate 6 ottimizzazioni su 4 tabelle
- `db_custom_fields.id` è una PK concatenata opaca (`server_id/db_name`) — migration proposta verso colonne `(server_id, db_name)` + indice `idx_db_custom_server` per query export/merge
- `metrics_snapshots`: FK `REFERENCES servers(id)` inutilizzabile (tabella `servers` SQLite sempre vuota — server gestiti via electron-store); migration proposta per rimuovere FK e sbloccare la tabella
- `metrics_snapshots`: indice composito `(server_id, collected_at DESC)` non copre `cleanup()` (no `server_id` nel WHERE) — proposto `idx_metrics_collected_at` dedicato al purge
- `metrics_snapshots.collected_at TEXT`: possibile migrazione a `REAL` epoch per ridurre storage e velocizzare comparazioni range
- PRAGMA mancanti: `synchronous=NORMAL` (sicuro con WAL, ~2x più veloce), `cache_size=-8192` (8MB), `temp_store=MEMORY`
- Architectural debt: `servers` SQLite + `serverRepository.ts` sono dead code — server gestiti esclusivamente via electron-store (`serverStore.ts`); stesso per `metricsRepository.ts` (worker usa Map in-memory)
- Tutte le migration SQL documentate con script eseguibili

### Changed — 2026-03-19 18:30
- Inventario: KPI cards aggiornate dinamicamente in base ai filtri attivi; `filteredStats` useMemo derivato da `filteredRows` (zero passate extra); contatori Server/Standalone/AG Cluster/Database/Online/Offline riflettono solo le righe visibili dopo il filtraggio
- Inventario: indicatore testuale "Risultati filtrati: N di M server" visibile sotto le KPI cards quando almeno un filtro è attivo; nascosto quando nessun filtro è applicato

### Changed — 2026-03-19 18:00
- Sidebar: gruppi AG collassabili — clic sull'header toggle espandi/comprimi; chevron `›` ruota 90° quando espanso; default tutti collassati al primo avvio
- groupsStore: aggiunto `expandedAGs: string[]` (array JSON-serializzabile, vuoto = tutti collassati) + action `toggleAgCollapse(agName)`
- Sidebar: `SidebarItem { kind: 'ag' }` ora porta `isExpanded: boolean`; server-rows AG inseriti in flatItems solo quando il gruppo è espanso
- Sidebar: `AgGroupHeader` riceve `isExpanded` prop; click chiama `onToggleAgCollapse` (non navigazione)

### Added — 2026-03-19 17:20
- AddServerDialog: pulsante "Testa connessione" che chiama detectServerInfo via IPC; auto-compila alias (se vuoto) con MachineName e instanceName con InstanceName ('' se istanza default); stato visuale idle/loading/success/error con Chip verde o messaggio errore
- sqlCollector: nuova funzione detectServerInfo(connection) — esegue `SELECT SERVERPROPERTY('MachineName'), SERVERPROPERTY('InstanceName')` su connessione dedicata con finally/close; restituisce `{ machineName, instanceName: null }` per istanza default
- collectors/types.ts: interfaccia ServerInfo `{ machineName: string, instanceName: string | null }`
- ipc/types.ts: canale DETECT_SERVER_INFO = 'servers:detectInfo'; re-export ServerInfo
- ipc/handlers.ts: handler DETECT_SERVER_INFO che chiama detectServerInfo e restituisce IpcResult<ServerInfo>
- preload/index.ts: detectServerInfo aggiunto a realApi, mockApi (stub con delay 800ms) e bridgeApi
- preload/index.d.ts: interfaccia ServerInfo e firma detectServerInfo in SqlSentinelAPI

### Changed — 2026-03-19 16:30
- Inventario: righe AG cluster espandibili con repliche figlie (ag-cluster/ag-replica hierarchy), Espandi/Comprimi tutti, sorting gerarchico che mantiene le repliche sotto il cluster padre, counter mostra solo righe depth=0

### Changed — 2026-03-19 15:50
- Inventario: sostituita struttura a sezioni per ambiente con tabella flat virtualizzata (@tanstack/react-virtual); barra filtri search/ambiente/tipo/stato/hosting; ordinamento colonne cliccabile con indicatori ▲▼; empty state per filtri senza risultati

### Fixed — 2026-03-19 15:10
- AgDashboard: ReplicaCard mostra alias server (da groupsStore.serverAliases) invece dell'IP; IP raw visibile in caption solo se diverso dal displayName
- AgDashboard: icona ✅/❌ prima del testo nella riga Connessione (era invertita)

### Fixed — 2026-03-19 14:40
- ServerHistoryChart: Tooltip formatter tipizzato correttamente come `(value, name) => [string, string]`; gestito caso `value: ValueType | undefined` con guard `typeof value === 'number'`

### Added — 2026-03-19 13:00
- ServerHistoryChart: nuovo componente Recharts (LineChart) per storico CPU/Memoria per server; usa historyMap dal metricsStore; empty state per server non raggiungibile o senza campioni; ReferenceLine a 80% per soglia CPU; Tooltip mostra anche MB assoluti dalla memoria
- ServerDashboard: integrazione ServerHistoryChart tra KPI cards e tabella database
- metricsStore: calcolo memPercent (memoryUsedMb/totalMemoryMb×100) prima del push nel ring buffer; fix dati memoria espressi in % invece che MB
- metricsStore: action resetHistory(serverId?) per svuotare ring buffer

### Added — 2026-03-19 11:30
- constants/hosting.tsx: ServerHostingType, HOSTING_OPTIONS (con icone MUI), HOSTING_BADGE (label + colore per on-premise/cloud)
- StoredServer: campo hostingType (on-premise | cloud), opzionale per retrocompatibilità
- serverRepository: migration ALTER TABLE hosting_type con try/catch idempotente; INSERT/UPDATE mappano hosting_type; getAll normalizza il valore
- AddServerDialog: Select "Tipo infrastruttura" con icone Storage/Cloud
- Sidebar: Chip badge ON-PREM/CLOUD accanto al nome server
- ServerDashboard: modifica inline hostingType con Select su click del badge; salva via updateServer IPC
- HomeDashboard: colonna Infrastruttura nella tabella server con Chip colorato
- csvExportUtils: colonna "Tipo Infrastruttura" nell'export CSV inventario

### Added — 2026-03-19 10:00
- metricsStore: two-tier store — summaries (tutti i server, ~128B) + fullMetrics (solo server attivo, completo); setSummary, setActiveServerId, evictFullMetrics
- metricsStore: historyMap con ring buffer cpuHistory/memoryHistory cap 60 punti (server attivo) / 10 punti (idle); push atomico CPU+memoria nello stesso set()
- alertsStore: purge automatico in addAlert — MAX_ALERTS=500, MAX_ALERT_AGE_MS=7 giorni; filtro su detectedAt
- database.ts: purgeOldMetrics() con retention 30 giorni su metrics_snapshots; schedulato a boot + ogni 24h
- database.ts: indice composito (server_id, collected_at DESC) su metrics_snapshots; sostituisce i due indici singoli
- main/index.ts: IPC APP_BACKGROUND/APP_FOREGROUND su blur/focus finestra; GC logging ogni 60s in dev mode con guard global.gc
- appStore: campo isBackground per tracciare stato foreground/background

### Fixed — 2026-03-19 09:00
- main/index.ts: cast GC da `NodeJS.Global` (rimosso in @types/node v20+) a `globalThis & { gc?: () => void }`
- memoryBounds.test.ts: rimosso import duplicato di ServerMetrics (righe 16 e 34)

### Added — 2026-03-19 08:00
- mockSqlite.ts: mock in-memory di better-sqlite3 per Vitest (evita mismatch NODE_MODULE_VERSION Electron 39 vs Node v24); simula INSERT ON CONFLICT upsert, DELETE con filtro data, SELECT con range ISO string
- vitest.config.ts: setupFiles con mockSqlite.ts per tutti i test
- Test suite: 102/102 test passanti su 8 file (pollingManager, deltaComputation, memoryBounds, homeDashboard, csvExport, sqlCollector, store)

### Fixed — 2026-03-19 07:30
- deltaComputation.test.ts: sostituito vi.runAllTimersAsync() (causava loop infinito nel scheduler) con drainJobCycle() (10× await Promise.resolve()); timer advancement corretto a 300_001ms (INTERVAL_IDLE_MS=300_000)
- memoryBounds.test.ts: runNCycles() corretto per primo ciclo senza advance + cicli successivi con 300_001ms; fix test shift() che usava runNCycles(1) dopo il reset
- homeDashboard.test.tsx: aggiunto `// @vitest-environment jsdom` per fix `document is not defined` su Windows (path separator backslash ignorato da environmentMatchGlobs)
- homeDashboard.test.tsx: getByText → getAllByText per elementi multipli nel DOM
- csvExport.test.ts: fix import path `../../../main/csvUtils` (era `../../main/csvUtils`)
- sqlCollector.test.ts: fix routing SQL — controllo `backupset` prima di `sys.databases` per evitare match errato sul JOIN

### Added — 2026-03-19 06:00
- README.md: documentazione completa — funzionalità, architettura, installazione, primo avvio, build da sorgente, struttura progetto
