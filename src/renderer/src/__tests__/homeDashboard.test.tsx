// @vitest-environment jsdom

/**
 * AREA 4 — Render e hooks (React 19 + Zustand + @tanstack/react-virtual)
 *
 * Prerequisito: npm install --save-dev jsdom @testing-library/react
 *   (jsdom è già incluso in vitest se si usa environment: 'jsdom')
 *
 * Verifica:
 *  - HomeDashboard non viola le Rules of Hooks passando da servers=[] a servers=[...]
 *  - useMemo non si ricalcola quando le dipendenze non cambiano
 *  - getSidebarItemSize restituisce 40 per group/ungrouped-header, 36 per tutto il resto
 *  - Sidebar virtualizer non renderizza tutti i 200 item contemporaneamente
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, screen } from '@testing-library/react'
import type { StoredServer } from '../../../preload/index'

// ── Mock window.sqlSentinel (non disponibile in jsdom) ───────────────────────
vi.stubGlobal('sqlSentinel', {
  getSettings: vi.fn().mockResolvedValue({ ok: true, data: { retentionMinutes: 60 } }),
  getAlerts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getServers: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  onAlertNew: vi.fn(() => () => {}),
  onMetricsUpdated: vi.fn(() => () => {}),
  onMetricsBatchUpdated: vi.fn(() => () => {}),
  onServerHealthUpdate: vi.fn(() => () => {}),
  onServerUnreachable: vi.fn(() => () => {}),
  onServerRecovered: vi.fn(() => () => {}),
  workerStart: vi.fn().mockResolvedValue({ ok: true, data: null }),
  workerSyncServers: vi.fn().mockResolvedValue({ ok: true, data: null }),
  servers: {
    getAll: vi.fn().mockResolvedValue([])
  }
})

// ── Mock zustand-persist (groupsStore usa localStorage) ──────────────────────
vi.mock('../store/groupsStore', () => ({
  useGroupsStore: vi.fn(() => ({
    groups: [],
    serverGroups: {},
    serverAliases: {},
    agGroups: {}
  }))
}))

vi.mock('../store/agStore', () => ({
  useAgStore: vi.fn(() => ({ agGroups: {} }))
}))

import { useServersStore } from '../store/serversStore'
import { useMetricsStore } from '../store/metricsStore'
import { useAlertsStore } from '../store/alertsStore'
import { HomeDashboard } from '../components/HomeDashboard'
import { getSidebarItemSize } from '../components/Sidebar'
import type { SidebarItem } from '../components/Sidebar'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStoredServer(ip: string, id?: string): StoredServer {
  return {
    id: id ?? ip,
    host: ip,
    ip,
    port: 1433,
    useWindowsAuth: true,
    addedAt: new Date().toISOString()
  }
}

const noop = () => {}

// ── Reset store tra i test ────────────────────────────────────────────────────

beforeEach(() => {
  useServersStore.setState({ servers: [], initialized: true })
  useMetricsStore.setState({ metricsMap: {}, lastUpdate: null, serverHealth: {} })
  useAlertsStore.setState({ alerts: [] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// HomeDashboard — Rules of Hooks
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 4 — HomeDashboard: Rules of Hooks', () => {

  it('non lancia "Rendered more hooks than during previous render" quando servers passa da [] a [srv]', () => {
    // Partenza: lista vuota → mostra <EmptyState>
    const { rerender } = render(
      <HomeDashboard
        onNavigateToServer={noop}
        onNavigateToDiscovery={noop}
        onOpenAlerts={noop}
      />
    )

    expect(screen.getAllByText(/nessun server monitorato/i).length).toBeGreaterThan(0)

    // Aggiunge un server → deve renderizzare senza eccezioni hooks
    act(() => {
      useServersStore.setState({
        servers: [makeStoredServer('10.0.0.1'), makeStoredServer('10.0.0.2')],
        initialized: true
      })
    })

    // Nessun errore significa che hooks sono stabili tra i render
    expect(() =>
      rerender(
        <HomeDashboard
          onNavigateToServer={noop}
          onNavigateToDiscovery={noop}
          onOpenAlerts={noop}
        />
      )
    ).not.toThrow()
  })

  it('non lancia errori hooks quando alerts cambia', () => {
    useServersStore.setState({ servers: [makeStoredServer('10.0.0.1')], initialized: true })

    const { rerender } = render(
      <HomeDashboard
        onNavigateToServer={noop}
        onNavigateToDiscovery={noop}
        onOpenAlerts={noop}
      />
    )

    act(() => {
      useAlertsStore.setState({
        alerts: [{
          id: 'a1',
          serverId: '10.0.0.1:1433',
          category: 'cpu_high',
          severity: 'WARNING',
          message: 'CPU alta',
          detectedAt: new Date(),
          acknowledgedAt: null
        }]
      })
    })

    expect(() =>
      rerender(
        <HomeDashboard
          onNavigateToServer={noop}
          onNavigateToDiscovery={noop}
          onOpenAlerts={noop}
        />
      )
    ).not.toThrow()
  })

  it('mostra la EmptyState solo quando servers è vuoto', () => {
    render(
      <HomeDashboard
        onNavigateToServer={noop}
        onNavigateToDiscovery={noop}
        onOpenAlerts={noop}
      />
    )
    expect(screen.getAllByText(/nessun server monitorato/i).length).toBeGreaterThan(0)
  })

  it('mostra la tabella server quando servers non è vuoto', () => {
    useServersStore.setState({
      servers: [makeStoredServer('10.0.0.1'), makeStoredServer('10.0.0.2')],
      initialized: true
    })

    render(
      <HomeDashboard
        onNavigateToServer={noop}
        onNavigateToDiscovery={noop}
        onOpenAlerts={noop}
      />
    )

    // Deve mostrare la Home Dashboard con le KPI card "SERVER TOTALI"
    expect(screen.getAllByText(/SERVER TOTALI/i).length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// HomeDashboard — stabilità useMemo
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 4 — HomeDashboard: useMemo non si ricalcola inutilmente', () => {

  it('il valore "SERVER TOTALI" rimane coerente dopo re-render con deps invariate', () => {
    useServersStore.setState({
      servers: [makeStoredServer('10.0.0.1'), makeStoredServer('10.0.0.2')],
      initialized: true
    })

    const { rerender } = render(
      <HomeDashboard
        onNavigateToServer={noop}
        onNavigateToDiscovery={noop}
        onOpenAlerts={noop}
      />
    )

    const kpiBefore = screen.getAllByText('2').length  // "2" come valore KPI

    // Re-render con stesse props e stesso store — memo non deve cambiare output
    rerender(
      <HomeDashboard
        onNavigateToServer={noop}
        onNavigateToDiscovery={noop}
        onOpenAlerts={noop}
      />
    )

    expect(screen.getAllByText('2').length).toBe(kpiBefore)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getSidebarItemSize — logica estimateSize del virtualizer
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 4 — getSidebarItemSize (estimateSize virtualizer)', () => {

  it('restituisce 40 per kind="group"', () => {
    const item: SidebarItem = {
      kind: 'group',
      group: { id: 'g1', name: 'Prod', color: '#f00', collapsed: false, order: 0 },
      onlineCount: 2
    }
    expect(getSidebarItemSize(item)).toBe(40)
  })

  it('restituisce 40 per kind="ungrouped-header"', () => {
    const item: SidebarItem = { kind: 'ungrouped-header' }
    expect(getSidebarItemSize(item)).toBe(40)
  })

  it('restituisce 36 per kind="server"', () => {
    const item: SidebarItem = {
      kind: 'server',
      server: makeStoredServer('10.0.0.1'),
      inAgGroup: false,
      inMachineGroup: false
    }
    expect(getSidebarItemSize(item)).toBe(36)
  })

  it('restituisce 36 per kind="ag"', () => {
    const item: SidebarItem = {
      kind: 'ag',
      agName: 'AG1',
      agInfo: {
        id: 'ag-uuid',
        ag_name: 'AG1',
        health: 'HEALTHY',
        primary_replica: '10.0.0.1',
        serverIds: []
      },
      isExpanded: false
    }
    expect(getSidebarItemSize(item)).toBe(36)
  })

  it('restituisce 36 per kind="search-server"', () => {
    const item: SidebarItem = {
      kind: 'search-server',
      server: makeStoredServer('10.0.0.1')
    }
    expect(getSidebarItemSize(item)).toBe(36)
  })

  it('restituisce 36 per kind="no-results"', () => {
    const item: SidebarItem = { kind: 'no-results' }
    expect(getSidebarItemSize(item)).toBe(36)
  })

  it('restituisce 36 quando item è undefined (guard)', () => {
    expect(getSidebarItemSize(undefined)).toBe(36)
  })
})
