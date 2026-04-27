# SQLSentinel — Guida Funzionale

**Versione applicazione:** 1.0.0
**Data documento:** aprile 2026
**Destinatari:** management, responsabili IT

---

## Indice

1. [Cos'è SQLSentinel](#cosè-sqlsentinel)
2. [Accesso all'applicazione](#accesso-allapplicazione)
3. [Panoramica generale — Home Dashboard](#panoramica-generale--home-dashboard)
4. [Discovery — Ricerca server SQL](#discovery--ricerca-server-sql)
5. [Inventario — Vista completa del parco SQL](#inventario--vista-completa-del-parco-sql)
6. [Dashboard server — Metriche in tempo reale](#dashboard-server--metriche-in-tempo-reale)
7. [Avvisi — Alert e notifiche](#avvisi--alert-e-notifiche)
8. [Assistente AI](#assistente-ai)
9. [Impostazioni](#impostazioni)
10. [Servizio in background](#servizio-in-background)

---

## 1. Cos'è SQLSentinel

SQLSentinel è un'applicazione desktop per il **monitoraggio centralizzato di istanze Microsoft SQL Server** all'interno della rete aziendale. Permette ai team IT di tenere sotto controllo in un unico punto lo stato di salute di tutti i database server, ricevere avvisi automatici in caso di anomalie e consultare lo storico delle metriche nel tempo.

### Principali benefici

| Beneficio | Descrizione |
|---|---|
| **Visibilità centralizzata** | Tutti i server SQL aziendali in un'unica schermata, con indicatori di stato immediati |
| **Rilevamento automatico** | Scansione della rete per individuare nuove istanze SQL Server senza configurazione manuale |
| **Monitoraggio continuo** | Raccolta automatica di CPU, memoria, sessioni attive, spazio disco e stato backup |
| **Avvisi proattivi** | Notifiche immediate (email e notifica di sistema) per situazioni critiche |
| **Inventario aggiornato** | Catalogo completo di tutti i database con metadati personalizzabili |
| **Analisi storica** | Grafici e dati storici per analizzare l'andamento nel tempo |
| **Assistente AI** | Interfaccia conversazionale per interrogare i dati dei server in linguaggio naturale |

### Architettura semplificata

L'applicazione è composta da due componenti che lavorano insieme:

- **Interfaccia grafica** — l'applicazione desktop che l'operatore utilizza quotidianamente
- **Servizio in background** — un servizio Windows installato sul sistema che raccoglie le metriche anche quando l'interfaccia è chiusa, garantendo la continuità del monitoraggio anche dopo riavvii del server

---

## 2. Accesso all'applicazione

All'avvio, SQLSentinel mostra una schermata di login. L'accesso è protetto da credenziali nominali: ogni operatore ha un proprio account con username e password.

> **📸 SCREENSHOT DA INSERIRE:** Schermata di login con i campi username e password visibili (oscurare eventuali dati reali)

### Primo accesso

Al primo accesso con un account appena creato, il sistema richiede obbligatoriamente il cambio password. La nuova password deve rispettare i requisiti minimi di sicurezza (almeno 8 caratteri, una lettera maiuscola, un numero).

> **📸 SCREENSHOT DA INSERIRE:** Dialog di cambio password obbligatorio al primo accesso

---

## 3. Panoramica generale — Home Dashboard

La Home Dashboard è la schermata principale dell'applicazione, quella che compare immediatamente dopo il login. Offre una **visione d'insieme immediata** sullo stato dell'intero parco SQL Server monitorato.

> **📸 SCREENSHOT DA INSERIRE:** Schermata Home Dashboard completa, con KPI card in alto, grafici e tabella server

### 3.1 Indicatori KPI (Key Performance Indicators)

Nella parte superiore della schermata sono presenti cinque riquadri colorati che mostrano a colpo d'occhio i numeri chiave:

| Indicatore | Significato |
|---|---|
| **Totale server** | Numero complessivo di istanze SQL Server monitorate |
| **Critici** | Server o situazioni con alert di livello critico attivi |
| **Warning** | Situazioni che richiedono attenzione ma non ancora critiche |
| **Offline** | Server con database non raggiungibili o in stato anomalo |
| **Online** | Server regolarmente raggiungibili e operativi |

Cliccando su uno qualsiasi di questi riquadri, la lista server sottostante si filtra automaticamente per mostrare solo i server corrispondenti.

### 3.2 Grafici di riepilogo

Accanto ai KPI sono presenti due grafici:

- **Grafico a ciambella (Stato)** — mostra la distribuzione dei server per stato operativo (Online / Offline / Non raggiungibile)
- **Grafico a barre (CPU)** — mostra il carico CPU attuale per ciascun server, utile per identificare immediatamente i server più carichi

> **📸 SCREENSHOT DA INSERIRE:** Dettaglio dei grafici a ciambella e a barre

### 3.3 Tabella server

La sezione inferiore della Home Dashboard elenca tutti i server monitorati con le metriche principali aggiornate in tempo reale:

| Colonna | Descrizione |
|---|---|
| **Stato** | Pallino colorato: verde = online, rosso = non raggiungibile, grigio = offline |
| **Server** | Nome o alias del server con indirizzo IP |
| **CPU %** | Utilizzo corrente della CPU (rosso se >80%, giallo se >60%) |
| **RAM GB** | Memoria utilizzata dall'istanza SQL Server |
| **Blocchi** | Numero di sessioni SQL in attesa bloccate da altre (valore ideale: 0) |
| **DB Offline** | Numero di database in stato non-ONLINE su quel server |
| **Alert** | Numero di avvisi critici e di warning attivi |
| **Ultimo contatto** | Da quanto tempo è stato ricevuto l'ultimo aggiornamento ("adesso", "5 min fa", ecc.) |

Cliccando su una riga si naviga direttamente alla Dashboard di dettaglio di quel server.

---

## 4. Discovery — Ricerca server SQL

La sezione Discovery permette di **individuare automaticamente le istanze SQL Server** presenti in rete tramite scansione TCP, oppure di aggiungere manualmente un server noto.

> **📸 SCREENSHOT DA INSERIRE:** Schermata Discovery con la configurazione della scansione e i risultati

### 4.1 Scansione automatica della rete

Per avviare una ricerca automatica è sufficiente:

1. Inserire il **range di indirizzi IP** della rete da scansionare (in formato CIDR, ad esempio `192.168.1.0/24`)
2. Eventualmente specificare **porte aggiuntive** da includere nella ricerca (oltre alla porta standard 1433)
3. Regolare il **livello di parallelismo** (numero di connessioni simultanee) tramite il cursore, bilanciando velocità e impatto sulla rete
4. Premere **Avvia scansione**

Durante la scansione una barra di avanzamento mostra in tempo reale quanti host sono stati verificati e quante istanze SQL sono state trovate.

> **📸 SCREENSHOT DA INSERIRE:** Barra di avanzamento della scansione con contatori

### 4.2 Risultati della scansione

Al termine della scansione, i server trovati compaiono nella tabella risultati con le seguenti informazioni:

- **Indirizzo IP / Hostname**
- **Porta**
- **Stato** (raggiungibile / non raggiungibile)
- **Tempo di risposta** in millisecondi
- **Tipo** (rilevato via TCP o aggiunto manualmente)

Per aggiungere un server trovato al monitoraggio, è sufficiente premere il pulsante **"+ Monitora"** nella colonna azioni. I server già in monitoraggio vengono evidenziati con un indicatore apposito.

### 4.3 Aggiunta manuale di un server

Cliccando **"Aggiungi manualmente"** si apre un dialogo che consente di specificare:

- Indirizzo IP o hostname
- Porta (default 1433)
- Nome istanza (per istanze named)
- Nome macchina
- Modalità autenticazione (Windows o SQL Server con credenziali)
- Alias personalizzato
- Ambiente (On-Premise, Azure, AWS, GCP)

> **📸 SCREENSHOT DA INSERIRE:** Dialog di aggiunta manuale server con i campi compilati

---

## 5. Inventario — Vista completa del parco SQL

La sezione Inventario offre una **visione catalogata e filtrabile** di tutti i server e database monitorati. È la sezione ideale per analisi, reportistica e gestione del parco SQL.

> **📸 SCREENSHOT DA INSERIRE:** Schermata Inventario in modalità Vista Server

### 5.1 Vista Server

La modalità Vista Server mostra l'elenco di tutti i server raggruppati per macchina fisica. Per ciascun server sono visibili:

- Versione di SQL Server installata
- Alias e proprietario (referente)
- Ambiente (on-premise, cloud)
- Stato di raggiungibilità

**Filtri disponibili:**
- Ricerca testuale libera
- Ambiente (on-premise, Azure, AWS, GCP)
- Tipologia
- Stato
- Host, Alias, Referente, Versione

Cliccando su un server nella lista si naviga direttamente alla sua Dashboard di dettaglio.

La tabella supporta la **selezione multipla** per operazioni in blocco, e permette l'**esportazione in CSV** dei dati visibili con un click.

### 5.2 Vista Database

Passando alla modalità Vista Database si accede al catalogo completo di tutti i database su tutti i server. Per ciascun database sono disponibili:

| Informazione | Descrizione |
|---|---|
| **Nome database** | Nome del database su SQL Server |
| **Server** | Server di appartenenza |
| **Proprietario** | Account SQL proprietario del database |
| **Recovery Model** | Modello di recupero (FULL, SIMPLE, BULK_LOGGED) |
| **TDE** | Cifratura trasparente dei dati attiva/non attiva |
| **Compatibilità** | Livello di compatibilità SQL Server |
| **Dimensione** | Dimensione corrente del database |
| **Ultimo backup** | Data e ora dell'ultimo backup completo eseguito |
| **Alias** | Nome alternativo personalizzato |
| **Referente** | Referente applicativo assegnato |

> **📸 SCREENSHOT DA INSERIRE:** Schermata Inventario in modalità Vista Database con filtri applicati

**Filtri disponibili nella Vista Database:**
- Ricerca testuale
- Modello di recovery
- Cifratura TDE attiva/non attiva
- Livello di compatibilità
- Filtro database offline
- Filtro database senza backup recente

Anche in questa vista è disponibile l'**esportazione in CSV** dell'elenco completo o filtrato.

---

## 6. Dashboard server — Metriche in tempo reale

La Dashboard server è la schermata di **analisi approfondita** di una singola istanza SQL Server. Vi si accede cliccando su un server dalla Home Dashboard o dall'Inventario.

> **📸 SCREENSHOT DA INSERIRE:** Dashboard di un server con le tab visibili e le KPI card in primo piano

### 6.1 Intestazione e aggiornamento

In cima alla schermata compaiono il nome del server (modificabile con un alias personalizzato) e l'indirizzo IP. Sono disponibili:

- **Aggiornamento automatico** — selezionabile ogni 30 secondi, 1, 2 o 5 minuti
- **Aggiorna ora** — forza un aggiornamento immediato delle metriche

Se il server non è raggiungibile, compare un banner di avviso con l'orario dell'ultimo contatto riuscito e il pulsante per ritentare immediatamente la connessione.

### 6.2 Tab Panoramica

La prima tab mostra le metriche principali del server:

- **CPU corrente** con grafico storico andamento nel tempo
- **Memoria** utilizzata vs memoria target configurata
- **Uptime** — da quanto tempo il servizio SQL Server è in esecuzione senza riavvii
- **CPU logiche e fisiche** — configurazione hardware del server
- **Note** — campo di testo libero per annotazioni operative (es. "server in manutenzione programmata il 15/05")

> **📸 SCREENSHOT DA INSERIRE:** Tab Panoramica con grafici CPU/Memoria e campo note

### 6.3 Tab Database

Elenco completo di tutti i database presenti sull'istanza, con per ciascuno:

- Stato (ONLINE, OFFLINE, SUSPECT, ecc.) con indicatore colorato
- Modello di recovery
- Dimensione totale e dimensione log
- Cifratura TDE
- Sola lettura
- Proprietario
- Alias e referente personalizzabili

I database possono essere selezionati in blocco per modificare in una sola operazione i metadati personalizzati (alias, referente) su più database contemporaneamente.

> **📸 SCREENSHOT DA INSERIRE:** Tab Database con la tabella dei database e il menu di modifica in blocco

### 6.4 Tab Sessioni

Mostra le **sessioni SQL attive** sull'istanza in quel momento:

- ID sessione
- Stato (running, sleeping, ecc.)
- Sessione bloccante (se presente) — indica quale sessione sta bloccando le altre
- Tipo di attesa
- Tempo di attesa
- CPU e letture logiche

Questa tab è particolarmente utile per diagnosticare situazioni di blocco o rallentamento delle applicazioni.

> **📸 SCREENSHOT DA INSERIRE:** Tab Sessioni con alcune sessioni attive e l'indicatore di blocking

### 6.5 Tab Backup

Stato dei backup per ciascun database dell'istanza:

| Colonna | Descrizione |
|---|---|
| **Database** | Nome del database |
| **Ultimo Full** | Data e ora dell'ultimo backup completo |
| **Ultimo Diff** | Data e ora dell'ultimo backup differenziale |
| **Ultimo Log** | Data e ora dell'ultimo backup del log transazioni |

I backup mancanti o scaduti vengono evidenziati in rosso, rendendo immediata l'identificazione di database a rischio.

> **📸 SCREENSHOT DA INSERIRE:** Tab Backup con alcuni database con backup scaduto evidenziati in rosso

### 6.6 Tab Dischi

Monitoraggio dello spazio disco del server host:

**Volumi disco:**
- Lettera/punto di mount del volume
- Spazio totale, utilizzato e libero (in GB)
- Percentuale di spazio libero (con soglie colorate)

**File database:**
- Elenco dei file fisici (.mdf, .ldf) con dimensione, spazio utilizzato, spazio libero e configurazione di crescita automatica

> **📸 SCREENSHOT DA INSERIRE:** Tab Dischi con la lista volumi e lo spazio disponibile

### 6.7 Tab Top Query

Le query SQL più impattanti in esecuzione sull'istanza, ordinate per impatto:

- Testo della query
- Numero di esecuzioni
- Tempo medio di esecuzione (ms)
- CPU media consumata
- Letture logiche medie

Utile per identificare query problematiche da ottimizzare.

> **📸 SCREENSHOT DA INSERIRE:** Tab Top Query con l'elenco delle query più costose

### 6.8 Tab Wait Stats

Statistiche di attesa di SQL Server — indicano **su cosa sta "aspettando"** il motore database. Ogni tipo di attesa rivela una potenziale causa di rallentamento (I/O su disco, rete, lock, memoria, ecc.):

- Tipo di attesa
- Tempo totale di attesa
- Tempo massimo di attesa
- Percentuale sul totale
- Numero di task in attesa

> **📸 SCREENSHOT DA INSERIRE:** Tab Wait Stats con la lista dei tipi di attesa ordinati per percentuale

---

## 7. Avvisi — Alert e notifiche

SQLSentinel genera automaticamente avvisi quando rileva situazioni anomale. Il pannello Alert è accessibile dall'icona a campanella presente nella barra superiore in qualsiasi schermata dell'applicazione.

> **📸 SCREENSHOT DA INSERIRE:** Pannello Alert aperto lateralmente con la lista degli avvisi attivi

### 7.1 Tipi di avviso

| Categoria | Descrizione | Livello tipico |
|---|---|---|
| **CPU elevata** | Utilizzo CPU del server superiore alla soglia configurata | Warning / Critical |
| **Sessioni bloccate** | Presenza di blocking chain prolungate | Warning / Critical |
| **Database offline** | Uno o più database in stato non-ONLINE | Critical |
| **Backup scaduto** | Backup completo non eseguito da troppo tempo | Warning / Critical |
| **Spazio disco basso** | Volume disco sotto la soglia minima di spazio libero | Warning / Critical |

### 7.2 Livelli di gravità

- **WARNING** — situazione da monitorare, non ancora bloccante
- **CRITICAL** — richiede intervento immediato

### 7.3 Gestione degli avvisi

Ogni avviso mostra il server di provenienza, la categoria, il messaggio descrittivo e l'orario di rilevamento. È possibile **marcare un avviso come "preso in carico"** (acknowledge) per segnalare agli altri operatori che la situazione è già nota e gestita.

### 7.4 Notifiche esterne

SQLSentinel può inviare avvisi anche tramite:

- **Notifica di sistema Windows** — un popup nella barra di sistema compare automaticamente per alert critici, anche quando l'applicazione è minimizzata
- **Email** — invio automatico di email agli indirizzi configurati (vedere sezione Impostazioni)

---

## 8. Assistente AI

SQLSentinel integra un assistente basato su intelligenza artificiale, accessibile dall'icona dedicata nella barra superiore. Si apre come pannello laterale.

> **📸 SCREENSHOT DA INSERIRE:** Pannello AI Assistant aperto con una domanda di esempio e la risposta

L'assistente AI consente di **interrogare i dati dei server in linguaggio naturale**, senza necessità di conoscere query SQL o la struttura interna dell'applicazione. Esempi di domande:

- *"Quali server hanno la CPU sopra il 70%?"*
- *"Mostrami i database senza backup negli ultimi 7 giorni"*
- *"C'è qualche sessione bloccata in questo momento?"*
- *"Quale server ha più spazio disco libero?"*

L'assistente mantiene il contesto della conversazione, quindi è possibile fare domande di approfondimento ("e quello con meno memoria?") senza ripetere il contesto.

---

## 9. Impostazioni

La sezione Impostazioni, accessibile dall'icona a ingranaggio nella barra di navigazione laterale, raccoglie tutte le configurazioni dell'applicazione.

> **📸 SCREENSHOT DA INSERIRE:** Schermata Impostazioni completa

### 9.1 Aspetto

Selezione del tema visivo dell'interfaccia:

- **Chiaro** — interfaccia su sfondo bianco
- **Scuro** — interfaccia su sfondo scuro, consigliata per uso prolungato
- **Sistema** — segue automaticamente l'impostazione del sistema operativo

### 9.2 Conservazione dati storici

Configurazione del **periodo di retention** dei dati metrici raccolti. Valori disponibili: 15 minuti, 30 minuti, 1 ora, 3 ore, 6 ore, 12 ore.

I dati più vecchi del periodo impostato vengono eliminati automaticamente per ottimizzare le dimensioni del database locale.

### 9.3 Esportazione dati

Tre tipi di esportazione CSV disponibili con un click:

| Esportazione | Contenuto |
|---|---|
| **Campi personalizzati database** | Alias e referenti assegnati ai database |
| **Inventario server** | Elenco completo dei server con le relative informazioni |
| **Storico alert** | Registro di tutti gli avvisi generati |

### 9.4 Background e avvisi

Configurazione del comportamento quando l'interfaccia è minimizzata:

- **Mantieni attivo in background** — il servizio continua a raccogliere metriche anche a interfaccia chiusa
- **Modalità background:**
  - *Light* — raccolta dati ridotta a intervalli più lunghi (configurabile), minor impatto sulle risorse
  - *Full* — raccolta dati con la stessa frequenza del normale utilizzo
- **Notifiche di sistema** — abilita i popup Windows per alert critici in background
- **Avvio con Windows** — l'applicazione si avvia automaticamente all'accensione del PC

### 9.5 Stato del servizio

Un riquadro mostra lo stato della connessione tra l'interfaccia e il servizio in background:

- **Connesso** — il servizio è attivo e l'interfaccia riceve aggiornamenti in tempo reale
- **In connessione** — tentativo di connessione in corso
- **Disconnesso** — il servizio non è attivo o non è raggiungibile

### 9.6 Notifiche email

Configurazione del sistema di notifica via email:

| Campo | Descrizione |
|---|---|
| **Abilita email** | Attiva/disattiva l'invio delle notifiche |
| **Server SMTP** | Indirizzo del server di posta in uscita |
| **Porta SMTP** | Porta del server (tipicamente 25, 465 o 587) |
| **Utente / Password** | Credenziali di autenticazione SMTP |
| **TLS** | Attiva la cifratura della connessione al server SMTP |
| **Destinatari** | Lista degli indirizzi email che riceveranno le notifiche (max 20) |

Il pulsante **"Invia email di test"** consente di verificare la configurazione inviando immediatamente un messaggio di prova.

> **📸 SCREENSHOT DA INSERIRE:** Sezione configurazione email con i campi SMTP visibili (oscurare credenziali reali)

---

## 10. Servizio in background

Il servizio in background è un componente di SQLSentinel installato come **servizio Windows** (visibile in "Servizi" del sistema operativo come "sqlsentinel"). Opera in modo completamente autonomo, senza richiedere che un utente sia connesso al sistema.

### Cosa fa il servizio

- **Raccoglie continuamente** le metriche da tutti i server SQL configurati
- **Genera gli avvisi** in modo autonomo al verificarsi di condizioni anomale
- **Salva lo storico** dei dati nel database locale
- **Sopravvive ai riavvii** del server host — il servizio si riavvia automaticamente con Windows

### Relazione con l'interfaccia grafica

L'interfaccia grafica si connette al servizio locale all'avvio e riceve in tempo reale gli aggiornamenti. Se l'interfaccia viene chiusa, il servizio continua a lavorare in autonomia. Quando l'interfaccia viene riaperta, si riconnette e mostra immediatamente i dati aggiornati raccolti nel frattempo.

Questo modello garantisce che il monitoraggio non venga mai interrotto da operazioni ordinarie come la chiusura dell'applicazione o il riavvio della sessione utente.

---

## Appendice — Navigazione dell'interfaccia

### Barra di navigazione laterale

La barra icone sul lato sinistro è sempre visibile e consente di passare istantaneamente tra le sezioni:

| Icona | Sezione |
|---|---|
| Dashboard | Home — panoramica generale |
| Lente di ingrandimento | Discovery — ricerca server |
| Cilindri | Inventario — catalogo completo |
| Grafico | Dashboard server — metriche di dettaglio |
| Ingranaggio (in basso) | Impostazioni |

### Barra superiore

La barra in cima alla schermata contiene:

- **Breadcrumb** — indica la posizione corrente nell'applicazione
- **Icona campanella** — apre il pannello Alert con gli avvisi attivi
- **Icona AI** — apre l'assistente intelligente

### Albero server (Inventario e Dashboard)

Nelle sezioni Inventario e Dashboard compare una colonna laterale con l'**albero dei server**. Permette di navigare rapidamente tra i server e i gruppi di Availability Group (cluster ad alta disponibilità SQL Server) semplicemente cliccando sul server desiderato.

---

*Documento generato per uso interno. Per informazioni tecniche approfondite o per la procedura di installazione, fare riferimento alla documentazione tecnica separata.*
