const path = require('path')
const Service = require('node-windows').Service

const appDir = path.resolve(__dirname, '..', '..')
const scriptPath = path.join(appDir, 'resources', 'service', 'index.js')

const svc = new Service({
  name: 'SQLSentinel Monitor',
  script: scriptPath
})

svc.on('uninstall', () => {
  console.log('SQLSentinel Monitor disinstallato.')
})

svc.on('error', (err) => {
  console.error('Errore disinstallazione:', err)
  process.exit(1)
})

svc.uninstall()
