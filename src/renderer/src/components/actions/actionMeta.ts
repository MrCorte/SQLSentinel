import type { IncidentAction } from '../../../../preload/index'
import { useServersStore } from '../../store/serversStore'

// Mirror of DESTRUCTIVE_ACTIONS in src/main/ai/actionTools.ts. The server
// re-enforces this list, so a drift here only affects whether the UI shows the
// typed-confirmation dialog — never whether the gate is actually applied.
const DESTRUCTIVE_ACTIONS = new Set([
  'kill_session',
  'rebuild_index',
  'clear_plan_cache',
  'set_maxdop'
])

export function isDestructiveAction(toolName: string): boolean {
  return DESTRUCTIVE_ACTIONS.has(toolName)
}

/**
 * Expected typed-confirmation token for a destructive action: the target
 * server's "host:port". Resolved from the loaded server list by the action's
 * serverId. Returns null when the server can't be resolved (the user then sees
 * a generic confirm prompt and the server still validates on approve).
 */
export function confirmTokenForAction(action: IncidentAction): string | null {
  if (!action.serverId) return null
  const server = useServersStore.getState().servers.find((s) => s.id === action.serverId)
  if (!server) return null
  const host = server.host ?? server.ip
  if (!host) return null
  return `${host}:${server.port}`
}
