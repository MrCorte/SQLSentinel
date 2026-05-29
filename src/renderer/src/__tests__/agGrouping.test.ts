// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { buildDisplayRows } from '../components/features/home/ServerTable'
import type { StoredServer } from '../../../preload/index'

function srv(id: string, opts: Partial<StoredServer> = {}): StoredServer {
  return {
    id,
    host: id,
    ip: id,
    port: 1433,
    useWindowsAuth: true,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...opts
  }
}

describe('AG dashboard grouping — buildDisplayRows', () => {
  it('clusters 2+ replicas of the same AG under one header named after the AG', () => {
    const rows = buildDisplayRows([
      srv('node-a', { agName: 'AG-PROD-01', agRole: 'SECONDARY' }),
      srv('standalone'),
      srv('node-b', { agName: 'AG-PROD-01', agRole: 'PRIMARY' })
    ])

    // Header appears at the first replica's position, both members follow it,
    // and the standalone server keeps its place.
    expect(rows.map((r) => (r.kind === 'ag' ? `AG:${r.agName}` : r.server.id))).toEqual([
      'AG:AG-PROD-01',
      'node-b', // PRIMARY sorted first
      'node-a',
      'standalone'
    ])

    const header = rows.find((r) => r.kind === 'ag')
    expect(header?.kind === 'ag' && header.members.length).toBe(2)
  })

  it('does not create a header for a lone AG replica (renders inline)', () => {
    const rows = buildDisplayRows([
      srv('only-node', { agName: 'AG-SOLO', agRole: 'PRIMARY' }),
      srv('plain')
    ])
    expect(rows.every((r) => r.kind === 'server')).toBe(true)
    expect(rows.map((r) => (r.kind === 'server' ? r.server.id : ''))).toEqual([
      'only-node',
      'plain'
    ])
  })

  it('keeps separate AGs in distinct groups', () => {
    const rows = buildDisplayRows([
      srv('a1', { agName: 'AG1', agRole: 'PRIMARY' }),
      srv('b1', { agName: 'AG2', agRole: 'PRIMARY' }),
      srv('a2', { agName: 'AG1', agRole: 'SECONDARY' }),
      srv('b2', { agName: 'AG2', agRole: 'SECONDARY' })
    ])
    const headers = rows.filter((r) => r.kind === 'ag')
    expect(headers.map((h) => (h.kind === 'ag' ? h.agName : ''))).toEqual(['AG1', 'AG2'])
  })

  it('matches AG names case-insensitively / trimmed but preserves display casing', () => {
    const rows = buildDisplayRows([
      srv('x', { agName: 'AG-Mix', agRole: 'PRIMARY' }),
      srv('y', { agName: ' ag-mix ', agRole: 'SECONDARY' })
    ])
    const header = rows.find((r) => r.kind === 'ag')
    expect(header?.kind === 'ag' && header.agName).toBe('AG-Mix')
    expect(header?.kind === 'ag' && header.members.length).toBe(2)
  })
})
