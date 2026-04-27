import { describe, it, expect, vi } from 'vitest'

const tmpDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('node:os') as typeof import('node:os')
  return join(tmpdir(), `sqlsentinel-test-${Date.now()}`)
})

vi.mock('../serviceConfig', async () => {
  const { randomBytes } = await import('node:crypto')
  const { join } = await import('node:path')
  const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
  const CONFIG_PATH = join(tmpDir, 'service.json')
  function loadOrCreateConfig() {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    } catch {
      const config = { port: 57432, secret: randomBytes(32).toString('hex') }
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
      return config
    }
  }
  return { loadOrCreateConfig, CONFIG_PATH }
})

import { loadOrCreateConfig } from '../serviceConfig'

describe('loadOrCreateConfig', () => {
  it('creates config with valid port and 64-char hex secret when file missing', () => {
    const cfg = loadOrCreateConfig()
    expect(cfg.port).toBe(57432)
    expect(cfg.secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns same secret on second call (reads from disk)', () => {
    const first = loadOrCreateConfig()
    const second = loadOrCreateConfig()
    expect(first.secret).toBe(second.secret)
  })
})
