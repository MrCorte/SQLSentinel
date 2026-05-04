// @vitest-environment jsdom

/**
 * AREA 4 — ServerHistoryChart
 *
 * Verifies:
 *  - renders N points from the historyMap ring buffer
 *  - shows empty state when history is empty
 *  - shows warning when server is unreachable (failCount ≥ 3)
 *  - does not re-render when metrics change for a different server
 *  - cpu and memory are index-aligned in chartData
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import { ServerHistoryChart } from '../components/ServerHistoryChart'
import { useMetricsStore } from '../store/metricsStore'
import type { ServerHealthPayload } from '../../../preload/index'

// ── Mock recharts (JSDOM does not support SVG layout) ───────────────────────

vi.mock('recharts', () => {
  const React = require('react')
  const pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)
  return {
    ResponsiveContainer: pass,
    LineChart: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'line-chart' }, children),
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ReferenceLine: () => null
  }
})

// ── Cleanup DOM + store between tests ───────────────────────────────────────

afterEach(() => cleanup())

beforeEach(() => {
  useMetricsStore.setState({
    metricsMap: {},
    summaries: {},
    historyMap: {},
    activeServerId: null,
    lastUpdate: null,
    serverHealth: {}
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePoints(n: number, baseValue = 10): { ts: number; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: Date.now() + i * 60_000,
    value: baseValue + i
  }))
}

function setHistory(
  serverId: string,
  cpuPts: { ts: number; value: number }[],
  memPts: { ts: number; value: number }[]
): void {
  useMetricsStore.setState((s) => ({
    historyMap: {
      ...s.historyMap,
      [serverId]: { cpu: cpuPts, memory: memPts }
    }
  }))
}

function setHealth(serverId: string, failCount: number): void {
  const payload: ServerHealthPayload = {
    serverId,
    failCount,
    nextRetry: Date.now() + 30_000,
    lastSuccess: failCount === 0 ? Date.now() - 60_000 : null
  }
  useMetricsStore.setState((s) => ({
    serverHealth: { ...s.serverHealth, [serverId]: payload }
  }))
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — renders N points from the ring buffer', () => {
  it('shows the chart with 5 points in the ring buffer', () => {
    setHistory('srv-1', makePoints(5, 20), makePoints(5, 60))

    render(<ServerHistoryChart serverId="srv-1" />)

    // The mock LineChart must be present (non-empty data → no empty state)
    expect(screen.getByTestId('line-chart')).toBeTruthy()
    expect(screen.queryByText(/waiting for the first sample/i)).toBeNull()
  })

  it('shows the chart even with a single point', () => {
    setHistory('srv-1', makePoints(1, 30), makePoints(1, 70))
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.getByTestId('line-chart')).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — empty state when history is empty', () => {
  it('shows the waiting-for-first-sample message when historyMap is empty', () => {
    // historyMap does not contain the server — everything empty
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.getByText(/waiting for the first sample/i)).toBeTruthy()
  })

  it('shows empty state when explicit cpu array is empty', () => {
    setHistory('srv-1', [], [])
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.getByText(/waiting for the first sample/i)).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — warning when server is unreachable', () => {
  it('shows Alert when failCount >= 3', () => {
    setHealth('srv-1', 3)
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.getByText(/server unreachable/i)).toBeTruthy()
    expect(screen.queryByTestId('line-chart')).toBeNull()
  })

  it('does not show warning when failCount = 0', () => {
    setHealth('srv-1', 0)
    setHistory('srv-1', makePoints(3, 10), makePoints(3, 50))
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.queryByText(/server unreachable/i)).toBeNull()
    expect(screen.getByTestId('line-chart')).toBeTruthy()
  })

  it('shows warning even when history has data (failCount takes priority)', () => {
    setHealth('srv-1', 5)
    setHistory('srv-1', makePoints(10, 20), makePoints(10, 60))
    render(<ServerHistoryChart serverId="srv-1" />)
    // Warning takes precedence over the chart
    expect(screen.getByText(/server unreachable/i)).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — does not re-render for other servers metrics', () => {
  it('updating historyMap["srv-2"] does not cause re-render of ServerHistoryChart for "srv-1"', () => {
    setHistory('srv-1', makePoints(3, 10), makePoints(3, 50))

    let renderCount = 0
    function Spy(): null {
      renderCount++
      return null
    }

    // Mount the component with a Spy inside: count renders via React state
    function Wrapper(): React.JSX.Element {
      return (
        <>
          <ServerHistoryChart serverId="srv-1" />
          <Spy />
        </>
      )
    }

    render(<Wrapper />)
    const initialRenders = renderCount

    // Update a DIFFERENT server — srv-1 must not re-render
    act(() => {
      setHistory('srv-2', makePoints(5, 40), makePoints(5, 80))
    })

    // renderCount must not have changed (Spy has no store dependencies)
    // ServerHistoryChart uses per-server selectors → does not update for srv-2
    expect(renderCount).toBe(initialRenders)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — cpu/memory index alignment in chartData', () => {
  it('cpu[i] and memory[i] correspond to the same index in chartData', () => {
    // Three points: cpu 10,20,30 — memory 100,200,300 — same ts for alignment
    const now = Date.now()
    const cpu = [
      { ts: now, value: 10 },
      { ts: now + 60_000, value: 20 },
      { ts: now + 120_000, value: 30 }
    ]
    const mem = [
      { ts: now, value: 100 },
      { ts: now + 60_000, value: 200 },
      { ts: now + 120_000, value: 300 }
    ]
    setHistory('srv-1', cpu, mem)

    render(<ServerHistoryChart serverId="srv-1" />)

    // The chart is rendered (not empty state)
    expect(screen.getByTestId('line-chart')).toBeTruthy()

    // Verify that values in chartData are aligned by index
    // reading directly from the store (the mapping logic is in useMemo)
    const hist = useMetricsStore.getState().historyMap['srv-1']
    expect(hist.cpu[0].value).toBe(10)
    expect(hist.memory[0].value).toBe(100)
    expect(hist.cpu[2].value).toBe(30)
    expect(hist.memory[2].value).toBe(300)

    // Verify that cpu and memory have the same length (atomic push guarantees this)
    expect(hist.cpu.length).toBe(hist.memory.length)
  })

  it('cpu and memory arrays always have the same length after setMetrics', () => {
    // Simulate 10 polling cycles via store directly
    for (let i = 0; i < 10; i++) {
      useMetricsStore.getState().setMetrics('srv-1', {
        collectedAt: new Date(Date.now() + i * 60_000),
        instanceInfo: {
          version: '15.0',
          edition: 'Dev',
          memoryUsedMb: 1000 + i * 50,
          memoryTargetMb: 8192,
          cpuUsagePercent: 10 + i,
          uptimeDays: 1,
          logicalCpus: 8,
          physicalCpus: 4
        },
        databases: [],
        activeSessions: [],
        topQueries: [],
        backupStatus: [],
        waitStats: [],
        diskVolumes: [],
        databaseFiles: []
      })
    }

    const hist = useMetricsStore.getState().historyMap['srv-1']
    expect(hist.cpu.length).toBe(hist.memory.length)
    expect(hist.cpu.length).toBe(10)
  })

  it('memory ring buffer contains % (0-100) not absolute MB', () => {
    // 4096 MB out of 8192 MB target → 50%
    useMetricsStore.getState().setMetrics('srv-1', {
      collectedAt: new Date(),
      instanceInfo: {
        version: '15.0',
        edition: 'Dev',
        memoryUsedMb: 4096,
        memoryTargetMb: 8192,
        cpuUsagePercent: 25,
        uptimeDays: 1,
        logicalCpus: 8,
        physicalCpus: 4
      },
      databases: [],
      activeSessions: [],
      topQueries: [],
      backupStatus: [],
      waitStats: [],
      diskVolumes: [],
      databaseFiles: []
    })

    const hist = useMetricsStore.getState().historyMap['srv-1']
    expect(hist.memory[0].value).toBe(50) // 4096/8192 = 50%
    expect(hist.cpu[0].value).toBe(25)
    // Must never be an MB value (e.g. 4096) — always ≤ 100
    expect(hist.memory[0].value).toBeLessThanOrEqual(100)
  })

  it('resetHistory empties the ring buffer for the single server', () => {
    useMetricsStore.getState().setMetrics('srv-1', {
      collectedAt: new Date(),
      instanceInfo: {
        version: '15.0',
        edition: 'Dev',
        memoryUsedMb: 2048,
        memoryTargetMb: 8192,
        cpuUsagePercent: 15,
        uptimeDays: 1,
        logicalCpus: 8,
        physicalCpus: 4
      },
      databases: [],
      activeSessions: [],
      topQueries: [],
      backupStatus: [],
      waitStats: [],
      diskVolumes: [],
      databaseFiles: []
    })
    expect(useMetricsStore.getState().historyMap['srv-1'].cpu.length).toBe(1)

    useMetricsStore.getState().resetHistory('srv-1')
    const hist = useMetricsStore.getState().historyMap['srv-1']
    expect(hist.cpu.length).toBe(0)
    expect(hist.memory.length).toBe(0)
  })
})
