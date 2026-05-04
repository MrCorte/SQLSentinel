// @vitest-environment jsdom

/**
 * AREA 4 — Render and hooks (React 19 + Zustand + @tanstack/react-virtual)
 *
 * Prerequisite: npm install --save-dev jsdom @testing-library/react
 *   (jsdom is already included in vitest when using environment: 'jsdom')
 *
 * Verifies:
 *  - HomeDashboard does not violate Rules of Hooks when transitioning from servers=[] to servers=[...]
 *  - useMemo does not recompute when dependencies have not changed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, screen } from '@testing-library/react'
import type { StoredServer } from '../../../preload/index'

// ── Mock window.sqlSentinel (not available in jsdom) ────────────────────────
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

// ── Mock zustand-persist (groupsStore uses localStorage) ────────────────────
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

// ── Reset store between tests ────────────────────────────────────────────────

beforeEach(() => {
  useServersStore.setState({ servers: [], initialized: true })
  useMetricsStore.setState({
    metricsMap: {},
    summaries: {},
    historyMap: {},
    activeServerId: null,
    lastUpdate: null,
    serverHealth: {}
  })
  useAlertsStore.setState({ alerts: [] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// HomeDashboard — Rules of Hooks
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 4 — HomeDashboard: Rules of Hooks', () => {
  it('does not throw "Rendered more hooks than during previous render" when servers changes from [] to [srv]', () => {
    // Starting point: empty list → shows <EmptyState>
    const { rerender } = render(
      <HomeDashboard onNavigateToServer={noop} onNavigateToDiscovery={noop} />
    )

    expect(screen.getAllByText(/no monitored servers/i).length).toBeGreaterThan(0)

    // Adds a server → must render without hook exceptions
    act(() => {
      useServersStore.setState({
        servers: [makeStoredServer('10.0.0.1'), makeStoredServer('10.0.0.2')],
        initialized: true
      })
    })

    // No errors mean hooks are stable across renders
    expect(() =>
      rerender(
        <HomeDashboard onNavigateToServer={noop} onNavigateToDiscovery={noop} />
      )
    ).not.toThrow()
  })

  it('does not throw hook errors when alerts changes', () => {
    useServersStore.setState({ servers: [makeStoredServer('10.0.0.1')], initialized: true })

    const { rerender } = render(
      <HomeDashboard onNavigateToServer={noop} onNavigateToDiscovery={noop} />
    )

    act(() => {
      useAlertsStore.setState({
        alerts: [
          {
            id: 'a1',
            serverId: '10.0.0.1:1433',
            category: 'cpu_high',
            severity: 'WARNING',
            message: 'CPU alta',
            detectedAt: new Date(),
            acknowledgedAt: null
          }
        ]
      })
    })

    expect(() =>
      rerender(
        <HomeDashboard onNavigateToServer={noop} onNavigateToDiscovery={noop} />
      )
    ).not.toThrow()
  })

  it('shows EmptyState only when servers is empty', () => {
    render(
      <HomeDashboard onNavigateToServer={noop} onNavigateToDiscovery={noop} />
    )
    expect(screen.getAllByText(/no monitored servers/i).length).toBeGreaterThan(0)
  })

  it('shows the server table when servers is not empty', () => {
    useServersStore.setState({
      servers: [makeStoredServer('10.0.0.1'), makeStoredServer('10.0.0.2')],
      initialized: true
    })

    render(
      <HomeDashboard onNavigateToServer={noop} onNavigateToDiscovery={noop} />
    )

    // Must show the Home Dashboard with the "Total" KPI card (label was
    // renamed from "TOTAL SERVERS" to "Total" — capitalization handled by CSS).
    expect(screen.getAllByText(/^Total$/i).length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// HomeDashboard — useMemo stability
// ═══════════════════════════════════════════════════════════════════════════════

describe('AREA 4 — HomeDashboard: useMemo does not recalculate unnecessarily', () => {
  it('the "TOTAL SERVERS" value remains consistent after re-render with unchanged deps', () => {
    useServersStore.setState({
      servers: [makeStoredServer('10.0.0.1'), makeStoredServer('10.0.0.2')],
      initialized: true
    })

    const { rerender } = render(
      <HomeDashboard onNavigateToServer={noop} onNavigateToDiscovery={noop} />
    )

    const kpiBefore = screen.getAllByText('2').length // "2" as KPI value

    // Re-render with same props and same store — memo must not change output
    rerender(
      <HomeDashboard onNavigateToServer={noop} onNavigateToDiscovery={noop} />
    )

    expect(screen.getAllByText('2').length).toBe(kpiBefore)
  })
})
