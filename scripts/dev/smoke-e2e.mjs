/**
 * Smoke test E2E: avvia l'app BUILDATA e verifica le invarianti che i test
 * unitari non possono vedere (questa classe di bug — storage morto al boot,
 * migration rotte, renderer bianco — è emersa solo eseguendo l'app vera).
 *
 * Verifica:
 *   1. il main process parte e inizializza lo storage senza errori
 *   2. le migration risultano applicate (nessun "Storage pool init failed")
 *   3. il renderer carica e mostra la UI (login o app, non pagina bianca)
 *
 * Prerequisiti: `npm run build` già eseguito; uno storage SQL Server
 * raggiungibile e configurato in userData (come in dev locale). In CI:
 * container SQL Server + storage config pre-seedata + xvfb su Linux.
 *
 * Uso:  node scripts/dev/smoke-e2e.mjs
 * Exit: 0 = ok, 1 = fallito (motivo su stderr)
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const CDP_PORT = 9333
const BOOT_TIMEOUT_MS = 60_000

function fail(msg) {
  console.error('SMOKE FAIL: ' + msg)
  process.exitCode = 1
}

const child = spawn('npx', ['electron', '.', `--remote-debugging-port=${CDP_PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
})
let mainLog = ''
child.stdout.on('data', (d) => (mainLog += d.toString()))
child.stderr.on('data', (d) => (mainLog += d.toString()))

try {
  // 1+2 — boot del main: aspetta il segnale di vita, poi controlla gli errori fatali
  const bootDeadline = Date.now() + BOOT_TIMEOUT_MS
  let booted = false
  while (Date.now() < bootDeadline) {
    if (/model warm-up complete|\[main\]/.test(mainLog)) booted = true
    if (booted) break
    await delay(1000)
  }
  if (!booted) throw new Error('main process: nessun segnale di boot entro ' + BOOT_TIMEOUT_MS + 'ms')

  // Lascia finire l'init dello storage, poi valuta gli errori
  await delay(8000)
  if (/Storage pool init failed/.test(mainLog)) {
    throw new Error('storage init FALLITO (migration/schema rotti):\n' +
      mainLog.split('\n').filter((l) => /Storage pool init failed|Migration/.test(l)).join('\n'))
  }

  // 3 — renderer vivo: pagina raggiungibile via CDP e con contenuto
  const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json())
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'))
  if (!page) throw new Error('renderer: nessuna pagina CDP trovata')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
  const result = await new Promise((res, rej) => {
    ws.on('message', (d) => {
      const m = JSON.parse(d)
      if (m.id === 1) res(m.result)
    })
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: 'document.body ? document.body.innerText.slice(0, 300) : ""',
        returnByValue: true
      }
    }))
    setTimeout(() => rej(new Error('renderer: evaluate timeout')), 10_000)
  })
  ws.close()

  const body = result?.result?.value ?? ''
  if (body.trim().length === 0) {
    throw new Error('renderer: pagina BIANCA (CSP/bundle rotti?)')
  }
  if (!/Sign in|Overview|SQL Sentinel|Storage/i.test(body)) {
    throw new Error('renderer: contenuto inatteso: ' + JSON.stringify(body.slice(0, 120)))
  }

  console.log('SMOKE OK — main boot pulito, storage inizializzato, renderer vivo')
  console.log('renderer mostra: ' + JSON.stringify(body.slice(0, 60)))
} catch (err) {
  fail(err.message)
} finally {
  child.kill('SIGTERM')
  await delay(1500)
  child.kill('SIGKILL')
}
