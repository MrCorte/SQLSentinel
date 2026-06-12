// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { StoredServer, AvailabilityReplica } from '../../../preload/index'
import { useServerNavigation } from '../components/features/ag/hooks/useServerNavigation'
import { useServersStore } from '../store/serversStore'
import { useAppStore } from '../store/appStore'

function srv(id: string, opts: Partial<StoredServer> = {}): StoredServer {
  return {
    id,
    host: '127.0.0.1',
    port: 1433,
    useWindowsAuth: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...opts
  }
}

function replica(name: string): AvailabilityReplica {
  return {
    replica_id: 'r-' + name,
    ag_name: 'SQLSentinelAON',
    group_id: 'g1',
    replica_server_name: name,
    role_desc: 'PRIMARY',
    availability_mode_desc: 'SYNCHRONOUS_COMMIT',
    failover_mode_desc: 'MANUAL',
    synchronization_health_desc: 'HEALTHY',
    connected_state_desc: 'CONNECTED',
    operational_state_desc: 'ONLINE',
    recovery_health_desc: '',
    endpoint_url: '',
    is_local: true
  }
}

beforeEach(() => {
  useServersStore.setState({ servers: [] })
  useAppStore.setState({ selectedServerId: null, selectedAgName: 'SQLSentinelAON' })
})

describe('useServerNavigation — replica card → server dashboard', () => {
  it('navigates to a server registered by IP via machineName match', () => {
    // Caso reale: replica_server_name è l'hostname ("nodo1") ma il server è
    // registrato per IP; machineName rilevato al test-connection è l'hostname.
    useServersStore.setState({
      servers: [srv('a', { port: 1435, machineName: 'nodo1' })]
    })

    const { result } = renderHook(() => useServerNavigation())
    act(() => result.current.handleNavigateToServer(replica('nodo1')))

    expect(result.current.snackbarMsg).toBeNull()
    // Selezione diretta: il Dashboard renderizza il server al posto dell'AG.
    expect(useAppStore.getState().selectedServerId).toBe('a')
    expect(useAppStore.getState().selectedAgName).toBeNull()
  })

  it('still matches by host when the server was registered by hostname', () => {
    useServersStore.setState({ servers: [srv('a', { host: 'nodo1' })] })

    const { result } = renderHook(() => useServerNavigation())
    act(() => result.current.handleNavigateToServer(replica('NODO1')))

    expect(useAppStore.getState().selectedServerId).toBe('a')
  })

  it('shows the snackbar when no registered server matches', () => {
    useServersStore.setState({
      servers: [srv('a', { host: '192.168.1.50', machineName: 'sql-prod' })]
    })

    const { result } = renderHook(() => useServerNavigation())
    act(() => result.current.handleNavigateToServer(replica('nodo1')))

    expect(result.current.snackbarMsg).toMatch(/not in the monitored servers list/)
    expect(useAppStore.getState().selectedServerId).toBeNull()
    expect(useAppStore.getState().selectedAgName).toBe('SQLSentinelAON')
  })
})
