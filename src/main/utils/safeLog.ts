import { homedir } from 'node:os'

const HOME = homedir()
// Win32 userprofile can come in several casings; match any drive letter + Users\<name>
const USERPROFILE_RE = /[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi
// Unix-style home path
const UNIX_HOME_RE = HOME ? new RegExp(escapeRegex(HOME), 'g') : null

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strip absolute paths and OS usernames from a string. */
export function redactPaths(s: string): string {
  let out = s.replace(USERPROFILE_RE, '%USERPROFILE%')
  if (UNIX_HOME_RE) out = out.replace(UNIX_HOME_RE, '~')
  return out
}

/** Produce a log-safe representation of an unknown error value. */
export function safeError(err: unknown): string {
  if (err instanceof Error) {
    const base = err.stack ?? `${err.name}: ${err.message}`
    return redactPaths(base)
  }
  if (typeof err === 'string') return redactPaths(err)
  try {
    return redactPaths(JSON.stringify(err))
  } catch {
    return String(err)
  }
}
