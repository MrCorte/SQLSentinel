import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'

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

// On Windows, ProgramData inherits ACL granting Read/Execute to the local Users
// group — meaning any local user could read the bearer secret. We tighten ACL to
// SYSTEM + Administrators only via icacls, removing inheritance.
function lockDownPathWindows(path: string): void {
  if (process.platform !== 'win32') return
  try {
    execFileSync('icacls', [path, '/inheritance:r'], { stdio: 'ignore' })
    execFileSync('icacls', [path, '/grant:r', 'SYSTEM:(F)', 'Administrators:(F)'], {
      stdio: 'ignore'
    })
  } catch {
    // icacls failures are non-fatal — file still exists with default ACL; we
    // log nothing here (this module runs in the service, not the GUI). The main
    // process emits a one-time warning if the file is world-readable.
  }
}

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
    // POSIX: 0o600 (owner read/write only). Windows: ignored; we rely on icacls.
    if (process.platform !== 'win32') {
      try {
        chmodSync(CONFIG_PATH, 0o600)
      } catch {
        // best-effort
      }
    } else {
      lockDownPathWindows(CONFIG_DIR)
      lockDownPathWindows(CONFIG_PATH)
    }
    return config
  }
}
