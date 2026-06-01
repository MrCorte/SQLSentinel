// Eseguire con privilegi Administrator:
//   node install-service.cjs
// oppure tramite il pulsante "Installa Servizio" nell'app (richiede UAC elevation).
//
// Il servizio gira come LocalSystem usando ELECTRON_RUN_AS_NODE=1 con
// SQLSentinel.exe — nessun Node.js separato necessario.

const path = require('path')
const Service = require('node-windows').Service

// Quando impacchettato da electron-builder, questo script si trova in:
//   <install-dir>\resources\scripts\install-service.cjs
// L'eseguibile Electron è in:
//   <install-dir>\sqlsentinel.exe
// Il bundle del servizio è in:
//   <install-dir>\resources\service\index.js
const appDir = path.resolve(__dirname, '..', '..')   // risale da resources/scripts/ a <install-dir>
const execPath = path.join(appDir, 'sqlsentinel.exe')
const scriptPath = path.join(appDir, 'resources', 'service', 'index.js')

const svc = new Service({
  name: 'SQLSentinel Monitor',
  description: 'SQLSentinel background metrics collection service',
  script: scriptPath,
  execPath: execPath,
  env: [
    { name: 'ELECTRON_RUN_AS_NODE', value: '1' }
  ],
  maxRestarts: 3,
  wait: 1,
  grow: 0.25,
  abortOnError: false
})

svc.on('install', () => {
  svc.start()
  console.log('SQLSentinel Monitor installato e avviato.')
  console.log('Verifica: sc query "SQLSentinel Monitor"')
})

svc.on('error', (err) => {
  console.error('Errore installazione servizio:', err)
  process.exit(1)
})

svc.install()
