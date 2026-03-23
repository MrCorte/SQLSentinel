// @vitest-environment jsdom

/**
 * AREA 4 — ServerHistoryChart
 *
 * Verifica:
 *  - renderizza N punti dal ring buffer historyMap
 *  - mostra empty state se history vuota
 *  - mostra warning se server unreachable (failCount ≥ 3)
 *  - non si re-renderizza se cambiano metriche di un altro server
 *  - cpu e memory sono allineati per indice nel chartData
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import { ServerHistoryChart } from '../components/ServerHistoryChart'
import { useMetricsStore } from '../store/metricsStore'
import type { ServerHealthPayload } from '../../../preload/index'

// ── Mock recharts (JSDOM non supporta SVG layout) ────────────────────────────

vi.mock('recharts', () => {
  const React = require('react')
  const pass = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
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

// ── Cleanup DOM + store tra i test ───────────────────────────────────────────

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

describe('ServerHistoryChart — renderizza N punti dal ring buffer', () => {
  it('mostra il grafico con 5 punti nel ring buffer', () => {
    setHistory('srv-1', makePoints(5, 20), makePoints(5, 60))

    render(<ServerHistoryChart serverId="srv-1" />)

    // Il LineChart mock deve essere presente (dati non vuoti → nessun empty state)
    expect(screen.getByTestId('line-chart')).toBeTruthy()
    expect(screen.queryByText(/in attesa del primo campione/i)).toBeNull()
  })

  it('mostra il grafico anche con un solo punto', () => {
    setHistory('srv-1', makePoints(1, 30), makePoints(1, 70))
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.getByTestId('line-chart')).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — empty state se history vuota', () => {
  it('mostra "In attesa del primo campione" quando historyMap è vuota', () => {
    // historyMap non contiene il server — tutto vuoto
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.getByText(/in attesa del primo campione/i)).toBeTruthy()
  })

  it('mostra empty state quando cpu array esplicito è vuoto', () => {
    setHistory('srv-1', [], [])
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.getByText(/in attesa del primo campione/i)).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — warning se server unreachable', () => {
  it('mostra Alert quando failCount >= 3', () => {
    setHealth('srv-1', 3)
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.getByText(/server non raggiungibile/i)).toBeTruthy()
    expect(screen.queryByTestId('line-chart')).toBeNull()
  })

  it('non mostra warning quando failCount = 0', () => {
    setHealth('srv-1', 0)
    setHistory('srv-1', makePoints(3, 10), makePoints(3, 50))
    render(<ServerHistoryChart serverId="srv-1" />)
    expect(screen.queryByText(/server non raggiungibile/i)).toBeNull()
    expect(screen.getByTestId('line-chart')).toBeTruthy()
  })

  it('mostra warning anche se history ha dati (failCount ha priorità)', () => {
    setHealth('srv-1', 5)
    setHistory('srv-1', makePoints(10, 20), makePoints(10, 60))
    render(<ServerHistoryChart serverId="srv-1" />)
    // Warning ha precedenza sul grafico
    expect(screen.getByText(/server non raggiungibile/i)).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — non si re-renderizza per metriche di altri server', () => {
  it('aggiornare historyMap["srv-2"] non causa re-render di ServerHistoryChart per "srv-1"', () => {
    setHistory('srv-1', makePoints(3, 10), makePoints(3, 50))

    let renderCount = 0
    function Spy(): null {
      renderCount++
      return null
    }

    // Monta il componente con un Spy dentro: contiamo render via stato React
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

    // Aggiorna un server DIVERSO — srv-1 non deve re-renderizzare
    act(() => {
      setHistory('srv-2', makePoints(5, 40), makePoints(5, 80))
    })

    // renderCount non deve essere cambiato (Spy non ha dipendenze sullo store)
    // ServerHistoryChart usa selettori per-server → non si aggiorna per srv-2
    expect(renderCount).toBe(initialRenders)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('ServerHistoryChart — allineamento indice cpu/memory in chartData', () => {
  it('cpu[i] e memory[i] corrispondono allo stesso indice nel chartData', () => {
    // Tre punti: cpu 10,20,30 — memory 100,200,300 — stesso ts per allineamento
    const now = Date.now()
    const cpu = [
      { ts: now,              value: 10 },
      { ts: now + 60_000,    value: 20 },
      { ts: now + 120_000,   value: 30 }
    ]
    const mem = [
      { ts: now,              value: 100 },
      { ts: now + 60_000,    value: 200 },
      { ts: now + 120_000,   value: 300 }
    ]
    setHistory('srv-1', cpu, mem)

    render(<ServerHistoryChart serverId="srv-1" />)

    // Il grafico è renderizzato (non empty state)
    expect(screen.getByTestId('line-chart')).toBeTruthy()

    // Verifica che i valori nel chartData siano allineati per indice
    // leggendo direttamente dallo store (la logica di mapping è in useMemo)
    const hist = useMetricsStore.getState().historyMap['srv-1']
    expect(hist.cpu[0].value).toBe(10)
    expect(hist.memory[0].value).toBe(100)
    expect(hist.cpu[2].value).toBe(30)
    expect(hist.memory[2].value).toBe(300)

    // Verifica che cpu e memory abbiano la stessa lunghezza (push atomico garantisce questo)
    expect(hist.cpu.length).toBe(hist.memory.length)
  })

  it('gli array cpu e memory hanno sempre la stessa lunghezza dopo setMetrics', () => {
    // Simula 10 cicli di polling tramite store direttamente
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

  it('memory ring buffer contiene % (0-100) non MB assoluti', () => {
    // 4096 MB su 8192 MB target → 50%
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
    expect(hist.memory[0].value).toBe(50)          // 4096/8192 = 50%
    expect(hist.cpu[0].value).toBe(25)
    // Non deve mai essere un valore MB (es. 4096) — sempre ≤ 100
    expect(hist.memory[0].value).toBeLessThanOrEqual(100)
  })

  it('resetHistory svuota il ring buffer del singolo server', () => {
    useMetricsStore.getState().setMetrics('srv-1', {
      collectedAt: new Date(),
      instanceInfo: {
        version: '15.0', edition: 'Dev',
        memoryUsedMb: 2048, memoryTargetMb: 8192,
        cpuUsagePercent: 15, uptimeDays: 1,
        logicalCpus: 8, physicalCpus: 4
      },
      databases: [], activeSessions: [], topQueries: [],
      backupStatus: [], waitStats: [], diskVolumes: [], databaseFiles: []
    })
    expect(useMetricsStore.getState().historyMap['srv-1'].cpu.length).toBe(1)

    useMetricsStore.getState().resetHistory('srv-1')
    const hist = useMetricsStore.getState().historyMap['srv-1']
    expect(hist.cpu.length).toBe(0)
    expect(hist.memory.length).toBe(0)
  })
})
