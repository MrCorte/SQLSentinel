# Design: Miglioramento flusso inserimento server AON

**Data:** 2026-05-28  
**Stato:** Approvato — pronto per implementazione

---

## Obiettivo

Migliorare il flusso di aggiunta server per riconoscere automaticamente se un server è standalone o parte di un Always On Availability Group (AON), mostrare questa informazione subito durante il test connessione, ereditare le credenziali per le repliche mancanti e garantire che il dialog di suggerimento appaia indipendentemente dalla pagina corrente.

---

## Sezione 1 — `DETECT_SERVER_INFO` esteso

**File:** `src/main/ipc/handlers/system.ipc.ts`, `src/main/collectors/agCollector.ts`

Il handler `DETECT_SERVER_INFO` già recupera `machineName` e `instanceName` dalla connessione aperta. Viene esteso per interrogare anche le view AG **sulla stessa connessione**:

```ts
// Tipo di ritorno esteso
interface DetectServerInfoResult {
  machineName: string
  instanceName?: string
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  agName?: string
  agGroupId?: string
}
```

- Usa `sys.availability_groups` + `sys.availability_replicas` + `sys.dm_hadr_availability_replica_states`
- Se il server è standalone o mancano i permessi su `sys.dm_hadr_*`, i campi AG sono `undefined` — silent fallback, nessun errore
- La query AG è eseguita in parallelo rispetto a `machineName`/`instanceName` con `Promise.allSettled`

**Tipo IPC aggiornato in:** `src/preload/index.d.ts`

---

## Sezione 2 — `AddServerDialog` con badge AG

**File:** `src/renderer/src/components/AddServerDialog.tsx`

Dopo un test connessione riuscito, viene mostrato un chip sotto il pannello di risultato:

| Stato | Chip | Colore |
|-------|------|--------|
| Standalone | `Standalone` | grigio neutro (`default`) |
| AG Primary | `PRIMARY — NomeAG` | blu (`primary`) |
| AG Secondary | `SECONDARY — NomeAG` | arancione (`warning`) |
| RESOLVING | `RESOLVING — NomeAG` | grigio |

Il badge è visibile **solo dopo** il click su "Test connessione", non a form vuoto.

I valori `agRole`, `agName`, `agGroupId` vengono salvati nello stato interno del form.

**`AddServerFormData` esteso:**
```ts
interface AddServerFormData {
  // ... campi esistenti
  agRole?: AgRole
  agName?: string
  agGroupId?: string
}
```

---

## Sezione 3 — Salvataggio con AG info immediata

**File:** `src/main/ipc/handlers/servers.ipc.ts`, `src/main/store/sqlserver/serverRepository.ts`

Quando il form include `agRole`/`agName`/`agGroupId`, il `SERVERS_ADD` handler passa questi campi direttamente a `serverRepository.add()`. Il server viene scritto nel DB con il ruolo già noto, senza attendere la detection background.

Il `detectAgsForServer()` in background continua a girare perché aggiorna i **ruoli delle altre repliche già presenti** (es. se aggiungo il secondary, aggiorno il primary già salvato con `agGroupId`/`agName`).

---

## Sezione 4 — Badge ruolo nella lista server

**File:** sidebar server + home server cards (entrambi)

Ogni server mostra un chip compatto con il ruolo AG:

- Nessun chip se standalone (campo `agRole` assente)
- `PRIMARY` chip `primary` (blu)
- `SECONDARY` chip `warning` (arancione)

Il chip usa i dati `agRole` e `agName` già presenti su `StoredServer`. Nessun fetch aggiuntivo.

---

## Sezione 5a — Credenziali ereditate (Fix B)

**File:** `src/renderer/src/store/agStore.ts`, `src/renderer/src/components/AgReplicaSuggestionDialog.tsx`, `src/renderer/src/components/AddServerDialog.tsx`

`AgReplicaSuggestion` viene esteso con le credenziali del server sorgente:

```ts
interface AgReplicaSuggestion {
  agName: string
  missingReplicas: Array<{ replica_server_name: string; role_desc: AgRole }>
  sourceCredentials: {
    useWindowsAuth: boolean
    username?: string
    password?: string  // transitoria, già decifrata
  }
}
```

Quando `AgReplicaSuggestionDialog` apre `AddServerDialog` per una replica, passa le credenziali sorgente come valori iniziali (precompilati e modificabili dall'utente).

`AddServerDialog` riceve due nuovi props opzionali:
```ts
initialUseWindowsAuth?: boolean
initialUsername?: string
initialPassword?: string
```

---

## Sezione 5b — Dialog a root (Fix C)

**File:** `src/renderer/src/App.tsx` (o layout root), `src/renderer/src/pages/Discovery.tsx`

`<AgReplicaSuggestionDialog />` viene spostato da `Discovery.tsx` al componente root dell'app, in modo che il dialog appaia qualunque sia la pagina corrente quando la detection AG completa in background.

`Discovery.tsx` rimuove l'import e il render del componente.

---

## Flusso completo post-implementazione

```
1. Utente apre AddServerDialog → inserisce IP/porta
2. Click "Test connessione"
   → detectServerInfo() → machineName + instanceName + agRole + agName
   → Badge mostrato: "AG Primary — MyAG" oppure "Standalone"
3. Click "Salva"
   → server scritto con agRole/agName/agGroupId già valorizzati
   → detectAgsForServer() parte in background
     → aggiorna ruoli degli altri server già in lista
     → se trova repliche non monitorate → pendingAgSuggestions
4. AgReplicaSuggestionDialog appare (da root, qualunque pagina)
   → lista repliche mancanti con ruolo
   → click "Aggiungi" → AddServerDialog precompilato con:
      hostname + instanceName + credenziali ereditate
5. Lista server (sidebar + home) mostra badge PRIMARY/SECONDARY
```

---

## File modificati

| File | Tipo modifica |
|------|--------------|
| `src/main/ipc/handlers/system.ipc.ts` | Estende `DETECT_SERVER_INFO` con query AG |
| `src/preload/index.d.ts` | Aggiorna tipo `DetectServerInfoResult` |
| `src/renderer/src/components/AddServerDialog.tsx` | Badge AG, nuovi props, `AddServerFormData` esteso |
| `src/renderer/src/store/agStore.ts` | `AgReplicaSuggestion` + `sourceCredentials` |
| `src/renderer/src/components/AgReplicaSuggestionDialog.tsx` | Passa credenziali a `AddServerDialog` |
| `src/renderer/src/App.tsx` (o layout root) | Aggiunge `<AgReplicaSuggestionDialog />` |
| `src/renderer/src/pages/Discovery.tsx` | Rimuove `<AgReplicaSuggestionDialog />` |
| Sidebar server component | Badge `agRole` |
| Home server cards component | Badge `agRole` |
