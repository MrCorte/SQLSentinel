# Skill: Changelog Automatico

## Scopo

Documenta tutte le implementazioni e modifiche con data e ora
in CHANGELOG.md nella root del progetto.

## Quando usare questa skill

Esegui questa skill al termine di ogni sessione di sviluppo
o dopo ogni gruppo di implementazioni correlate.

## Comportamento

### 1. Leggi il contesto della sessione

- Identifica tutti i file creati, modificati o eliminati
- Raggruppa le modifiche per area/componente
- Classifica ogni modifica in una categoria:
  - **Added** → nuove feature, nuovi file, nuovi componenti
  - **Changed** → modifiche a feature esistenti
  - **Fixed** → bug fix, correzioni TypeScript, correzioni UI
  - **Removed** → file o feature eliminati
  - **Perf** → ottimizzazioni performance, memoria, rendering

### 2. Formato voce obbligatorio

NomeComponente/Area: descrizione concisa e specifica

text

Esempi corretti:
Inventario: aggiunta tabella virtualizzata con filtri ambiente/tipo/stato

AgDashboard: fix ordine icona/testo in CONNECTED e HEALTHY

metricsStore: ring buffer cpuHistory/memoryHistory cap 60/10 punti

PollingManager: circuit breaker con back-off esponenziale cap 1h

text

Esempi NON accettabili:
Vari fix e miglioramenti ← troppo generico

Aggiornato il codice ← non identifica il componente

Fix bug ← non descrive cosa è stato fixato

text

### 3. Struttura CHANGELOG.md

Se CHANGELOG.md non esiste, crealo con questa struttura:

```markdown
# Changelog — [Nome Progetto]

Tutte le modifiche rilevanti vengono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

## [Unreleased]

---

4. Aggiunta voci
   Aggiungi sempre sotto ## [Unreleased], con data e ora:

text

## [Unreleased]

### Added — 2026-03-19 15:43

- Inventario: tabella flat virtualizzata con filtri
- Inventario: righe AG cluster espandibili con repliche figlie

### Fixed — 2026-03-19 11:20

- AgDashboard: mostra alias invece di IP nelle card replica
- AgDashboard: ordine icona prima del testo in CONNECTED/HEALTHY
  Regole:

Data e ora nel formato YYYY-MM-DD HH:MM accanto alla categoria

Se la stessa categoria appare più volte nella giornata,
aggiungi un nuovo blocco con orario aggiornato

Non modificare mai voci già esistenti — solo append

5. Release — quando viene creata una versione
   Sostituisci ## [Unreleased] con la versione e data:

text

## [1.2.0] — 2026-03-19

### Added — 2026-03-19 15:43

...
E aggiungi un nuovo ## [Unreleased] vuoto in cima.
```
