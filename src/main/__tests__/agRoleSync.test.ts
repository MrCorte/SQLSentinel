import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()

vi.mock('../collectors/connectionPool', () => ({
  getPool: vi.fn(() =>
    Promise.resolve({
      request: () => ({ query: queryMock })
    })
  ),
  invalidatePool: vi.fn()
}))

vi.mock('../store/sqlserver/serverRepository', () => ({
  getAllStripped: vi.fn(() => []),
  update: vi.fn(() => Promise.resolve()),
  stripCredentials: vi.fn((s: unknown) => s)
}))

import { detectAndSyncReplicaRoles } from '../collectors/agCollector'
import * as serverStore from '../store/sqlserver/serverRepository'

const mockedStore = vi.mocked(serverStore)

const CONN = {
  ip: '127.0.0.1',
  port: 1436,
  useWindowsAuth: false,
  username: 'dock',
  password: 'pw'
}

function stored(id: string, host: string, opts: Record<string, unknown> = {}) {
  return {
    id,
    host,
    port: 1433,
    useWindowsAuth: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...opts
  } as ReturnType<typeof serverStore.getAllStripped>[number]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('detectAndSyncReplicaRoles — role trust by locality', () => {
  it('does not persist the fabricated RESOLVING role of a remote replica when polling a SECONDARY', async () => {
    // Polling nodo2 (SECONDARY): la riga di nodo1 arriva con role NULL→RESOLVING.
    queryMock.mockResolvedValue({
      recordset: [
        {
          agName: 'SQLSentinelAON',
          groupId: 'g1',
          replicaHost: 'nodo1',
          agRole: 'RESOLVING',
          isLocal: false
        },
        {
          agName: 'SQLSentinelAON',
          groupId: 'g1',
          replicaHost: 'nodo2',
          agRole: 'SECONDARY',
          isLocal: true
        }
      ]
    })
    mockedStore.getAllStripped.mockReturnValue([
      stored('a', 'nodo1', { agGroupId: 'g1', agName: 'SQLSentinelAON', agRole: 'PRIMARY' }),
      stored('b', 'nodo2', { agGroupId: 'g1', agName: 'SQLSentinelAON', agRole: 'SECONDARY' })
    ])

    await detectAndSyncReplicaRoles(CONN)

    const patchesForNodo1 = mockedStore.update.mock.calls.filter(([id]) => id === 'a')
    for (const [, patch] of patchesForNodo1) {
      expect(patch.agRole).not.toBe('RESOLVING')
    }
  })

  it('syncs remote roles normally when polling the PRIMARY', async () => {
    queryMock.mockResolvedValue({
      recordset: [
        {
          agName: 'SQLSentinelAON',
          groupId: 'g1',
          replicaHost: 'nodo1',
          agRole: 'PRIMARY',
          isLocal: true
        },
        {
          agName: 'SQLSentinelAON',
          groupId: 'g1',
          replicaHost: 'nodo2',
          agRole: 'SECONDARY',
          isLocal: false
        }
      ]
    })
    mockedStore.getAllStripped.mockReturnValue([
      stored('a', 'nodo1', { agGroupId: 'g1', agName: 'SQLSentinelAON', agRole: 'RESOLVING' }),
      stored('b', 'nodo2', { agGroupId: 'g1', agName: 'SQLSentinelAON', agRole: 'RESOLVING' })
    ])

    await detectAndSyncReplicaRoles(CONN)

    expect(mockedStore.update).toHaveBeenCalledWith('a', expect.objectContaining({ agRole: 'PRIMARY' }))
    expect(mockedStore.update).toHaveBeenCalledWith('b', expect.objectContaining({ agRole: 'SECONDARY' }))
  })

  it('matches servers registered by IP via machineName and syncs their role from the PRIMARY', async () => {
    // Post-failover: i server sono registrati come 127.0.0.1:porta, il
    // replica_server_name è l'hostname. Senza il match su machineName i ruoli
    // persistiti non convergono mai dopo un failover.
    queryMock.mockResolvedValue({
      recordset: [
        {
          agName: 'SQLSentinelAON',
          groupId: 'g1',
          replicaHost: 'nodo1',
          agRole: 'SECONDARY',
          isLocal: false
        },
        {
          agName: 'SQLSentinelAON',
          groupId: 'g1',
          replicaHost: 'nodo2',
          agRole: 'PRIMARY',
          isLocal: true
        }
      ]
    })
    mockedStore.getAllStripped.mockReturnValue([
      stored('a', '127.0.0.1', {
        port: 1435,
        machineName: 'nodo1',
        agGroupId: 'g1',
        agName: 'SQLSentinelAON',
        agRole: 'PRIMARY'
      }),
      stored('b', '127.0.0.1', {
        port: 1436,
        machineName: 'nodo2',
        agGroupId: 'g1',
        agName: 'SQLSentinelAON',
        agRole: 'SECONDARY'
      })
    ])

    await detectAndSyncReplicaRoles(CONN)

    expect(mockedStore.update).toHaveBeenCalledWith('a', expect.objectContaining({ agRole: 'SECONDARY' }))
    expect(mockedStore.update).toHaveBeenCalledWith('b', expect.objectContaining({ agRole: 'PRIMARY' }))
  })

  it('still updates its own local role when polled directly on a SECONDARY', async () => {
    queryMock.mockResolvedValue({
      recordset: [
        {
          agName: 'SQLSentinelAON',
          groupId: 'g1',
          replicaHost: 'nodo1',
          agRole: 'RESOLVING',
          isLocal: false
        },
        {
          agName: 'SQLSentinelAON',
          groupId: 'g1',
          replicaHost: 'nodo2',
          agRole: 'SECONDARY',
          isLocal: true
        }
      ]
    })
    mockedStore.getAllStripped.mockReturnValue([
      stored('b', 'nodo2', { agGroupId: 'g1', agName: 'SQLSentinelAON', agRole: 'RESOLVING' })
    ])

    await detectAndSyncReplicaRoles(CONN)

    expect(mockedStore.update).toHaveBeenCalledWith('b', expect.objectContaining({ agRole: 'SECONDARY' }))
  })
})
