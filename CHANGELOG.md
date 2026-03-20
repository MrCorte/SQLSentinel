# Changelog — SQL Sentinel

Tutte le modifiche rilevanti vengono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

## [Unreleased]

### Fixed — 2026-03-20 (mock bugs)
- `useMockData`: cambiato da `[initialized]` a `[]` deps — il seeding avviene al mount senza attendere `loadServers()` (che in mock mode non viene mai chiamato)
- `useMockData`: `useServersStore.setState` ora imposta `initialized: true` assieme ai server mock, così non è più necessario attendere `loadServers()`
- `useMockData`: `serverGroups` e `serverAliases` ora vengono MERGIATI (`{ ...state.serverGroups, ...MOCK_SERVER_GROUPS }`) invece di sostituiti — i group-assignment dei server reali non vengono più cancellati dal localStorage quando si usa VITE_USE_MOCK=true
- `App.tsx`: aggiunto guard `if (USE_MOCK) return` nell'effect `loadServers` — in mock mode il caricamento reale da electron-store viene completamente saltato, così i server mock non vengono sovrascritti
- `App.tsx`: aggiunto guard `if (USE_MOCK) return` nell'effect `workerSyncServers` — in mock mode gli IP mock (10.0.x.x) non vengono passati al worker

### Added — 2026-03-20 (quinquies)
- Mock data set realistici per testare tutti i filtri dell'Inventario (`VITE_USE_MOCK=true` in `.env.development`)
  - `src/renderer/src/mocks/servers.mock.ts` — 12 server mock (`MOCK_SERVERS`, `MOCK_SERVER_GROUPS`, `MOCK_SERVER_ALIASES`, `MOCK_METRICS_MAP`, `MOCK_AG_GROUPS`); copertura: 3 ambienti (Prod/Coll/Dev), 2 AG cluster, 3 machine-header (SQLPROD03, SQLPROD04, SQLDEV01), 4 referenti (Andrea Cortesi / Mario Rossi / Luca Bianchi / Sara Verdi + null), hosting cloud/on-premise, 3 server irraggiungibili
  - `src/renderer/src/hooks/useMockData.ts` — hook che semina `serversStore`, `groupsStore` (serverGroups + serverAliases + expandedAGs + expandedMachines), `metricsStore` (metricsMap) e `agStore` (agGroups) dopo `serversStore.initialized === true`; no-op quando `VITE_USE_MOCK !== 'true'`
  - `App.tsx`: `useMockData()` chiamato in `AppInner` (prima di ogni altro hook)
  - `env.d.ts`: aggiunta `VITE_USE_MOCK: string` a `ImportMetaEnv`
  - `.env.development`: aggiunto `VITE_USE_MOCK=true`
  - `.env.production` (nuovo): `VITE_USE_MOCK=false`

### Added — 2026-03-20
- HomeDashboard: bottone "Aggiorna metriche" nell'header (top-right, accanto al timestamp) — stesso stile del bottone già presente in Inventario (MUI Button `variant="contained"`, `RefreshIcon`, spinner durante il refresh, disabled mentre in corso)
- Hook `useRefreshAllServers` (`src/renderer/src/hooks/useRefreshAllServers.ts`) — logica refresh-all estratta da Inventory in un hook condiviso; ritorna `{ refreshing, lastRefresh, handleRefresh }`; usato sia da Inventory sia da HomeDashboard per evitare duplicazione

### Added — 2026-03-20 (quater)
- Inventario: filtri "Alias" e "Referente" nella barra filtri
  - Dropdown "Tutti gli alias" — opzioni calcolate con `useMemo` dai valori di `serverAliases`; visibile solo se almeno un alias è definito; filtra i server dove `serverAliases[ip:port] === valore`
  - Dropdown "Tutti i referenti" — opzioni calcolate da `metricsMap.databases[].referente`; visibile solo se almeno un referente è definito; filtra i server dove almeno un DB ha `referente === valore`
  - Entrambi i filtri si combinano in AND con tutti i filtri esistenti; si attivano solo su righe foglia (`standalone`, `ag-replica`) — header di cluster e macchina non vengono mai mostrati senza figli corrispondenti
  - Quando attivi, i cluster AG e i gruppi macchina vengono forzatamente espansi (`effectiveExpanded`, `effectiveExpandedMachines`) così tutte le righe foglia sono disponibili per il filtraggio
  - Bottone "Reset" azzera entrambi i nuovi filtri; `hasActiveFilters` aggiornato di conseguenza
  - Fix: `hasHierarchy` in `sortedRows` ora richiede la presenza di righe header (depth=0, tipo `ag-cluster` o `machine-header`) per evitare che righe depth=1 orfane vengano silenziosamente perse dall'output

### Added — 2026-03-20 (ter)
- **Multi-istanza**: supporto al raggruppamento di più istanze SQL Server sulla stessa macchina fisica
  - `StoredServer.machineName` (opzionale) — popolato automaticamente da `SERVERPROPERTY('MachineName')` al "Testa connessione" nel form di aggiunta server; retrocompat: fallback a `host` per server già salvati
  - Sidebar: istanze con stesso `machineName` (2+) raggruppate sotto header collassabile "🖥 MACCHINA (N istanze)" — stessa logica degli AG; macchine con una sola istanza non mostrano l'header; espansione persistita in `groupsStore.expandedMachines`; priorità AG > macchina (AG members non entrano nel gruppo macchina)
  - Inventario: nuova colonna MACCHINA; header `machine-header` collassabile per macchine con 2+ istanze; stato "OK/OFFLINE" sul header macchina; conteggio istanze aggregato nelle KPI; `effectiveExpandedMachines` forza espansione automatica con filtro "Standalone"
  - `groupsStore`: aggiunto `expandedMachines: string[]` + `toggleMachineCollapse()` (persistito in localStorage)

### Added — 2026-03-20 (bis)
- Form aggiunta server: campo "Porta" riposizionato sulla stessa riga di "IP / Hostname" (`Stack direction="row"`); "Nome Istanza" spostato su riga separata sotto; aggiunto hint testuale sotto il campo Porta con istruzioni per la porta statica su named instance con SQL Browser disabilitato
- Visualizzazione porta condizionale: la porta viene mostrata accanto all'host (es. `192.168.1.10:2433`) solo quando ≠ 1433, sia nella sidebar (`getServerDisplayName`) sia nella colonna SERVER dell'Inventario; porta 1433 non visualizzata (implicita)

### Fixed — 2026-03-20
- Inventario: filtro "AG Primary" / "AG Secondary" restituiva 0 risultati quando i cluster AG erano collassati — le righe `ag-replica` vengono ora generate su tutti i cluster (indipendentemente dallo stato espanso) quando `filterType` è `ag-primary` o `ag-secondary`, tramite `effectiveExpanded = new Set(allClusterKeys)` passato a `buildRows`


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
