/**
 * Genera docs/SQLSentinel-Presentazione.docx
 * Esegui con: node scripts/generate-doc.mjs
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, TableLayoutType, convertInchesToTwip, LevelFormat,
} from 'docx'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../docs/SQLSentinel-Presentazione.docx')

// ── Colori ─────────────────────────────────────────────────────────────────
const NAVY      = '1A3C5E'
const BLUE      = '2C5F8A'
const AMBER_BG  = 'FFF3CD'
const AMBER_TXT = '856404'
const ALT_BG    = 'EEF4FA'
const WHITE     = 'FFFFFF'
const GRAY      = '666666'
const BORDER_C  = 'B0C4D8'
const HR_C      = 'CCCCCC'

// ── Helpers testo ──────────────────────────────────────────────────────────
const t = (str, opts = {}) =>
  new TextRun({ text: str, font: 'Calibri', size: 22, ...opts })

const b = (str, color = NAVY) =>
  t(str, { bold: true, color })

// ── Paragrafo generico ─────────────────────────────────────────────────────
function p(children, extra = {}) {
  const kids = typeof children === 'string'
    ? [t(children)]
    : Array.isArray(children) ? children : [children]
  return new Paragraph({ children: kids, spacing: { after: 120 }, ...extra })
}

const blank = () => new Paragraph({ children: [], spacing: { after: 100 } })

// ── Titoli ─────────────────────────────────────────────────────────────────
function h1(str) {
  return new Paragraph({
    children: [new TextRun({ text: str, bold: true, size: 44, color: NAVY, font: 'Calibri' })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 240 },
  })
}

function h2(str) {
  return new Paragraph({
    children: [new TextRun({ text: str, bold: true, size: 30, color: NAVY, font: 'Calibri' })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 160 },
  })
}

function h3(str) {
  return new Paragraph({
    children: [new TextRun({ text: str, bold: true, size: 24, color: BLUE, font: 'Calibri' })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 100 },
  })
}

// ── Liste ──────────────────────────────────────────────────────────────────
const bullet = (children) => {
  const kids = typeof children === 'string' ? [t(children)]
    : Array.isArray(children) ? children : [children]
  return new Paragraph({ children: kids, bullet: { level: 0 }, spacing: { after: 80 } })
}

const numbered = (children) => {
  const kids = typeof children === 'string' ? [t(children)]
    : Array.isArray(children) ? children : [children]
  return new Paragraph({ children: kids, numbering: { reference: 'ol', level: 0 }, spacing: { after: 80 } })
}

// ── Separatore ─────────────────────────────────────────────────────────────
const hr = () => new Paragraph({
  children: [new TextRun({ text: ' ', size: 4 })],
  spacing: { before: 200, after: 200 },
  border: { bottom: { color: HR_C, size: 6, style: BorderStyle.SINGLE, space: 1 } },
})

// ── Riquadro screenshot ────────────────────────────────────────────────────
function screenshot(label) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top:     { style: BorderStyle.NONE },
      bottom:  { style: BorderStyle.NONE },
      left:    { style: BorderStyle.NONE },
      right:   { style: BorderStyle.NONE },
      insideH: { style: BorderStyle.NONE },
      insideV: { style: BorderStyle.NONE },
    },
    rows: [new TableRow({ children: [new TableCell({
      shading: { fill: AMBER_BG, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 160, right: 120 },
      borders: {
        top:    { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        right:  { style: BorderStyle.NONE },
        left:   { color: 'F0A800', size: 24, style: BorderStyle.SINGLE },
      },
      children: [new Paragraph({
        children: [
          new TextRun({ text: '📸  SCREENSHOT — ', bold: true, size: 20, font: 'Calibri', color: AMBER_TXT, italics: true }),
          new TextRun({ text: label, size: 20, font: 'Calibri', color: AMBER_TXT, italics: true }),
        ],
        spacing: { after: 0 },
      })],
    })] })],
  })
}

// ── Tabella dati ───────────────────────────────────────────────────────────
function tbl(headers, rows) {
  const hRow = new TableRow({
    tableHeader: true,
    children: headers.map(h => new TableCell({
      shading: { fill: NAVY, type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 100, right: 80 },
      borders: {
        top:    { color: NAVY,    size: 4, style: BorderStyle.SINGLE },
        bottom: { color: NAVY,    size: 4, style: BorderStyle.SINGLE },
        left:   { color: NAVY,    size: 4, style: BorderStyle.SINGLE },
        right:  { color: BORDER_C, size: 4, style: BorderStyle.SINGLE },
      },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: WHITE, size: 20, font: 'Calibri' })], spacing: { after: 0 } })],
    })),
  })

  const dRows = rows.map((row, ri) => new TableRow({
    children: row.map(cell => new TableCell({
      shading: { fill: ri % 2 === 1 ? ALT_BG : WHITE, type: ShadingType.CLEAR },
      margins: { top: 50, bottom: 50, left: 100, right: 80 },
      borders: {
        top:    { color: BORDER_C, size: 4, style: BorderStyle.SINGLE },
        bottom: { color: BORDER_C, size: 4, style: BorderStyle.SINGLE },
        left:   { color: BORDER_C, size: 4, style: BorderStyle.SINGLE },
        right:  { color: BORDER_C, size: 4, style: BorderStyle.SINGLE },
      },
      children: [new Paragraph({
        children: typeof cell === 'string'
          ? [new TextRun({ text: cell, size: 20, font: 'Calibri' })]
          : cell,
        spacing: { after: 0 },
      })],
    })),
  }))

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [hRow, ...dRows],
    margins: { top: 120, bottom: 120 },
  })
}

// ── Indice ─────────────────────────────────────────────────────────────────
function toc() {
  const voci = [
    '1.  Cos\'è SQLSentinel',
    '2.  Accesso all\'applicazione',
    '3.  Panoramica generale — Home Dashboard',
    '4.  Discovery — Ricerca server SQL',
    '5.  Inventario — Vista completa del parco SQL',
    '6.  Dashboard server — Metriche in tempo reale',
    '7.  Avvisi — Alert e notifiche',
    '8.  Assistente AI',
    '9.  Impostazioni',
    '10. Servizio in background',
    '11. Appendice — Navigazione dell\'interfaccia',
  ]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE },
    },
    rows: [new TableRow({ children: [new TableCell({
      shading: { fill: 'EEF4FA', type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 160, left: 200, right: 200 },
      borders: {
        top:    { color: BORDER_C, size: 6, style: BorderStyle.SINGLE },
        bottom: { color: BORDER_C, size: 6, style: BorderStyle.SINGLE },
        left:   { color: BORDER_C, size: 6, style: BorderStyle.SINGLE },
        right:  { color: BORDER_C, size: 6, style: BorderStyle.SINGLE },
      },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Indice', bold: true, size: 26, color: NAVY, font: 'Calibri' })], spacing: { after: 120 } }),
        ...voci.map(v => new Paragraph({ children: [new TextRun({ text: v, size: 20, font: 'Calibri', color: '333333' })], spacing: { after: 60 } })),
      ],
    })] })],
  })
}

// ════════════════════════════════════════════════════════════════════════════
// DOCUMENTO
// ════════════════════════════════════════════════════════════════════════════

const doc = new Document({
  numbering: {
    config: [{
      reference: 'ol',
      levels: [{
        level: 0,
        format: LevelFormat.DECIMAL,
        text: '%1.',
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 360, hanging: 260 } } },
      }],
    }],
  },
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 22, color: '222222' },
        paragraph: { spacing: { after: 120 } },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top:    convertInchesToTwip(1.0),
          bottom: convertInchesToTwip(1.0),
          left:   convertInchesToTwip(1.2),
          right:  convertInchesToTwip(1.2),
        },
      },
    },
    children: [

      // ── INTESTAZIONE ──────────────────────────────────────────────────────
      h1('SQLSentinel — Guida Funzionale'),
      p([b('Versione: ', GRAY), t('1.0.0   ', { color: GRAY }), b('Data: ', GRAY), t('aprile 2026   ', { color: GRAY }), b('Destinatari: ', GRAY), t('management, responsabili IT', { color: GRAY })]),
      blank(),
      toc(),
      hr(),

      // ── 1 ─────────────────────────────────────────────────────────────────
      h2('1. Cos\'è SQLSentinel'),
      p('SQLSentinel è un\'applicazione desktop per il monitoraggio centralizzato di istanze Microsoft SQL Server all\'interno della rete aziendale. Permette ai team IT di tenere sotto controllo in un unico punto lo stato di salute di tutti i database server, ricevere avvisi automatici in caso di anomalie e consultare lo storico delle metriche nel tempo.'),
      h3('Principali benefici'),
      tbl(['Beneficio', 'Descrizione'], [
        ['Visibilità centralizzata',  'Tutti i server SQL aziendali in un\'unica schermata, con indicatori di stato immediati'],
        ['Rilevamento automatico',    'Scansione della rete per individuare nuove istanze SQL Server senza configurazione manuale'],
        ['Monitoraggio continuo',     'Raccolta automatica di CPU, memoria, sessioni attive, spazio disco e stato backup'],
        ['Avvisi proattivi',          'Notifiche immediate (email e notifica di sistema) per situazioni critiche'],
        ['Inventario aggiornato',     'Catalogo completo di tutti i database con metadati personalizzabili'],
        ['Analisi storica',           'Grafici e dati storici per analizzare l\'andamento nel tempo'],
        ['Assistente AI',             'Interfaccia conversazionale per interrogare i dati dei server in linguaggio naturale'],
      ]),
      blank(),
      h3('Architettura semplificata'),
      p('L\'applicazione è composta da due componenti che lavorano insieme:'),
      bullet([b('Interfaccia grafica'), t(' — l\'applicazione desktop che l\'operatore utilizza quotidianamente.')]),
      bullet([b('Servizio in background'), t(' — un servizio Windows che raccoglie le metriche anche quando l\'interfaccia è chiusa, garantendo la continuità del monitoraggio anche dopo riavvii del server.')]),
      hr(),

      // ── 2 ─────────────────────────────────────────────────────────────────
      h2('2. Accesso all\'applicazione'),
      p('All\'avvio, SQLSentinel mostra una schermata di login. L\'accesso è protetto da credenziali nominali: ogni operatore ha un proprio account con username e password.'),
      blank(),
      screenshot('Schermata di login con i campi username e password visibili (oscurare eventuali dati reali)'),
      blank(),
      h3('Primo accesso'),
      p('Al primo accesso con un account appena creato, il sistema richiede obbligatoriamente il cambio password. La nuova password deve rispettare i requisiti minimi di sicurezza: almeno 8 caratteri, una lettera maiuscola e un numero.'),
      blank(),
      screenshot('Dialog di cambio password obbligatorio al primo accesso'),
      hr(),

      // ── 3 ─────────────────────────────────────────────────────────────────
      h2('3. Panoramica generale — Home Dashboard'),
      p('La Home Dashboard è la schermata principale dell\'applicazione, quella che compare immediatamente dopo il login. Offre una visione d\'insieme immediata sullo stato dell\'intero parco SQL Server monitorato.'),
      blank(),
      screenshot('Schermata Home Dashboard completa, con KPI card in alto, grafici e tabella server'),
      blank(),
      h3('3.1 Indicatori KPI'),
      p('Cinque riquadri colorati mostrano i numeri chiave. Cliccando su uno di essi la lista server si filtra automaticamente.'),
      tbl(['Indicatore', 'Significato'], [
        ['Totale server', 'Numero complessivo di istanze SQL Server monitorate'],
        ['Critici',       'Server o situazioni con alert di livello critico attivi'],
        ['Warning',       'Situazioni che richiedono attenzione ma non ancora critiche'],
        ['Offline',       'Server con database non raggiungibili o in stato anomalo'],
        ['Online',        'Server regolarmente raggiungibili e operativi'],
      ]),
      blank(),
      h3('3.2 Grafici di riepilogo'),
      bullet([b('Grafico a ciambella (Stato)'), t(' — distribuzione dei server per stato operativo (Online / Offline / Non raggiungibile).')]),
      bullet([b('Grafico a barre (CPU)'), t(' — carico CPU attuale per ciascun server; identifica immediatamente i server più carichi.')]),
      blank(),
      screenshot('Dettaglio dei grafici a ciambella e a barre'),
      blank(),
      h3('3.3 Tabella server'),
      p('Elenca tutti i server con le metriche principali in tempo reale. Cliccando su una riga si naviga alla Dashboard di dettaglio di quel server.'),
      tbl(['Colonna', 'Descrizione'], [
        ['Stato',           'Pallino colorato: verde = online, rosso = non raggiungibile, grigio = offline'],
        ['Server',          'Nome o alias del server con indirizzo IP'],
        ['CPU %',           'Utilizzo corrente della CPU (rosso se >80%, giallo se >60%)'],
        ['RAM GB',          'Memoria utilizzata dall\'istanza SQL Server'],
        ['Blocchi',         'Sessioni SQL bloccate da altre (valore ideale: 0)'],
        ['DB Offline',      'Numero di database in stato non-ONLINE su quel server'],
        ['Alert',           'Numero di avvisi critici e warning attivi'],
        ['Ultimo contatto', 'Da quanto è stato ricevuto l\'ultimo aggiornamento'],
      ]),
      hr(),

      // ── 4 ─────────────────────────────────────────────────────────────────
      h2('4. Discovery — Ricerca server SQL'),
      p('La sezione Discovery permette di individuare automaticamente le istanze SQL Server presenti in rete tramite scansione TCP, oppure di aggiungere manualmente un server noto.'),
      blank(),
      screenshot('Schermata Discovery con la configurazione della scansione e i risultati'),
      blank(),
      h3('4.1 Scansione automatica della rete'),
      numbered([b('Range IP: '), t('inserire il range da scansionare in formato CIDR (es. 192.168.1.0/24).')]),
      numbered([b('Porte aggiuntive: '), t('specificare porte oltre alla standard 1433, se necessario.')]),
      numbered([b('Parallelismo: '), t('regolare il cursore bilanciando velocità e impatto sulla rete.')]),
      numbered([b('Avvia scansione: '), t('una barra mostra host verificati e istanze trovate in tempo reale.')]),
      blank(),
      screenshot('Barra di avanzamento della scansione con contatori'),
      blank(),
      h3('4.2 Risultati della scansione'),
      p('I server trovati compaiono in tabella con indirizzo IP, porta, stato, tempo di risposta e tipo di rilevamento. Per aggiungere al monitoraggio premere "+ Monitora". I server già monitorati sono evidenziati con un indicatore apposito.'),
      h3('4.3 Aggiunta manuale di un server'),
      p('Cliccando "Aggiungi manualmente" si specifica: indirizzo IP o hostname, porta, nome istanza, modalità di autenticazione (Windows Auth o credenziali SQL), alias e ambiente (On-Premise, Azure, AWS, GCP).'),
      blank(),
      screenshot('Dialog di aggiunta manuale server con i campi compilati'),
      hr(),

      // ── 5 ─────────────────────────────────────────────────────────────────
      h2('5. Inventario — Vista completa del parco SQL'),
      p('La sezione Inventario offre una visione catalogata e filtrabile di tutti i server e database monitorati. È la sezione ideale per analisi, reportistica e gestione del parco SQL.'),
      blank(),
      screenshot('Schermata Inventario in modalità Vista Server'),
      blank(),
      h3('5.1 Vista Server'),
      p('Mostra l\'elenco di tutti i server raggruppati per macchina fisica, con versione di SQL Server, alias, proprietario (referente), ambiente e stato di raggiungibilità.'),
      p([b('Filtri disponibili: '), t('ricerca testuale, ambiente, tipologia, stato, host, alias, referente, versione.')]),
      p('Cliccando su un server si naviga alla sua Dashboard di dettaglio. La tabella supporta la selezione multipla per operazioni in blocco e l\'esportazione in CSV con un click.'),
      h3('5.2 Vista Database'),
      p('Catalogo completo di tutti i database su tutti i server monitorati.'),
      tbl(['Informazione', 'Descrizione'], [
        ['Nome database',    'Nome del database su SQL Server'],
        ['Server',           'Server di appartenenza'],
        ['Proprietario',     'Account SQL proprietario del database'],
        ['Recovery Model',   'Modello di recupero (FULL, SIMPLE, BULK_LOGGED)'],
        ['TDE',              'Cifratura trasparente dei dati attiva / non attiva'],
        ['Compatibilità',    'Livello di compatibilità SQL Server (es. SQL 2019 = 150)'],
        ['Dimensione',       'Dimensione corrente del database'],
        ['Ultimo backup',    'Data e ora dell\'ultimo backup completo eseguito'],
        ['Alias / Referente','Metadati personalizzati assegnabili dall\'operatore'],
      ]),
      blank(),
      screenshot('Schermata Inventario in modalità Vista Database con filtri applicati'),
      blank(),
      p([b('Filtri disponibili: '), t('ricerca testuale, modello di recovery, cifratura TDE, livello di compatibilità, database offline, database senza backup recente.')]),
      hr(),

      // ── 6 ─────────────────────────────────────────────────────────────────
      h2('6. Dashboard server — Metriche in tempo reale'),
      p('La Dashboard server è la schermata di analisi approfondita di una singola istanza SQL Server. Vi si accede cliccando su un server dalla Home Dashboard o dall\'Inventario.'),
      blank(),
      screenshot('Dashboard di un server con le tab visibili e le KPI card in primo piano'),
      blank(),
      h3('6.1 Intestazione e aggiornamento'),
      p('In cima compaiono il nome del server (modificabile con alias) e l\'indirizzo IP. Sono disponibili l\'aggiornamento automatico (ogni 30 s, 1, 2 o 5 minuti) e il pulsante "Aggiorna ora". Se il server non è raggiungibile compare un banner di avviso con il tasto per ritentare.'),
      h3('6.2 Tab Panoramica'),
      p('Metriche principali: CPU corrente con grafico storico, memoria utilizzata vs memoria target, uptime del servizio SQL Server, configurazione hardware (CPU logiche e fisiche) e campo note libero per annotazioni operative.'),
      blank(),
      screenshot('Tab Panoramica con grafici CPU/Memoria e campo note'),
      blank(),
      h3('6.3 Tab Database'),
      p('Elenco completo dei database dell\'istanza con stato (ONLINE / OFFLINE / SUSPECT), dimensioni, modello di recovery, cifratura TDE, proprietario e metadati personalizzabili. Supporta la selezione multipla per modificare alias e referente su più database in un\'unica operazione.'),
      blank(),
      screenshot('Tab Database con la tabella dei database e il menu di modifica in blocco'),
      blank(),
      h3('6.4 Tab Sessioni'),
      p('Sessioni SQL attive: ID sessione, stato, sessione bloccante (se presente), tipo di attesa, tempo di attesa, CPU e letture logiche. Utile per diagnosticare situazioni di blocco o rallentamento delle applicazioni.'),
      blank(),
      screenshot('Tab Sessioni con alcune sessioni attive e l\'indicatore di blocking'),
      blank(),
      h3('6.5 Tab Backup'),
      p('Stato dei backup per ciascun database. I backup mancanti o scaduti vengono evidenziati in rosso.'),
      tbl(['Colonna', 'Descrizione'], [
        ['Database',    'Nome del database'],
        ['Ultimo Full', 'Data e ora dell\'ultimo backup completo'],
        ['Ultimo Diff', 'Data e ora dell\'ultimo backup differenziale'],
        ['Ultimo Log',  'Data e ora dell\'ultimo backup del log transazioni'],
      ]),
      blank(),
      screenshot('Tab Backup con alcuni database con backup scaduto evidenziati in rosso'),
      blank(),
      h3('6.6 Tab Dischi'),
      p('Monitoraggio dello spazio disco: volumi fisici con spazio totale, utilizzato e libero (con soglie colorate), e file fisici dei database (.mdf, .ldf) con dimensione e configurazione di crescita automatica.'),
      blank(),
      screenshot('Tab Dischi con la lista volumi e lo spazio disponibile'),
      blank(),
      h3('6.7 Tab Top Query'),
      p('Le query SQL più impattanti: testo, numero di esecuzioni, tempo medio di esecuzione (ms), CPU media consumata, letture logiche medie. Utile per identificare query problematiche da ottimizzare.'),
      blank(),
      screenshot('Tab Top Query con l\'elenco delle query più costose'),
      blank(),
      h3('6.8 Tab Wait Stats'),
      p('Statistiche di attesa di SQL Server: indicano su cosa sta "aspettando" il motore database. Ogni tipo di attesa rivela una potenziale causa di rallentamento (I/O su disco, rete, lock, memoria, ecc.). Vengono mostrati tipo, tempo totale, percentuale sul totale e numero di task in attesa.'),
      blank(),
      screenshot('Tab Wait Stats con la lista dei tipi di attesa ordinati per percentuale'),
      hr(),

      // ── 7 ─────────────────────────────────────────────────────────────────
      h2('7. Avvisi — Alert e notifiche'),
      p('SQLSentinel genera automaticamente avvisi quando rileva situazioni anomale. Il pannello Alert è accessibile dall\'icona a campanella presente nella barra superiore in qualsiasi schermata.'),
      blank(),
      screenshot('Pannello Alert aperto lateralmente con la lista degli avvisi attivi'),
      blank(),
      h3('7.1 Tipi di avviso'),
      tbl(['Categoria', 'Descrizione', 'Livello tipico'], [
        ['CPU elevata',       'Utilizzo CPU del server superiore alla soglia configurata',   'Warning / Critical'],
        ['Sessioni bloccate', 'Presenza di blocking chain prolungate',                       'Warning / Critical'],
        ['Database offline',  'Uno o più database in stato non-ONLINE',                      'Critical'],
        ['Backup scaduto',    'Backup completo non eseguito da troppo tempo',                'Warning / Critical'],
        ['Spazio disco basso','Volume disco sotto la soglia minima di spazio libero',        'Warning / Critical'],
      ]),
      blank(),
      h3('7.2 Livelli di gravità'),
      bullet([b('WARNING'), t(' — situazione da monitorare, non ancora bloccante.')]),
      bullet([b('CRITICAL'), t(' — richiede intervento immediato.')]),
      h3('7.3 Gestione degli avvisi'),
      p('Ogni avviso mostra server di provenienza, categoria, messaggio e orario di rilevamento. È possibile marcare un avviso come "preso in carico" per segnalare agli altri operatori che la situazione è già nota e gestita.'),
      h3('7.4 Notifiche esterne'),
      bullet([b('Notifica di sistema Windows'), t(' — popup automatico per alert critici, anche con l\'applicazione minimizzata.')]),
      bullet([b('Email'), t(' — invio automatico agli indirizzi configurati (vedere sezione 9).')]),
      hr(),

      // ── 8 ─────────────────────────────────────────────────────────────────
      h2('8. Assistente AI'),
      p('SQLSentinel integra un assistente basato su intelligenza artificiale, accessibile dall\'icona dedicata nella barra superiore. Si apre come pannello laterale e consente di interrogare i dati dei server in linguaggio naturale, senza necessità di conoscere query SQL o la struttura interna dell\'applicazione.'),
      blank(),
      screenshot('Pannello AI Assistant aperto con una domanda di esempio e la risposta'),
      blank(),
      p('Esempi di domande:'),
      bullet(t('"Quali server hanno la CPU sopra il 70%?"', { italics: true })),
      bullet(t('"Mostrami i database senza backup negli ultimi 7 giorni"', { italics: true })),
      bullet(t('"C\'è qualche sessione bloccata in questo momento?"', { italics: true })),
      bullet(t('"Quale server ha più spazio disco libero?"', { italics: true })),
      p('L\'assistente mantiene il contesto della conversazione: è possibile fare domande di approfondimento senza ripetere il contesto ogni volta.'),
      hr(),

      // ── 9 ─────────────────────────────────────────────────────────────────
      h2('9. Impostazioni'),
      p('La sezione Impostazioni, accessibile dall\'icona a ingranaggio nella barra di navigazione laterale, raccoglie tutte le configurazioni dell\'applicazione.'),
      blank(),
      screenshot('Schermata Impostazioni completa'),
      blank(),
      h3('9.1 Aspetto'),
      p([b('Chiaro'), t(', '), b('Scuro'), t(' (consigliato per uso prolungato) o '), b('Sistema'), t(' (segue automaticamente l\'impostazione di Windows).')]),
      h3('9.2 Conservazione dati storici'),
      p('Configurazione del periodo di retention dei dati metrici raccolti (da 15 minuti a 12 ore). I dati più vecchi del periodo impostato vengono eliminati automaticamente per ottimizzare le dimensioni del database locale.'),
      h3('9.3 Esportazione dati'),
      tbl(['Esportazione', 'Contenuto'], [
        ['Campi personalizzati database', 'Alias e referenti assegnati ai database'],
        ['Inventario server',             'Elenco completo dei server con le relative informazioni'],
        ['Storico alert',                 'Registro di tutti gli avvisi generati'],
      ]),
      blank(),
      h3('9.4 Background e avvisi'),
      bullet([b('Mantieni attivo in background'), t(' — il servizio continua a raccogliere metriche anche con l\'interfaccia chiusa.')]),
      bullet([b('Modalità Light'), t(' — raccolta dati a intervalli più lunghi, minor impatto sulle risorse.')]),
      bullet([b('Modalità Full'), t(' — raccolta dati con la stessa frequenza del normale utilizzo.')]),
      bullet([b('Notifiche di sistema'), t(' — popup Windows per alert critici in background.')]),
      bullet([b('Avvio con Windows'), t(' — l\'applicazione si avvia automaticamente all\'accensione del PC.')]),
      h3('9.5 Stato del servizio'),
      p('Un riquadro dedicato mostra lo stato della connessione tra l\'interfaccia e il servizio in background: Connesso, In connessione o Disconnesso.'),
      h3('9.6 Notifiche email'),
      tbl(['Campo', 'Descrizione'], [
        ['Abilita email',    'Attiva / disattiva l\'invio delle notifiche'],
        ['Server SMTP',      'Indirizzo del server di posta in uscita'],
        ['Porta SMTP',       'Porta del server (tipicamente 25, 465 o 587)'],
        ['Utente / Password','Credenziali di autenticazione SMTP'],
        ['TLS',              'Attiva la cifratura della connessione al server SMTP'],
        ['Destinatari',      'Lista degli indirizzi email che riceveranno le notifiche (max 20)'],
      ]),
      blank(),
      p('Il pulsante "Invia email di test" consente di verificare la configurazione inviando immediatamente un messaggio di prova.'),
      blank(),
      screenshot('Sezione configurazione email con i campi SMTP visibili (oscurare credenziali reali)'),
      hr(),

      // ── 10 ────────────────────────────────────────────────────────────────
      h2('10. Servizio in background'),
      p('Il servizio in background è un componente di SQLSentinel installato come servizio Windows (visibile in "Servizi" del sistema operativo come "sqlsentinel"). Opera in modo completamente autonomo, senza richiedere che un utente sia connesso al sistema.'),
      h3('Cosa fa il servizio'),
      bullet([b('Raccoglie continuamente'), t(' le metriche da tutti i server SQL configurati.')]),
      bullet([b('Genera gli avvisi'), t(' in modo autonomo al verificarsi di condizioni anomale.')]),
      bullet([b('Salva lo storico'), t(' dei dati nel database locale.')]),
      bullet([b('Sopravvive ai riavvii'), t(' del server host — si riavvia automaticamente con Windows.')]),
      h3('Relazione con l\'interfaccia grafica'),
      p('L\'interfaccia grafica si connette al servizio locale all\'avvio e riceve in tempo reale gli aggiornamenti. Se l\'interfaccia viene chiusa, il servizio continua a lavorare in autonomia. Quando viene riaperta, si riconnette e mostra immediatamente i dati aggiornati raccolti nel frattempo.'),
      p('Questo modello garantisce che il monitoraggio non venga mai interrotto da operazioni ordinarie come la chiusura dell\'applicazione o il riavvio della sessione utente.'),
      hr(),

      // ── 11 ────────────────────────────────────────────────────────────────
      h2('11. Appendice — Navigazione dell\'interfaccia'),
      h3('Barra di navigazione laterale'),
      p('La barra icone sul lato sinistro è sempre visibile e consente di passare istantaneamente tra le sezioni principali.'),
      tbl(['Icona', 'Sezione'], [
        ['Dashboard',            'Home — panoramica generale'],
        ['Lente di ingrandimento','Discovery — ricerca server'],
        ['Cilindri (database)',  'Inventario — catalogo completo'],
        ['Grafico a barre',      'Dashboard server — metriche di dettaglio'],
        ['Ingranaggio (in basso)','Impostazioni'],
      ]),
      blank(),
      h3('Barra superiore'),
      p('La barra in cima alla schermata contiene il breadcrumb con la posizione corrente, l\'icona campanella per il pannello Alert e l\'icona AI per l\'assistente intelligente.'),
      h3('Albero server (pannello laterale)'),
      p('Nelle sezioni Inventario e Dashboard compare una colonna laterale con l\'albero dei server. Permette di navigare rapidamente tra i server e i gruppi di Availability Group (cluster ad alta disponibilità SQL Server) cliccando sul nodo desiderato.'),
      blank(),
      p([t('Documento generato per uso interno — SQLSentinel v1.0.0 — aprile 2026', { color: GRAY, italics: true })]),
    ],
  }],
})

Packer.toBuffer(doc).then(buf => {
  writeFileSync(OUT, buf)
  console.log('✓ Documento generato:', OUT)
  console.log('  Dimensione:', (buf.length / 1024).toFixed(0), 'KB')
})
