import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('preload bridge surface', () => {
  it('does not expose generic Electron IPC APIs to the renderer', () => {
    const source = readFileSync(resolve(__dirname, '../index.ts'), 'utf8')

    expect(source).not.toContain("exposeInMainWorld('electron'")
    expect(source).not.toContain('window.electron')
    expect(source).not.toContain('electronAPI')
  })
})
