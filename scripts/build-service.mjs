// Bundla il service con esbuild.
// I moduli nativi restano external — sono già nel pacchetto Electron.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('out/service', { recursive: true })

await build({
  entryPoints: ['src/service/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'out/service/index.js',
  external: [
    // Native modules — già presenti nell'app packaged
    'better-sqlite3',
    'mssql',
    'tedious',
    'electron-store',
    'nodemailer',
    // Electron stesso non serve nel service
    'electron'
  ],
  sourcemap: true,
  minify: false
})

console.log('✓ Service bundle → out/service/index.js')
