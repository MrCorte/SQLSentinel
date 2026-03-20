/**
 * Seed tutte le Zustand store con dati mock quando VITE_USE_MOCK=true.
 *
 * Strategia:
 * - Attende che loadServers() completi (initialized=true) prima di agire.
 * - Semina i mock SOLO se lo store è vuoto (nessun server reale configurato).
 *   Se l'utente ha aggiunto server reali, questi hanno priorità e i mock
 *   non vengono caricati — così il flusso di aggiunta server reale non viene
 *   mai interferito, nemmeno con VITE_USE_MOCK=true.
 * - serverGroups/serverAliases vengono MERGIATI (non sostituiti) per non
 *   corrompere i group-assignment dei server reali nel localStorage persistito.
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
  const initialized = useServersStore((s) => s.initialized)

  useEffect(() => {
    if (!USE_MOCK) return
    if (!initialized) return

    // Se ci sono già server reali (aggiunti manualmente), non sovrascrivere.
    // I mock vengono caricati solo su uno store vuoto (dev environment pulito).
    const existing = useServersStore.getState().servers
    if (existing.length > 0) return

    // Seed serversStore con i 12 server mock
    useServersStore.setState({ servers: MOCK_SERVERS })

    // Merge nel groupsStore persistito: aggiunge le voci mock senza cancellare
    // i group-assignment e alias dei server reali già salvati in localStorage
    useGroupsStore.setState((state) => ({
      ...state,
      serverGroups: { ...state.serverGroups, ...MOCK_SERVER_GROUPS },
      serverAliases: { ...state.serverAliases, ...MOCK_SERVER_ALIASES },
      expandedAGs: Object.keys(MOCK_AG_GROUPS),
      expandedMachines: ['SQLPROD03', 'SQLPROD04', 'SQLDEV01']
    }))

    // Merge metricsMap (mock metrics non entrano in conflitto con server reali)
    useMetricsStore.setState((state) => ({
      ...state,
      metricsMap: { ...state.metricsMap, ...MOCK_METRICS_MAP },
      lastUpdate: new Date()
    }))

    // Merge agGroups (mock AG non entrano in conflitto con AG reali)
    useAgStore.setState((state) => ({
      ...state,
      agGroups: { ...state.agGroups, ...MOCK_AG_GROUPS }
    }))
  }, [initialized])
}
