'use strict'
// Removes ELECTRON_RUN_AS_NODE before spawning electron-vite dev.
// VSCode terminals inject ELECTRON_RUN_AS_NODE=1 which makes Electron run as
// plain Node.js, breaking require('electron') in the main process.
const { spawn } = require('child_process')
const { build } = require('esbuild')
const { mkdirSync } = require('fs')

;(async () => {
  mkdirSync('out/service', { recursive: true })
  await build({
    entryPoints: ['src/service/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'out/service/index.js',
    external: [
      'better-sqlite3',
      'mssql',
      'tedious',
      'electron-store',
      'nodemailer',
      'electron'
    ],
    sourcemap: true,
    minify: false
  })

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const proc = spawn(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'dev'], {
    stdio: 'inherit',
    env
  })

  // Forward Ctrl+C / SIGTERM to the child so Electron shuts down cleanly.
  const forward = (sig) => { try { proc.kill(sig) } catch {} }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)

  proc.on('close', (code) => process.exit(code ?? 0))
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
