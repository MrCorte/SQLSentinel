# SQL Sentinel

**SQL Sentinel** è un tool di monitoraggio per ambienti **Microsoft SQL Server**,
progettato per DBA e Data Engineer che gestiscono infrastrutture con decine
o centinaia di istanze SQL Server.

Fornisce una dashboard centralizzata per tenere sotto controllo in tempo reale
lo stato di salute dei server, dei database, delle sessioni, dei backup e dei
cluster Always On — senza dover aprire SSMS su ogni singolo server.

---

## Funzionalità principali

- **Dashboard globale** — panoramica di tutti i server monitorati con KPI,
  stato CPU/memoria, allarmi attivi e stato cluster Always On
- **Dashboard server singolo** — metriche dettagliate, storico CPU/memoria,
  elenco database, sessioni attive, blocchi, job e Wait Stats
- **Always On AG** — monitoraggio cluster con stato replica PRIMARY/SECONDARY,
  sync health e connessione in tempo reale; click sulla replica
  naviga direttamente alla dashboard del server
- **Inventario** — export CSV con una riga per ogni database,
  con colonne alias, referente, dimensioni, backup e stato;
  generato nel main process con BOM UTF-8 per compatibilità Excel
- **Allarmi** — rilevamento automatico database offline, backup scaduti,
  sessioni bloccate e soglie CPU/memoria; cap 500 allarmi / 7 giorni
- **Discovery** — aggiunta server tramite scansione rete o inserimento manuale
- **Multi-ambiente** — raggruppamento server per ambiente
  (Produzione / Collaudo / Sviluppo)

---

## Architettura

```text
Electron (main process)
├── PollingManager   scheduler concorrente, max 10 fetch paralleli
│   ├── ACTIVE       60s   server attualmente visualizzato
│   ├── IDLE         300s  server in background
│   └── OFFLINE      600s  server non raggiungibile
│       └── Circuit breaker  back-off esponenziale, cap 1 ora
├── SQL Collector    query T-SQL via tedious (AbortSignal su ogni fetch)
│                    supporta Windows Auth e SQL Auth
│                    errori SQL sanitizzati (no credentials in log)
├── AG Detector      rilevamento ruoli replica Always On
│                    throttle ogni 5 poll (evita query non necessarie)
├── Delta IPC        batch coalescing 50ms (setTimeout macrotask)
│                    invia solo i DB cambiati al renderer
│                    soglia: ≤5 DB cambiati oppure ≤20% del totale
├── IPC Auth         wrapper autenticato su tutti i canali IPC
│                    canali esenti espliciti: auth, ping, settings read
└── SQLite           persistenza server, metriche, allarmi
                     WAL mode, retention automatica via setImmediate
                     VACUUM differito all'avvio (non blocca UI)

React Renderer
├── Zustand + Immer  store reattivo, mutation in-place
│                    re-render solo sul server aggiornato
├── Two-tier metrics summary leggero (~128B) per tutti i server
│                    dati completi solo per il server attivo
├── React.memo       Sidebar items memoizzati (ServerItem, GroupHeader …)
│                    callback stabili via useCallback — nessun re-render
│                    su tick di polling che non cambia il server visibile
├── Ring buffer      cpuHistory / memoryHistory
│                    cap 60 punti server attivo / 10 punti idle
└── @tanstack/virtual  virtualizzazione lista server (200+ server)
```

**Target di scala: 200 server / 1500 database monitorati in tempo reale.**

---

## Sicurezza

| Area | Meccanismo |
|---|---|
| IPC auth | Ogni canale IPC richiede autenticazione; canali esenti dichiarati esplicitamente in `AUTH_EXEMPT_CHANNELS` |
| SQL errors | `sanitizeSqlError()` filtra host, porta e credenziali prima del log |
| Path traversal | Nomi file PDF validati con regex `SAFE_PDF_NAME` prima di `path.join()` |
| TCP scan | Handshake timer esplicito (500 ms) — evita socket pendenti su porte filtrate |
| Credenziali | Cifrate a riposo con `safeStorage` (Electron keychain OS) |
| Parametrizzazione | Tutte le query T-SQL usano parametri — nessuna concatenazione SQL |
| Sandbox | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` solo main |

---

## Installazione

### Requisiti

| Requisito | Dettaglio |
|---|---|
| Sistema operativo | Windows 10 / 11 x64 |
| SQL Server | 2014 o superiore |
| Autenticazione | Windows Auth o SQL Auth |
| Rete | Porta 1433 raggiungibile dai server monitorati |
| Dipendenze | Nessuna — SQL Sentinel è self-contained |
| Agenti sui server | Non richiesti |

### Installazione da installer

1. Scarica `SQL Sentinel Setup x.x.x.exe`
2. Esegui l'installer e segui la procedura guidata
3. Avvia **SQL Sentinel** dal menu Start o dal desktop

> La prima volta Windows potrebbe mostrare "Publisher sconosciuto"
> → clicca **Esegui comunque**

### Installazione portable

1. Estrai la cartella `win-unpacked\`
2. Esegui `sqlsentinel.exe` direttamente — nessuna installazione richiesta

---

## Primo avvio

### 1. Aggiungere un server

1. Vai al tab **Discovery**
2. Clicca **Aggiungi server manualmente**
3. Compila i campi:

| Campo | Esempio |
|---|---|
| Host | `192.168.1.10` oppure `localhost` |
| Porta | `1433` (default) |
| Istanza named | `SERVER\SQLEXPRESS` |
| Autenticazione | Windows Auth (consigliata) o SQL Auth |
| Ambiente | Produzione / Collaudo / Sviluppo |
| Alias | Nome descrittivo es. `SQL-PROD-01` |
| Referente | Nome del responsabile del server |

4. Clicca **Testa connessione** per verificare la raggiungibilità
5. Clicca **Aggiungi** — il server appare nella sidebar e il polling parte automaticamente

### 2. Verificare SQL Server Configuration

Se la connessione fallisce, verifica su ogni server monitorato:

```powershell
# TCP/IP abilitato in SQL Server Configuration Manager
# → SQL Server Network Configuration
# → Protocols → TCP/IP → Enabled

# Porta 1433 aperta nel firewall
New-NetFirewallRule -DisplayName "SQL Server 1433" `
  -Direction Inbound -Protocol TCP `
  -LocalPort 1433 -Action Allow

# Test connessione rapido
sqlcmd -S localhost -E -Q "SELECT @@SERVERNAME, @@VERSION"
```

> **Nota:** SQL Server Browser (UDP 1434) non è richiesto né supportato.
> Le istanze named devono essere configurate con porta TCP fissa.

---

## Build da sorgente

### Prerequisiti sviluppo

- Node.js v22+ (LTS)
- npm v10+
- Windows 10/11 x64

### Setup

```bash
git clone https://github.com/MrCorte/SQLSentinel.git
cd SQLSentinel
npm install
```

### Avvio in sviluppo

```bash
npm run dev
```

### Test

```bash
npx vitest run          # esegui tutti i test
npx vitest              # watch mode
```

Suite: 179 test / 9 file — copertura su PollingManager,
delta computation (shouldSendDelta / applyDelta / computeDelta),
memory bounds, HomeDashboard hooks, CSV export, SQLite store
e ServerHistoryChart.

### Build produzione

```bash
# Typecheck + build TypeScript + Vite
npm run build

# Packaging Windows x64 (include typecheck automaticamente)
npm run build:win
```

Output in `dist\`:

```text
dist\
├── win-unpacked\
│   └── sqlsentinel.exe            ← portable
└── SQL Sentinel Setup x.x.x.exe  ← installer NSIS
```

---

## Struttura progetto

```text
src\
├── main\                      Electron main process
│   ├── collectors\            Query T-SQL verso SQL Server (+ sanitizeSqlError)
│   ├── ipc\                   Handler IPC autenticati main ↔ renderer
│   ├── store\                 SQLite — server, metriche, allarmi
│   ├── discovery\             TCP scanner (handshake timeout esplicito)
│   └── metricsWorker.ts       Polling, delta IPC, AG throttle, AbortController
├── renderer\src\
│   ├── components\            React UI — Dashboard, Sidebar (memoizzata), AG, Inventario
│   ├── store\                 Zustand stores — metrics (applyDelta), alerts, servers, app
│   ├── hooks\                 useNow (epoch ms, 60s tick), useShallow, …
│   └── utils\                 CSV export, memory audit, formatters
└── preload\                   Bridge IPC sicuro main ↔ renderer
```
