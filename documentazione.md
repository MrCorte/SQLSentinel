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
