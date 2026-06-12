// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import type { StoredServer } from '../../../preload/index'
import { pickAgQueryMember } from '../utils/agSelection'

function srv(id: string, opts: Partial<StoredServer> = {}): StoredServer {
  return {
    id,
    host: '127.0.0.1',
    port: 1433,
    useWindowsAuth: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    agName: 'AG1',
    ...opts
  }
}

describe('pickAgQueryMember — quale replica interrogare per i dati AG', () => {
  it('prefers the reachable PRIMARY over other reachable members', () => {
    // Post-failover: l'ex-primary è il primo in lista ma è SECONDARY; le query
    // AG da una secondaria mostrano il nuovo primary come RESOLVING/DISCONNECTED.
    const exPrimary = srv('a', { agRole: 'SECONDARY' })
    const newPrimary = srv('b', { agRole: 'PRIMARY' })
    expect(pickAgQueryMember([exPrimary, newPrimary])?.id).toBe('b')
  })

  it('skips an unreachable PRIMARY and falls back to a reachable member', () => {
    const deadPrimary = srv('a', { agRole: 'PRIMARY', unreachable: true })
    const secondary = srv('b', { agRole: 'SECONDARY' })
    expect(pickAgQueryMember([deadPrimary, secondary])?.id).toBe('b')
  })

  it('falls back to the first member when every member is unreachable', () => {
    const a = srv('a', { agRole: 'PRIMARY', unreachable: true })
    const b = srv('b', { agRole: 'SECONDARY', unreachable: true })
    expect(pickAgQueryMember([a, b])?.id).toBe('a')
  })

  it('returns undefined for an empty member list', () => {
    expect(pickAgQueryMember([])).toBeUndefined()
  })
})
