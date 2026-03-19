# Changelog — SQL Sentinel

Tutte le modifiche rilevanti vengono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

## [Unreleased]

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
