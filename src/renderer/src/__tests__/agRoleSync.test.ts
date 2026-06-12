// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StoredServer, AvailabilityReplica, AvailabilityGroup } from '../../../preload/index'

vi.mock('../api/ipc', () => ({
  ag: {
    getGroups: vi.fn(),
    getReplicas: vi.fn(),
    getDatabases: vi.fn()
  }
}))

import * as ipc from '../api/ipc'
import { useAgStore } from '../store/agStore'

const mockedAg = vi.mocked(ipc.ag)

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

function replica(opts: Partial<AvailabilityReplica>): AvailabilityReplica {
  return {
    replica_id: 'r-' + (opts.replica_server_name ?? 'x'),
    ag_name: 'SQLSentinelAON',
    group_id: 'g1',
    replica_server_name: 'x',
    role_desc: 'SECONDARY',
    availability_mode_desc: 'SYNCHRONOUS_COMMIT',
    failover_mode_desc: 'MANUAL',
    synchronization_health_desc: 'HEALTHY',
    connected_state_desc: 'CONNECTED',
    operational_state_desc: '',
    recovery_health_desc: '',
    endpoint_url: '',
    is_local: false,
    ...opts
  }
}

const AG_GROUP: AvailabilityGroup = {
  group_id: 'g1',
  ag_name: 'SQLSentinelAON',
  primary_replica: '',
  ag_health: 'HEALTHY',
  failure_condition_level: 3,
  health_check_timeout: 30000
}

const connection = {
  ip: '127.0.0.1',
  port: 1436,
  useWindowsAuth: false,
  username: 'dock',
  password: 'pw'
}

beforeEach(() => {
  vi.clearAllMocks()
  useAgStore.getState().clear()
  // Guard in detectAgsForServer: window.sqlSentinel?.ag?.getGroups
  ;(window as unknown as { sqlSentinel: unknown }).sqlSentinel = {
    ag: { getGroups: () => {} }
  }
})

describe('detectAgsForServer — replica role trust', () => {
  it('does not overwrite a known remote role with RESOLVING when queried from a SECONDARY', async () => {
    // Vista da nodo2 (SECONDARY): il ruolo di nodo1 non è visibile e arriva
    // coalizzato a RESOLVING — non deve sovrascrivere il PRIMARY persistito.
    mockedAg.getGroups.mockResolvedValue({ ok: true, data: [AG_GROUP] })
    mockedAg.getReplicas.mockResolvedValue({
      ok: true,
      data: [
        replica({ replica_server_name: 'nodo1', role_desc: 'RESOLVING', is_local: false }),
        replica({ replica_server_name: 'nodo2', role_desc: 'SECONDARY', is_local: true })
      ]
    })

    const nodo1 = srv('a', { port: 1435, machineName: 'nodo1', agRole: 'PRIMARY' })
    const nodo2 = srv('b', { port: 1436, machineName: 'nodo2' })
    const onUpdateServer = vi.fn()

    await useAgStore
      .getState()
      .detectAgsForServer('b', connection, [nodo1, nodo2], onUpdateServer)

    const callsForNodo1 = onUpdateServer.mock.calls.filter(([id]) => id === 'a')
    for (const [, patch] of callsForNodo1) {
      expect(patch.agRole).not.toBe('RESOLVING')
    }
  })

  it('persists the queried server own role via is_local even when registered by IP', async () => {
    mockedAg.getGroups.mockResolvedValue({ ok: true, data: [AG_GROUP] })
    mockedAg.getReplicas.mockResolvedValue({
      ok: true,
      data: [
        replica({ replica_server_name: 'nodo1', role_desc: 'RESOLVING', is_local: false }),
        replica({ replica_server_name: 'nodo2', role_desc: 'SECONDARY', is_local: true })
      ]
    })

    const nodo1 = srv('a', { port: 1435, machineName: 'nodo1', agRole: 'PRIMARY' })
    const nodo2 = srv('b', { port: 1436, machineName: 'nodo2' })
    const onUpdateServer = vi.fn()

    await useAgStore
      .getState()
      .detectAgsForServer('b', connection, [nodo1, nodo2], onUpdateServer)

    expect(onUpdateServer).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ agRole: 'SECONDARY', agName: 'SQLSentinelAON' })
    )
  })

  it('trusts remote roles when the queried server is the PRIMARY', async () => {
    mockedAg.getGroups.mockResolvedValue({ ok: true, data: [AG_GROUP] })
    mockedAg.getReplicas.mockResolvedValue({
      ok: true,
      data: [
        replica({ replica_server_name: 'nodo1', role_desc: 'PRIMARY', is_local: true }),
        replica({ replica_server_name: 'nodo2', role_desc: 'SECONDARY', is_local: false })
      ]
    })

    const nodo1 = srv('a', { port: 1435, machineName: 'nodo1' })
    const nodo2 = srv('b', { port: 1436, machineName: 'nodo2', agRole: 'PRIMARY' })
    const onUpdateServer = vi.fn()

    await useAgStore
      .getState()
      .detectAgsForServer('a', { ...connection, port: 1435 }, [nodo1, nodo2], onUpdateServer)

    expect(onUpdateServer).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ agRole: 'SECONDARY' })
    )
  })
})
