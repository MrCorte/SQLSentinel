// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import type { Incident } from '../../../preload/index'

vi.mock('../components/incidents/IncidentDetailDrawer', () => ({
  IncidentDetailDrawer: () => null
}))

import { Incidents } from '../pages/Incidents'
import { useIncidentsStore } from '../store/incidentsStore'

function makeIncident(id: string, serverId: string, openedAt: number): Incident {
  return {
    id,
    serverId,
    category: 'backup_overdue',
    severity: 'WARNING',
    status: 'open',
    openedAt
  }
}

beforeEach(() => {
  useIncidentsStore.setState({
    incidents: [],
    openCount: 0,
    aiStats: null,
    selectedId: null,
    detail: null,
    loadingDetail: false
  })
  vi.stubGlobal('sqlSentinel', {
    incidents: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          makeIncident('inc-1', 'localhost:1434', Date.parse('2026-05-25T16:22:46Z')),
          makeIncident('inc-2', 'localhost:1434', Date.parse('2026-05-25T17:20:12Z')),
          makeIncident('inc-3', 'localhost:1434', Date.parse('2026-05-25T21:15:38Z')),
          makeIncident('inc-4', 'localhost:1435', Date.parse('2026-05-25T18:14:45Z'))
        ]
      }),
      countOpen: vi.fn().mockResolvedValue({ ok: true, data: 4 }),
      aiStats: vi.fn().mockResolvedValue({ ok: true, data: null }),
      onCreated: vi.fn(() => () => {}),
      onUpdated: vi.fn(() => () => {})
    }
  })
})

afterEach(() => cleanup())

describe('Incidents grouping', () => {
  it('compacts incidents with the same server and category into a single row', async () => {
    render(<Incidents />)

    await waitFor(() => {
      expect(screen.getAllByText('localhost:1434')).toHaveLength(1)
    })
    expect(screen.getAllByText('backup overdue')).toHaveLength(2)
    expect(screen.getByText('3')).toBeTruthy()
  })
})
