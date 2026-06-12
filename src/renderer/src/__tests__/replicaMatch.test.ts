// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { replicaMatchesServer } from '../store/agStore'
import type { StoredServer } from '../../../preload/index'

function srv(opts: Partial<StoredServer>): StoredServer {
  return {
    id: 'x',
    host: '',
    port: 1433,
    useWindowsAuth: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...opts
  }
}

describe('replicaMatchesServer — AG replica ↔ registered server', () => {
  it('matches on host/ip when it equals the replica name', () => {
    expect(replicaMatchesServer('nodo1', srv({ host: 'nodo1' }))).toBe(true)
  })

  it('matches on machineName when the server was added by IP or localhost', () => {
    // replica_server_name è l'hostname; il server è stato aggiunto come localhost
    // ma machineName (rilevato al test-connection) è l'hostname → deve matchare.
    const s = srv({ host: 'localhost', ip: 'localhost', machineName: 'nodo1' })
    expect(replicaMatchesServer('nodo1', s)).toBe(true)
  })

  it('does not match an unrelated server', () => {
    const s = srv({ host: '192.168.1.50', machineName: 'sql-prod' })
    expect(replicaMatchesServer('nodo1', s)).toBe(false)
  })

  it('is case-insensitive on machineName', () => {
    expect(replicaMatchesServer('nodo1', srv({ host: 'x', machineName: 'NODO1' }))).toBe(true)
  })
})
