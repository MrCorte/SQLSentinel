'use strict'
// Removes ELECTRON_RUN_AS_NODE before spawning electron-vite dev.
// VSCode terminals inject ELECTRON_RUN_AS_NODE=1 which makes Electron run as
// plain Node.js, breaking require('electron') in the main process.
const { spawn } = require('child_process')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const proc = spawn(
  process.execPath,
  ['node_modules/electron-vite/bin/electron-vite.js', 'dev'],
  { stdio: 'inherit', env }
)

proc.on('close', (code) => process.exit(code ?? 0))
