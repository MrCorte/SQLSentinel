// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { randomUUID } from 'node:crypto'
import type { StoredServer, ServerMetrics } from '../../../preload/index'

const mockRefresh = vi.fn()
const mockReceiveMetrics = vi.fn()
const authError =
  'Login failed. The login is from an untrusted domain and cannot be used with Integrated authentication.'

vi.mock('../hooks/useMetrics', () => ({
  useMetrics: vi.fn(() => ({
    metrics: null,
    isLoading: false,
    error: authError,
    refresh: mockRefresh,
    receiveMetrics: mockReceiveMetrics
  }))
}))

vi.mock('../context/useWorker', () => ({
  useWorker: () => ({
    intervalSeconds: 0,
    setIntervalSeconds: vi.fn(),
    setConnection: vi.fn(),
    pushSnapshot: vi.fn()
  })
}))

vi.mock('../store/agStore', () => ({
  useAgStore: vi.fn(() => vi.fn()),
}))

vi.mock('../api/ipc', () => ({
  getAllDbCustomFields: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  setDbCustomFields: vi.fn().mockResolvedValue({ ok: true, data: null }),
  servers: {
    getAll: vi.fn(),
    add: vi.fn(),
    update: vi.fn().mockResolvedValue({ success: true }),
    remove: vi.fn()
  }
}))

import * as ipc from '../api/ipc'
import { Dashboard } from '../pages/Dashboard'
import { useAppStore } from '../store/appStore'
import { useServersStore } from '../store/serversStore'
import { useMetricsStore } from '../store/metricsStore'

function makeServer(): StoredServer {
  return {
    id: 'srv-1',
    host: '192.168.1.137',
    ip: '192.168.1.137',
    port: 1434,
    useWindowsAuth: true,
    addedAt: '2026-05-27T00:00:00.000Z'
  }
}

function makeMetrics(): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: '16.0',
      edition: 'Developer',
      memoryUsedMb: 1024,
      memoryTargetMb: 4096,
      cpuUsagePercent: 5,
      uptimeDays: 1,
      logicalCpus: 4,
      physicalCpus: 2
    },
    databases: [],
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: []
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('sqlSentinel', {
    onMetricsBatchUpdated: vi.fn(() => () => {}),
    collectMetrics: vi.fn().mockResolvedValue({ ok: true, data: makeMetrics() }),
    workerSetActive: vi.fn().mockResolvedValue({ ok: true, data: null })
  })
  useServersStore.setState({ servers: [makeServer()], initialized: true })
  useAppStore.setState({ selectedServerId: 'srv-1' })
  useMetricsStore.setState({
    metricsMap: {},
    summaries: {},
    historyMap: {},
    activeServerId: null,
    lastUpdate: null,
    serverHealth: {}
  })
})

afterEach(() => cleanup())

describe('Dashboard credential retry', () => {
  it('lets the user replace failed Windows auth credentials and retry metrics collection', async () => {
    const enteredUsername = `user_${randomUUID().replaceAll('-', '')}`
    const enteredPassword = randomUUID()
    render(<Dashboard />)

    fireEvent.click(screen.getByRole('button', { name: /update credentials/i }))
    fireEvent.click(screen.getByRole('switch', { name: /windows authentication/i }))
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: enteredUsername } })
    fireEvent.change(screen.getByLabelText(/^password$/i, { selector: 'input' }), {
      target: { value: enteredPassword }
    })
    fireEvent.click(screen.getByRole('button', { name: /save and retry/i }))

    await waitFor(() => {
      expect(ipc.servers.update).toHaveBeenCalledWith(
        'srv-1',
        expect.objectContaining({
          useWindowsAuth: false,
          username: enteredUsername,
          password: enteredPassword
        })
      )
    })
    expect(window.sqlSentinel.collectMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        ip: '192.168.1.137',
        port: 1434,
        useWindowsAuth: false,
        username: enteredUsername,
        password: enteredPassword
      })
    )
  })
})
