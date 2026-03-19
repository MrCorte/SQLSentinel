# SQLSentinel — SQL Server Monitor

## Scopo
Desktop app (Electron + React) per monitorare tutti i SQL Server 
raggiungibili dalla VM locale. Sviluppata da un DBA SQL Server.

## Stack
- Electron 28+ con electron-vite
- React 18 + TypeScript strict
- MUI v5 per UI components
- mssql (tedious) come driver TDS — connessione diretta porta 1433
- better-sqlite3 per storico metriche locale
- recharts per grafici

## VINCOLI AMBIENTE (CRITICI - non ignorare mai)
- PowerShell: DISABILITATO su tutti i SQL Server target
- SQL Server Browser Service (UDP 1434): DISABILITATO
- Conseguenza: usare SOLO connessioni TCP dirette (porta 1433)
- Named instances con porte dinamiche: NON auto-discoverable
- Permettere sempre aggiunta manuale host:porta:istanza

## Discovery SQL Server
1. TCP scan porta 1433 su subnet (net.Socket, timeout 500ms)
2. TCP scan porta 1434 DAC come segnale secondario
3. TCP scan range porte configurabile (named instances porte statiche)
4. Aggiunta manuale da UI

## Architettura IPC (Electron)
- Tutta la logica SQL gira nel main process (sicurezza)
- Il renderer comunica SOLO via ipcRenderer/ipcMain
- Nessuna dipendenza node-native esposta direttamente nel renderer
- contextIsolation: true, nodeIntegration: false sempre

## Convenzioni codice
- TypeScript strict, no any impliciti
- Query T-SQL sempre parametrizzate (no string concat)
- Timeout espliciti su ogni connessione SQL
- Errori SQL loggati senza esporre credenziali
- snake_case per alias colonne T-SQL
- Nomi file: camelCase per componenti, kebab-case per utility

## Comandi
- `npm run dev` — sviluppo con hot reload
- `npm run build` — build produzione Windows
- `npm run test` — vitest

## Moduli da implementare (in ordine)
1. /src/main/discovery — TCP scanner
2. /src/main/ipc — canali IPC tipizzati
3. /src/main/collectors — query metriche SQL
4. /src/main/store — SQLite persistence
5. /src/renderer/pages/Discovery — UI scan rete
6. /src/renderer/pages/Dashboard — metriche aggregate
