export interface ServerGroup {
  id: string
  name: string
  color: string
  collapsed: boolean
  order: number
}

/**
 * Returns the display name for a server.
 * If an alias is set, returns it; otherwise falls back to "ip:port".
 */
export function getServerDisplayName(server: {
  ip: string
  port: number
  alias?: string
}): string {
  return server.alias?.trim() || `${server.ip}:${server.port}`
}
