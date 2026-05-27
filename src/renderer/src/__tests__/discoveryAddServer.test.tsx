// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { StoredServer } from '../../../preload/index'

vi.mock('@mui/x-data-grid', () => ({
  DataGrid: () => <div data-testid="discovery-grid" />
}))

vi.mock('../api/ipc', () => ({
  servers: {
    getAll: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    update: vi.fn()
  }
}))

vi.mock('../store/agStore', () => ({
  useAgStore: {
    getState: () => ({ detectAgsForServer: vi.fn(), agGroups: {} })
  }
}))

import * as ipc from '../api/ipc'
import { Discovery } from '../pages/Discovery'
import { useServersStore } from '../store/serversStore'

const mockIpc = {
  servers: {
    add: vi.mocked(ipc.servers.add)
  }
}

function makeServer(overrides: Partial<StoredServer> = {}): StoredServer {
  return {
    id: 'srv-1',
    host: 'localhost',
    ip: 'localhost',
    port: 1433,
    useWindowsAuth: true,
    addedAt: '2026-05-27T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useServersStore.setState({ servers: [], initialized: true })
  mockIpc.servers.add.mockResolvedValue({ success: true, server: makeServer() })
  vi.stubGlobal('sqlSentinel', {
    scanSubnet: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    cancelScan: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: false } }),
    onScanProgress: vi.fn(() => () => {}),
    addServerManual: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ip: 'localhost',
        port: 1433,
        reachable: true,
        responseTimeMs: 1,
        discoveredAt: new Date()
      }
    }),
    resolveHostname: vi.fn().mockResolvedValue({ ok: false, error: 'No PTR record' }),
    detectServerInfo: vi.fn().mockResolvedValue({
      ok: true,
      data: { machineName: 'localhost', instanceName: '' }
    })
  })
})

describe('Discovery add server dialog', () => {
  it('saves through the persistent server store without calling legacy addServerManual', async () => {
    render(<Discovery />)

    fireEvent.click(screen.getByRole('button', { name: /add manually/i }))
    fireEvent.change(screen.getByLabelText(/ip \/ hostname/i), {
      target: { value: 'localhost' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(mockIpc.servers.add).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'localhost', port: 1433, useWindowsAuth: true })
      )
    })
    expect(window.sqlSentinel.addServerManual).not.toHaveBeenCalled()
  })
})
