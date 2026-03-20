/**
 * Seed tutte le Zustand store con dati mock quando VITE_USE_MOCK=true.
 *
 * Viene chiamato una sola volta al mount in AppInner.
 * Quando attivo, bypassa completamente loadServers() (gestito in App.tsx)
 * e semina i dati direttamente, impostando initialized=true.
 *
 * Nota: serverGroups e serverAliases vengono MERGIATI (non sostituiti) nel
 * groupsStore persistito, così i dati reali non vengono corrotti quando si
 * torna a VITE_USE_MOCK=false.
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

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

export function useMockData(): void {
  useEffect(() => {
    if (!USE_MOCK) return

    // Seed serversStore — initialized=true sostituisce la chiamata a loadServers()
    useServersStore.setState({ servers: MOCK_SERVERS, initialized: true })

    // Merge nel groupsStore persistito: aggiunge le voci mock senza cancellare
    // i group-assignment e alias dei server reali (sicuro se si torna a VITE_USE_MOCK=false)
    useGroupsStore.setState((state) => ({
      ...state,
      serverGroups: { ...state.serverGroups, ...MOCK_SERVER_GROUPS },
      serverAliases: { ...state.serverAliases, ...MOCK_SERVER_ALIASES },
      expandedAGs: Object.keys(MOCK_AG_GROUPS),
      expandedMachines: ['SQLPROD03', 'SQLPROD04', 'SQLDEV01']
    }))

    // Seed metricsMap (Inventario, HomeDashboard, ServerDashboard)
    useMetricsStore.setState((state) => ({
      ...state,
      metricsMap: MOCK_METRICS_MAP,
      lastUpdate: new Date()
    }))

    // Seed agStore (AG headers in Sidebar e Inventario)
    useAgStore.setState((state) => ({
      ...state,
      agGroups: MOCK_AG_GROUPS
    }))
  }, []) // una sola volta al mount — loadServers() è disabilitato in mock mode
}
