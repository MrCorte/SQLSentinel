/**
 * Seeds all Zustand stores with mock data when VITE_MOCK_MODE=true.
 *
 * Strategy:
 * - Waits for loadServers() to complete (initialized=true) before acting.
 * - Seeds mocks ONLY if the store is empty (no real server configured).
 *   If the user has added real servers, those take priority and the mocks
 *   are not loaded — so the real server add flow is never interfered with,
 *   even when VITE_MOCK_MODE=true.
 * - serverGroups/serverAliases are MERGED (not replaced) to avoid
 *   corrupting the group-assignments of real servers in persisted localStorage.
 */
import { useEffect } from 'react'
import { useServersStore } from '../store/serversStore'
import { useGroupsStore } from '../store/groupsStore'
import { useMetricsStore } from '../store/metricsStore'
import { useAgStore } from '../store/agStore'
import {
  MOCK_SERVERS,
  MOCK_SERVER_GROUPS,
  MOCK_SERVER_ALIASES,
  MOCK_METRICS_MAP,
  MOCK_AG_GROUPS
} from '../mocks/servers.mock'
import { isMockModeEnabled } from '../../../shared/mockMode'

const USE_MOCK = isMockModeEnabled(import.meta.env)

export function useMockData(): void {
  const initialized = useServersStore((s) => s.initialized)

  useEffect(() => {
    if (!USE_MOCK) return
    if (!initialized) return

    // If real servers already exist (added manually), do not overwrite.
    // Mocks are loaded only into an empty store (clean dev environment).
    const existing = useServersStore.getState().servers
    if (existing.length > 0) return

    // Seed serversStore with the 12 mock servers
    useServersStore.setState({ servers: MOCK_SERVERS })

    // Merge into the persisted groupsStore: adds mock entries without removing
    // the group assignments and aliases of real servers already saved in localStorage
    useGroupsStore.setState((state) => ({
      ...state,
      serverGroups: { ...state.serverGroups, ...MOCK_SERVER_GROUPS },
      serverAliases: { ...state.serverAliases, ...MOCK_SERVER_ALIASES },
      expandedAGs: Object.keys(MOCK_AG_GROUPS),
      expandedMachines: ['SQLPROD03', 'SQLPROD04', 'SQLDEV01']
    }))

    // Merge metricsMap (mock metrics do not conflict with real servers)
    useMetricsStore.setState((state) => ({
      ...state,
      metricsMap: { ...state.metricsMap, ...MOCK_METRICS_MAP },
      lastUpdate: new Date()
    }))

    // Merge agGroups (mock AGs do not conflict with real AGs)
    useAgStore.setState((state) => ({
      ...state,
      agGroups: { ...state.agGroups, ...MOCK_AG_GROUPS }
    }))
  }, [initialized])
}
