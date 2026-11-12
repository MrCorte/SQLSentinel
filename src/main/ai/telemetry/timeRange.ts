// ---------------------------------------------------------------------------
// Estrazione della finestra temporale dalla domanda (IT + EN).
//
// È il "query understanding" del RAG sulla telemetria: prima di cercare
// qualcosa nello storico bisogna capire QUANDO. "Perché PROD01 era lento
// stanotte?" → filtro strutturato sulla finestra 22:00–07:00, non ricerca
// semantica cieca su tutti i digest.
//
// Tutti i calcoli usano l'ora locale del processo main (= quella dell'utente,
// app desktop): "alle 15" significa le 15 dell'utente, non UTC.
// ---------------------------------------------------------------------------

export interface TimeRange {
  from: Date
  to: Date
  /** Etichetta leggibile, usata nell'intestazione del blocco di contesto. */
  label: string
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function atHour(day: Date, h: number, m = 0): Date {
  const x = new Date(day)
  x.setHours(h, m, 0, 0)
  return x
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b
}

const NUM_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  a: 1,
  an: 1,
  one: 1,
  due: 2,
  two: 2,
  tre: 3,
  three: 3,
  quattro: 4,
  four: 4,
  cinque: 5,
  five: 5,
  sei: 6,
  six: 6,
  dodici: 12,
  twelve: 12,
  ventiquattro: 24
}

function toNum(raw: string): number | null {
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return n
  return NUM_WORDS[raw.toLowerCase()] ?? null
}

/**
 * Restituisce la finestra temporale citata nella domanda, oppure null se la
 * domanda non contiene riferimenti temporali riconoscibili.
 */
export function parseTimeRange(question: string, now: Date = new Date()): TimeRange | null {
  const q = question.toLowerCase()
  const today = startOfDay(now)
  const yesterday = new Date(today.getTime() - DAY)
  const mentionsYesterday = /\b(ieri|yesterday)\b/.test(q)
  const refDay = mentionsYesterday ? yesterday : today

  // "alle 15", "alle 15:30", "verso le 9", "at 3pm", "at 15:00", "around 14"
  const at =
    q.match(
      /\b(?:alle|verso le|intorno alle|attorno alle|at|around)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/
    ) ?? null
  if (at) {
    let h = Number(at[1])
    const m = at[2] ? Number(at[2]) : 0
    if (at[3] === 'pm' && h < 12) h += 12
    if (at[3] === 'am' && h === 12) h = 0
    if (h <= 23 && m <= 59) {
      let center = atHour(refDay, h, m)
      // "alle 15" detto alle 10 senza "ieri" → le 15 di ieri
      if (!mentionsYesterday && center.getTime() > now.getTime()) {
        center = new Date(center.getTime() - DAY)
      }
      return {
        from: new Date(center.getTime() - HOUR),
        to: minDate(new Date(center.getTime() + HOUR), now),
        label: `around ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${
          center.getTime() < today.getTime() ? ' yesterday' : ' today'
        }`
      }
    }
  }

  // "3 ore fa", "two hours ago" → finestra ±1h attorno a quel momento
  const ago = q.match(
    /\b(\d+|un|una|due|tre|quattro|cinque|sei|one|two|three|four|five|six|an|a)\s+(ore|ora|hours?)\s+(fa|ago)\b/
  )
  if (ago) {
    const n = toNum(ago[1])
    if (n) {
      const center = now.getTime() - n * HOUR
      return {
        from: new Date(center - HOUR),
        to: new Date(Math.min(center + HOUR, now.getTime())),
        label: `around ${n}h ago`
      }
    }
  }

  // "ultime 6 ore", "last 12 hours", "past 3 hours", "nelle ultime due ore"
  const lastHours = q.match(
    /\b(?:ultim[ei]|last|past)\s+(\d+|due|tre|quattro|cinque|sei|dodici|ventiquattro|two|three|four|five|six|twelve)\s+(?:ore|hours?)\b/
  )
  if (lastHours) {
    const n = toNum(lastHours[1])
    if (n) return { from: new Date(now.getTime() - n * HOUR), to: now, label: `last ${n}h` }
  }
  if (/\b(ultima ora|last hour|past hour)\b/.test(q)) {
    return { from: new Date(now.getTime() - HOUR), to: now, label: 'last hour' }
  }

  // "ultimi 3 giorni", "last 2 days"
  const lastDays = q.match(
    /\b(?:ultimi|last|past)\s+(\d+|due|tre|quattro|cinque|sei|two|three|four|five|six)\s+(?:giorni|days?)\b/
  )
  if (lastDays) {
    const n = toNum(lastDays[1])
    if (n) return { from: new Date(now.getTime() - n * DAY), to: now, label: `last ${n} days` }
  }

  if (
    /\b(settimana scorsa|ultima settimana|ultimi sette giorni|last week|past week|this week|questa settimana)\b/.test(
      q
    )
  ) {
    return { from: new Date(now.getTime() - 7 * DAY), to: now, label: 'last 7 days' }
  }

  // Parti del giorno
  if (
    /\b(stanotte|questa notte|ieri notte|ieri sera|stasera|last night|tonight|overnight|nella notte|durante la notte)\b/.test(
      q
    )
  ) {
    // "stanotte" / "ieri notte" = la notte appena passata: ieri 22:00 → oggi 07:00
    // (o fino ad ora, se siamo ancora prima delle 07).
    return {
      from: atHour(yesterday, 22),
      to: minDate(atHour(today, 7), now),
      label: 'last night (22:00–07:00)'
    }
  }
  if (/\b(stamattina|questa mattina|stamani|this morning|in mattinata)\b/.test(q)) {
    const day = mentionsYesterday ? yesterday : today
    return {
      from: atHour(day, 6),
      to: minDate(atHour(day, 12), now),
      label: 'morning (06:00–12:00)'
    }
  }
  if (
    /\b(oggi pomeriggio|questo pomeriggio|nel pomeriggio|this afternoon|in the afternoon)\b/.test(q)
  ) {
    const day = mentionsYesterday ? yesterday : today
    return {
      from: atHour(day, 12),
      to: minDate(atHour(day, 18), now),
      label: 'afternoon (12:00–18:00)'
    }
  }

  if (mentionsYesterday) {
    return { from: yesterday, to: today, label: 'yesterday' }
  }
  if (/\b(oggi|today|da stamattina|since this morning)\b/.test(q)) {
    return { from: today, to: now, label: 'today' }
  }

  return null
}

/**
 * La domanda chiede un confronto col passato ("è normale?", "è già successo?")?
 * In quel caso il retrieval aggiunge baseline ed episodi simili anche senza
 * una finestra temporale esplicita.
 */
export function asksForHistory(question: string): boolean {
  return /\b(già successo|gia successo|succede spesso|di solito|solitamente|normale|al solito|rispetto al solito|ricorrent\w*|ripetut\w*|ancora|di nuovo|trend|andamento|storico|pattern|baseline|confronta\w*|precedent\w*|happened before|again|usually|normal|typical|recurring|history|historical|compared?)\b/i.test(
    question
  )
}
