import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface ServiceConfig {
  port: number
  secret: string
}

function getConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'sqlsentinel')
  }
  if (process.platform === 'darwin') {
    return join(process.env['HOME'] ?? '.', 'Library', 'Application Support', 'sqlsentinel')
  }
  return join(process.env['HOME'] ?? '.', '.config', 'sqlsentinel')
}

export const CONFIG_DIR = getConfigDir()
export const CONFIG_PATH = join(CONFIG_DIR, 'service.json')

export function loadOrCreateConfig(): ServiceConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ServiceConfig
  } catch {
    const config: ServiceConfig = {
      port: 57432,
      secret: randomBytes(32).toString('hex')
    }
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return config
  }
}
