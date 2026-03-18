import { create } from 'zustand'
import type {
  AvailabilityReplica,
  AvailabilityDatabase,
  AgHealth,
  AgRole,
  CollectMetricsRequest
} from '../../../preload/index'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgGroupState {
  id: string          // group_id UUID
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

interface AgStore {
  /** Map of ag_name → AgGroupState (sidebar display) */
  agGroups: Record<string, AgGroupState>
  /** Map of ag_name → full detail with replicas + databases */
  agDetails: Record<string, AgDetail>
  /** Detect AG membership for one server and populate agGroups */
  detectAgsForServer(serverId: string, connection: CollectMetricsRequest): Promise<void>
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

  detectAgsForServer: async (serverId, connection) => {
    if (!window.sqlSentinel?.ag?.getGroups) return
    try {
      const [groupsRes, replicasRes] = await Promise.all([
        window.sqlSentinel.ag.getGroups({ connection }),
        window.sqlSentinel.ag.getReplicas({ connection })
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
        // replica_server_name may be a hostname, but if someone added by IP it'll match
        const { useServersStore } = await import('./serversStore')
        const allServers = useServersStore.getState().servers
        for (const replica of agReplicas) {
          const nameBase = replica.replica_server_name.split('\\')[0].toLowerCase()
          const matched = allServers.find(
            (s) => {
              const addr = (s.ip ?? s.host).toLowerCase()
              return addr === nameBase || nameBase.includes(addr) || addr.includes(nameBase)
            }
          )
          if (matched) serverIds.add(matched.id)
        }

        // Determine the role of this specific server in this AG
        const myReplica = agReplicas.find((r) => {
          const nameBase = r.replica_server_name.split('\\')[0].toLowerCase()
          const connAddr = connection.ip.toLowerCase()
          return (
            nameBase === connAddr ||
            connAddr.includes(nameBase) ||
            nameBase.includes(connAddr)
          )
        })

        // Persist the role back to serversStore so it shows in sidebar
        if (myReplica) {
          const { useServersStore: ss } = await import('./serversStore')
          ss.getState().updateServer(serverId, {
            agGroupId: ag.group_id,
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
      console.debug('[agStore] detectAgsForServer: no AG or error', (err as Error).message)
    }
  },

  updateAgDetails: async (connection) => {
    if (!window.sqlSentinel?.ag?.getGroups) return
    try {
      const [groupsRes, replicasRes, dbsRes] = await Promise.all([
        window.sqlSentinel.ag.getGroups({ connection }),
        window.sqlSentinel.ag.getReplicas({ connection }),
        window.sqlSentinel.ag.getDatabases({ connection })
      ])

      if (!groupsRes.ok || !groupsRes.data.length) return

      const groups = groupsRes.ok ? groupsRes.data : []
      const replicas = replicasRes.ok ? replicasRes.data : []
      const databases = dbsRes.ok ? dbsRes.data : []

      const updates: Record<string, AgDetail> = {}

      for (const ag of groups) {
        updates[ag.ag_name] = {
          ...ag,
          replicas: replicas.filter((r) => r.ag_name === ag.ag_name),
          databases: databases.filter((d) => d.ag_name === ag.ag_name),
          lastUpdated: new Date()
        }

        // Also update the summary agGroups entry health
        set((state) => ({
          agGroups: {
            ...state.agGroups,
            [ag.ag_name]: state.agGroups[ag.ag_name]
              ? { ...state.agGroups[ag.ag_name], health: ag.ag_health, primary_replica: ag.primary_replica }
              : state.agGroups[ag.ag_name]
          }
        }))
      }

      set((state) => ({
        agDetails: { ...state.agDetails, ...updates }
      }))
    } catch (err) {
      console.debug('[agStore] updateAgDetails: error', (err as Error).message)
    }
  },

  clear: () => set({ agGroups: {}, agDetails: {} })
}))
