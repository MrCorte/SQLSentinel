let _app: { isPackaged?: boolean } | undefined
try {
  _app = require('electron').app
} catch {
  _app = undefined
}

type Level = 'debug' | 'info' | 'warn' | 'error'

const isDev = !_app?.isPackaged

function stamp(): string {
  return new Date().toISOString()
}

function write(level: Level, scope: string, msg: string, ...args: unknown[]): void {
  if (level === 'debug' && !isDev) return
  const line = `[${stamp()}] [${level.toUpperCase()}] [${scope}] ${msg}`
  if (level === 'error') console.error(line, ...args)
  else if (level === 'warn') console.warn(line, ...args)
  else console.log(line, ...args)
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => write('debug', scope, msg, ...args),
    info: (msg: string, ...args: unknown[]) => write('info', scope, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => write('warn', scope, msg, ...args),
    error: (msg: string, ...args: unknown[]) => write('error', scope, msg, ...args)
  }
}
