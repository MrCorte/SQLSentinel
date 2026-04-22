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
  /** Clear all AG state (e.g. on store reset) */
  clear(): void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgStore = create<AgStore>((set, get) => ({
  agGroups: {},
  agDetails: {},

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

      for (const ag of groups) {
        const agReplicas = replicas.filter((r) => r.ag_name === ag.ag_name)

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
          const matched = allServers.find((s) => {
            const addr = (s.ip ?? s.host).toLowerCase()
            return addr === nameBase || nameBase.includes(addr) || addr.includes(nameBase)
          })
          if (matched) {
            serverIds.add(matched.id)
            // Update ALL matched replicas with agGroupId + agName + agRole —
            // not just the server currently being detected.
            // This ensures SECONDARY servers are grouped even if their own
            // detectAgsForServer() run hasn't succeeded yet.
            if (matched.id !== serverId && onUpdateServer) {
              const replicaRole = replica.role_desc as AgRole
              onUpdateServer(matched.id, {
                agGroupId: ag.group_id,
                agName: ag.ag_name,
                agRole: replicaRole
              })
            }
          }
        }

        // Determine the role of this specific server in this AG
        const myReplica = agReplicas.find((r) => {
          const nameBase = r.replica_server_name.split('\\')[0].toLowerCase()
          const connAddr = connection.ip.toLowerCase()
          return nameBase === connAddr || connAddr.includes(nameBase) || nameBase.includes(connAddr)
        })

        // Persist agGroupId + agName + agRole for the current server via injected callback
        if (myReplica && onUpdateServer) {
          onUpdateServer(serverId, {
            agGroupId: ag.group_id,
            agName: ag.ag_name,
            agRole: myReplica.role_desc as AgRole
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

      set((state) => ({
        agGroups: { ...state.agGroups, ...updates }
      }))
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

  clear: () => set({ agGroups: {}, agDetails: {} })
}))
