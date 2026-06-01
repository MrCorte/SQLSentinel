'use strict'
// Launches Vitest with --experimental-vm-modules using absolute paths.
// Required on Node v24 where relative ESM module paths break Vitest's VM
// module evaluator (runner variable not set when describe() is called).
const { spawn, execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const vitestMjs = path.join(path.dirname(require.resolve('vitest')), 'vitest.mjs')

// Convert Windows path to POSIX path for git bash
const vitestPosix = vitestMjs
  .replace(/\\/g, '/')
  .replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase())
const extraArgs = process.argv.slice(2).join(' ')
const bashCmd = `node --experimental-vm-modules "${vitestPosix}" ${extraArgs}`

// Find git bash on Windows
const bashCandidates = [
  process.env.BASH,
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  '/usr/bin/bash'
]
const bashPath = bashCandidates.find((p) => p && fs.existsSync(p)) || 'bash'

const proc = spawn(bashPath, ['-c', bashCmd], { stdio: 'inherit' })
proc.on('close', (code) => process.exit(code ?? 0))
