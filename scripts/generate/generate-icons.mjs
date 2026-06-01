/**
 * Genera build/icon.png (1024×1024) e build/icon.ico (multi-size) dal logo SVG.
 * build/icon.icns viene lasciato al build macOS (electron-builder lo crea da icon.png).
 *
 * Uso: node scripts/generate-icons.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const svgPath = join(root, 'img', 'sql-sentinel-glyph.svg')
const svgBuffer = readFileSync(svgPath)

// --- PNG 1024×1024 per Linux e come sorgente per ICO/ICNS ---
const png1024 = await sharp(svgBuffer).resize(1024, 1024).png().toBuffer()
writeFileSync(join(root, 'build', 'icon.png'), png1024)
console.log('✓ build/icon.png (1024×1024)')

// --- ICO multi-size per Windows ---
// Formato ICO: ICONDIR + ICONDIRENTRY[] + immagini PNG embedded
// Windows Vista+ supporta PNG compresso dentro .ico
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngBuffers = await Promise.all(
  sizes.map((s) => sharp(svgBuffer).resize(s, s).png().toBuffer())
)

// ICONDIR (6 byte)
const iconDir = Buffer.alloc(6)
iconDir.writeUInt16LE(0, 0)          // reserved
iconDir.writeUInt16LE(1, 2)          // type = 1 (ICO)
iconDir.writeUInt16LE(sizes.length, 4) // image count

// ICONDIRENTRY: 16 byte ciascuno
const headerSize = 6 + 16 * sizes.length
const entries = Buffer.alloc(16 * sizes.length)
let offset = headerSize
for (let i = 0; i < sizes.length; i++) {
  const s = sizes[i]
  const buf = pngBuffers[i]
  entries.writeUInt8(s >= 256 ? 0 : s, i * 16)    // width  (0 = 256)
  entries.writeUInt8(s >= 256 ? 0 : s, i * 16 + 1) // height
  entries.writeUInt8(0, i * 16 + 2)                 // color count
  entries.writeUInt8(0, i * 16 + 3)                 // reserved
  entries.writeUInt16LE(1, i * 16 + 4)              // color planes
  entries.writeUInt16LE(32, i * 16 + 6)             // bits per pixel
  entries.writeUInt32LE(buf.length, i * 16 + 8)     // size of image data
  entries.writeUInt32LE(offset, i * 16 + 12)        // offset of image data
  offset += buf.length
}

const ico = Buffer.concat([iconDir, entries, ...pngBuffers])
writeFileSync(join(root, 'build', 'icon.ico'), ico)
console.log('✓ build/icon.ico (16/24/32/48/64/128/256 px)')

// build/icon.icns: electron-builder genera automaticamente l'ICNS da icon.png
// durante npm run build:mac — non serve generarlo su Windows.
console.log('ℹ  build/icon.icns: generato automaticamente da electron-builder in fase di build macOS')
