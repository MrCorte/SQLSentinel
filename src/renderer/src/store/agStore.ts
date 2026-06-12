import { create } from 'zustand'
import type {
  AvailabilityReplica,
  AvailabilityDatabase,
  AgHealth,
  AgRole,
  CollectMetricsRequest,
  StoredServer
} from '../../../preload/index'
import { createLogger } from '../utils/logger'
import * as ipc from '../api/ipc'

const log = createLogger('ag-store')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgGroupState {
  id: string // group_id UUID
  ag_name: string
  health: AgHealth
  primary_replica: string
  serverIds: string[] // StoredServer.id values that belong to this AG
}

export interface AgDetail {
  group_id: string
  ag_name: string
  primary_replica: string
  ag_health: AgHealth
  failure_condition_level: number
  health_check_timeout: number
  replicas: AvailabilityReplica[]
  databases: AvailabilityDatabase[]
  lastUpdated: Date
}

/** Callback type for writing AG metadata back to a server record. Injected by callers to avoid a circular store dependency. */
export type OnUpdateServer = (id: string, patch: Partial<StoredServer>) => void

/**
 * Un server registrato corrisponde a una replica AG?
 * `replica_server_name` è quasi sempre l'HOSTNAME del nodo, mentre il server
 * può essere stato aggiunto per IP o `localhost`: in quel caso il confronto su
 * ip/host fallisce e l'AG non si raggruppava. Si confronta anche con
 * `machineName` (rilevato in automatico al test-connection), che è proprio
 * l'hostname della macchina — la stessa cosa che SQL Server mette nel replica.
 */
export function replicaMatchesServer(replicaNameBase: string, s: StoredServer): boolean {
  const candidates = [s.ip ?? s.host, s.machineName]
    .filter((v): v is string => !!v)
    .map((v) => v.toLowerCase())
  return candidates.some(
    (addr) =>
      addr === replicaNameBase ||
      replicaNameBase.includes(addr) ||
      addr.includes(replicaNameBase)
  )
}

export interface AgReplicaSuggestion {
  agName: string
  missingReplicas: Array<{ replica_server_name: string; role_desc: AgRole }>
  sourceCredentials: {
    useWindowsAuth: boolean
    username?: string
    password?: string
  }
}

interface AgStore {
  /** Map of ag_name → AgGroupState (sidebar display) */
  agGroups: Record<string, AgGroupState>
  /** Map of ag_name → full detail with replicas + databases */
  agDetails: Record<string, AgDetail>
  /**
   * Detect AG membership for one server and populate agGroups.
   *
   * @param allServers - Full server list used to match replica hostnames to stored server
   *   records. Callers already hold this (from serversStore), so we accept it as a
   *   parameter instead of importing serversStore here.
   * @param onUpdateServer - Optional callback to persist agGroupId/agName/agRole back to
   *   each matched server record. Keeps agStore free of a circular serversStore import.
   */
  detectAgsForServer(
    serverId: string,
    connection: CollectMetricsRequest,
    allServers: StoredServer[],
    onUpdateServer?: OnUpdateServer
  ): Promise<void>
  /** Refresh full details for all AGs visible from a given connection */
  updateAgDetails(connection: CollectMetricsRequest): Promise<void>
  /** Drop references to a removed server from agGroups; remove empty AGs */
  removeServer(serverId: string): void
  /** Clear all AG state (e.g. on store reset) */
  clear(): void
  /** Unmonitored AG replicas discovered when a server was added */
  pendingAgSuggestions: AgReplicaSuggestion[]
  /** Remove the suggestion for a given AG name (user dismissed or finished adding) */
  clearAgSuggestion(agName: string): void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgStore = create<AgStore>((set, get) => ({
  agGroups: {},
  agDetails: {},
  pendingAgSuggestions: [],
  clearAgSuggestion: (agName) =>
    set((state) => ({
      pendingAgSuggestions: state.pendingAgSuggestions.filter((s) => s.agName !== agName)
    })),

  detectAgsForServer: async (serverId, connection, allServers, onUpdateServer) => {
    if (!window.sqlSentinel?.ag?.getGroups) return
    try {
      const [groupsRes, replicasRes] = await Promise.all([
        ipc.ag.getGroups({ connection }),
        ipc.ag.getReplicas({ connection })
      ])

      if (!groupsRes.ok || !groupsRes.data.length) return

      const groups = groupsRes.ok ? groupsRes.data : []
      const replicas = replicasRes.ok ? replicasRes.data : []

      const updates: Record<string, AgGroupState> = {}
      const newSuggestions: AgReplicaSuggestion[] = []

      for (const ag of groups) {
        const agReplicas = replicas.filter((r) => r.ag_name === ag.ag_name)

        // Su una replica non-PRIMARY i DMV non espongono il ruolo delle repliche
        // remote (role_desc arriva NULL → coalizzato a RESOLVING dal collector):
        // quei ruoli sono fabbricati e non vanno persistiti, o sovrascriverebbero
        // il PRIMARY reale salvato in precedenza.
        const localIsPrimary = agReplicas.some((r) => r.is_local && r.role_desc === 'PRIMARY')

        // Find the existing agGroups entry to preserve any already-matched serverIds
        const existing = get().agGroups[ag.ag_name]
        const existingServerIds = existing?.serverIds ?? []

        // Always include the current server — we know it's part of this AG
        const serverIds = new Set<string>([...existingServerIds, serverId])

        // Try to match other replicas to stored servers by IP (best-effort)
        // replica_server_name may be a hostname, but if someone added by IP it'll match.
        // allServers is injected by the caller so agStore does not import serversStore.
        for (const replica of agReplicas) {
          const nameBase = replica.replica_server_name.split('\\')[0].toLowerCase()
          const matched = allServers.find((s) => replicaMatchesServer(nameBase, s))
          if (matched) {
            serverIds.add(matched.id)
            // Update ALL matched replicas with agGroupId + agName —
            // not just the server currently being detected.
            // This ensures SECONDARY servers are grouped even if their own
            // detectAgsForServer() run hasn't succeeded yet.
            if (matched.id !== serverId && onUpdateServer) {
              const patch: Partial<StoredServer> = {
                agGroupId: ag.group_id,
                agName: ag.ag_name
              }
              if (replica.is_local || localIsPrimary) {
                patch.agRole = replica.role_desc as AgRole
              }
              onUpdateServer(matched.id, patch)
            }
          }
        }

        // Determine the role of this specific server in this AG: la riga
        // is_local è autoritativa (funziona anche per server registrati per
        // IP); il confronto sul nome resta come fallback.
        const myReplica =
          agReplicas.find((r) => r.is_local) ??
          agReplicas.find((r) => {
            const nameBase = r.replica_server_name.split('\\')[0].toLowerCase()
            const connAddr = connection.ip.toLowerCase()
            return (
              nameBase === connAddr || connAddr.includes(nameBase) || nameBase.includes(connAddr)
            )
          })

        // Persist agGroupId + agName + agRole for the current server via injected callback
        if (myReplica && onUpdateServer) {
          onUpdateServer(serverId, {
            agGroupId: ag.group_id,
            agName: ag.ag_name,
            agRole: myReplica.role_desc as AgRole
          })
        }

        // Identify replicas not yet added as monitored servers
        const missingReplicas = agReplicas
          .filter((r) => {
            const nameBase = r.replica_server_name.split('\\')[0].toLowerCase()
            return !allServers.some((s) => replicaMatchesServer(nameBase, s))
          })
          .map((r) => ({ replica_server_name: r.replica_server_name, role_desc: r.role_desc }))
        if (missingReplicas.length > 0) {
          newSuggestions.push({
            agName: ag.ag_name,
            missingReplicas,
            sourceCredentials: {
              useWindowsAuth: connection.useWindowsAuth,
              username: connection.username,
              password: connection.password
            }
          })
        }

        updates[ag.ag_name] = {
          id: ag.group_id,
          ag_name: ag.ag_name,
          health: ag.ag_health,
          primary_replica: ag.primary_replica,
          serverIds: [...serverIds]
        }
      }

      set((state) => {
        let suggestions = state.pendingAgSuggestions
        for (const s of newSuggestions) {
          suggestions = [...suggestions.filter((x) => x.agName !== s.agName), s]
        }
        return {
          agGroups: { ...state.agGroups, ...updates },
          pendingAgSuggestions: suggestions
        }
      })
    } catch (err) {
      // Server not in AG or insufficient permissions — silent
      log.debug('detectAgsForServer: no AG or error', (err as Error).message)
    }
  },

  updateAgDetails: async (connection) => {
    if (!window.sqlSentinel?.ag?.getGroups) return
    try {
      const [groupsRes, replicasRes, dbsRes] = await Promise.all([
        ipc.ag.getGroups({ connection }),
        ipc.ag.getReplicas({ connection }),
        ipc.ag.getDatabases({ connection })
      ])

      if (!groupsRes.ok || !groupsRes.data.length) return

      const groups = groupsRes.ok ? groupsRes.data : []
      const replicas = replicasRes.ok ? replicasRes.data : []
      const databases = dbsRes.ok ? dbsRes.data : []

      const detailUpdates: Record<string, AgDetail> = {}

      for (const ag of groups) {
        detailUpdates[ag.ag_name] = {
          ...ag,
          replicas: replicas.filter((r) => r.ag_name === ag.ag_name),
          databases: databases.filter((d) => d.ag_name === ag.ag_name),
          lastUpdated: new Date()
        }
      }

      // Single set() call: update agDetails + patch health/primary_replica in agGroups
      set((state) => {
        const newAgGroups: Record<string, AgGroupState> = { ...state.agGroups }
        for (const ag of groups) {
          if (state.agGroups[ag.ag_name]) {
            newAgGroups[ag.ag_name] = {
              ...state.agGroups[ag.ag_name],
              health: ag.ag_health,
              primary_replica: ag.primary_replica
            }
          }
        }
        return {
          agDetails: { ...state.agDetails, ...detailUpdates },
          agGroups: newAgGroups
        }
      })
    } catch (err) {
      log.debug('updateAgDetails: error', (err as Error).message)
    }
  },

  removeServer: (serverId) => {
    set((state) => {
      const newGroups: Record<string, AgGroupState> = {}
      const droppedAgNames = new Set<string>()
      for (const [agName, group] of Object.entries(state.agGroups)) {
        const remaining = group.serverIds.filter((id) => id !== serverId)
        if (remaining.length === 0) {
          droppedAgNames.add(agName)
          continue
        }
        newGroups[agName] = { ...group, serverIds: remaining }
      }
      // Drop the matching detail entries too — they'd otherwise leak forever.
      const newDetails: Record<string, AgDetail> = {}
      for (const [agName, detail] of Object.entries(state.agDetails)) {
        if (!droppedAgNames.has(agName)) newDetails[agName] = detail
      }
      return { agGroups: newGroups, agDetails: newDetails }
    })
  },

  clear: () => set({ agGroups: {}, agDetails: {}, pendingAgSuggestions: [] })
}))
