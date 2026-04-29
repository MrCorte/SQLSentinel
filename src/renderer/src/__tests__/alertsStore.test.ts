import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAlertsStore } from '../store/alertsStore'
import type { Alert } from '../../../preload/index'

const RESET = { alerts: [] }

function makeAlert(id: string, overrides: Partial<Alert> = {}): Alert {
  return {
    id,
    serverId: '10.0.0.1:1433',
    category: 'cpu_high',
    severity: 'WARNING',
    message: `Alert ${id}`,
    detectedAt: new Date(),
    acknowledgedAt: null,
    ...overrides
  }
}

beforeEach(() => {
  useAlertsStore.setState(RESET)
})

describe('alertsStore — setAlerts', () => {
  it('stores alerts that are within 7 days', () => {
    const recent = makeAlert('1')
    useAlertsStore.getState().setAlerts([recent])
    expect(useAlertsStore.getState().alerts).toHaveLength(1)
  })

  it('discards alerts older than 7 days', () => {
    const old = makeAlert('old', {
      detectedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    })
    useAlertsStore.getState().setAlerts([old])
    expect(useAlertsStore.getState().alerts).toHaveLength(0)
  })

  it('keeps alerts exactly at the 7-day boundary', () => {
    const boundary = makeAlert('boundary', {
      detectedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 1000)
    })
    useAlertsStore.getState().setAlerts([boundary])
    expect(useAlertsStore.getState().alerts).toHaveLength(1)
  })

  it('trims to MAX_ALERTS (500) when list exceeds it', () => {
    const alerts = Array.from({ length: 600 }, (_, i) => makeAlert(String(i)))
    useAlertsStore.getState().setAlerts(alerts)
    expect(useAlertsStore.getState().alerts).toHaveLength(500)
  })

  it('keeps the most recent alerts when trimming to MAX_ALERTS', () => {
    const alerts = Array.from({ length: 600 }, (_, i) => makeAlert(String(i)))
    useAlertsStore.getState().setAlerts(alerts)
    const stored = useAlertsStore.getState().alerts
    // The last 500 of the 600 should be kept (slice from end)
    expect(stored[0].id).toBe('100')
    expect(stored[499].id).toBe('599')
  })
})

describe('alertsStore — addAlert', () => {
  it('appends a new alert', () => {
    useAlertsStore.getState().addAlert(makeAlert('1'))
    useAlertsStore.getState().addAlert(makeAlert('2'))
    expect(useAlertsStore.getState().alerts).toHaveLength(2)
  })

  it('filters out old alerts when adding', () => {
    const old = makeAlert('old', {
      detectedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    })
    useAlertsStore.setState({ alerts: [old] })
    useAlertsStore.getState().addAlert(makeAlert('new'))
    // old should be removed, new should be present
    const stored = useAlertsStore.getState().alerts
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe('new')
  })

  it('trims to MAX_ALERTS after adding', () => {
    const alerts = Array.from({ length: 499 }, (_, i) => makeAlert(String(i)))
    useAlertsStore.setState({ alerts })
    useAlertsStore.getState().addAlert(makeAlert('new1'))
    useAlertsStore.getState().addAlert(makeAlert('new2'))
    expect(useAlertsStore.getState().alerts).toHaveLength(500)
  })
})

describe('alertsStore — acknowledgeAlert', () => {
  it('sets acknowledgedAt on the matching alert', () => {
    useAlertsStore.setState({ alerts: [makeAlert('1'), makeAlert('2')] })
    useAlertsStore.getState().acknowledgeAlert('1')
    const a1 = useAlertsStore.getState().alerts.find((a) => a.id === '1')
    expect(a1?.acknowledgedAt).not.toBeNull()
  })

  it('does not modify other alerts', () => {
    useAlertsStore.setState({ alerts: [makeAlert('1'), makeAlert('2')] })
    useAlertsStore.getState().acknowledgeAlert('1')
    const a2 = useAlertsStore.getState().alerts.find((a) => a.id === '2')
    expect(a2?.acknowledgedAt).toBeNull()
  })

  it('is a no-op for an unknown id', () => {
    useAlertsStore.setState({ alerts: [makeAlert('1')] })
    expect(() => useAlertsStore.getState().acknowledgeAlert('nonexistent')).not.toThrow()
    expect(useAlertsStore.getState().alerts).toHaveLength(1)
  })
})

describe('alertsStore — deleteServerAlerts', () => {
  it('removes all alerts for a specific serverId', () => {
    useAlertsStore.setState({
      alerts: [
        makeAlert('1', { serverId: 'A:1433' }),
        makeAlert('2', { serverId: 'B:1433' }),
        makeAlert('3', { serverId: 'A:1433' })
      ]
    })
    useAlertsStore.getState().deleteServerAlerts('A:1433')
    const remaining = useAlertsStore.getState().alerts
    expect(remaining).toHaveLength(1)
    expect(remaining[0].serverId).toBe('B:1433')
  })

  it('is a no-op when no alerts match', () => {
    useAlertsStore.setState({ alerts: [makeAlert('1', { serverId: 'X:1433' })] })
    useAlertsStore.getState().deleteServerAlerts('Y:1433')
    expect(useAlertsStore.getState().alerts).toHaveLength(1)
  })
})
