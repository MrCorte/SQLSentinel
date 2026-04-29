import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock IPC layer before importing the store
vi.mock('../api/ipc', () => ({
  servers: {
    getAll: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    update: vi.fn()
  }
}))

// Mock agStore to avoid AG detection side-effects
vi.mock('../store/agStore', () => ({
  useAgStore: {
    getState: () => ({ detectAgsForServer: vi.fn(), agGroups: {} })
  }
}))

import { useServersStore } from '../store/serversStore'
import { useMetricsStore } from '../store/metricsStore'
import { useAlertsStore } from '../store/alertsStore'
import type { StoredServer } from '../../../preload/index'
import * as ipcMod from '../api/ipc'

const mockIpc = vi.mocked(ipcMod)

function makeServer(id: string, host = '10.0.0.1', port = 1433): StoredServer {
  return {
    id,
    host,
    ip: host,
    port,
    useWindowsAuth: true,
    addedAt: new Date().toISOString()
  }
}

const STORES_RESET = {
  servers: [],
  initialized: false
}

beforeEach(() => {
  vi.clearAllMocks()
  useServersStore.setState(STORES_RESET)
  useMetricsStore.setState({ metricsMap: {}, summaries: {}, historyMap: {}, serverHealth: {}, activeServerId: null, lastUpdate: null })
  useAlertsStore.setState({ alerts: [] })
})

// ── loadServers ───────────────────────────────────────────────────────────────

describe('loadServers', () => {
  it('populates servers with normalized host and ip fields', async () => {
    const raw = [{ id: 'srv1', host: '10.0.0.1', port: 1433, useWindowsAuth: true, addedAt: '' }]
    mockIpc.servers.getAll.mockResolvedValue(raw)
    await useServersStore.getState().loadServers()
    const servers = useServersStore.getState().servers
    expect(servers).toHaveLength(1)
    expect(servers[0].host).toBe('10.0.0.1')
    expect(servers[0].ip).toBe('10.0.0.1')
  })

  it('normalizes legacy "ip" field to "host"', async () => {
    const raw = [{ id: 'srv1', ip: '10.0.0.2', port: 1433, useWindowsAuth: true, addedAt: '' }]
    mockIpc.servers.getAll.mockResolvedValue(raw)
    await useServersStore.getState().loadServers()
    const servers = useServersStore.getState().servers
    expect(servers[0].host).toBe('10.0.0.2')
  })

  it('sets initialized=true on success', async () => {
    mockIpc.servers.getAll.mockResolvedValue([])
    await useServersStore.getState().loadServers()
    expect(useServersStore.getState().initialized).toBe(true)
  })

  it('sets initialized=true even when IPC throws', async () => {
    mockIpc.servers.getAll.mockRejectedValue(new Error('connection refused'))
    await useServersStore.getState().loadServers()
    expect(useServersStore.getState().initialized).toBe(true)
    expect(useServersStore.getState().servers).toHaveLength(0)
  })
})

// ── addServer ─────────────────────────────────────────────────────────────────

describe('addServer', () => {
  it('appends the server on success', async () => {
    const server = makeServer('new-id')
    mockIpc.servers.add.mockResolvedValue({ success: true, server })
    const result = await useServersStore.getState().addServer(server)
    expect(result.success).toBe(true)
    expect(useServersStore.getState().servers).toHaveLength(1)
  })

  it('normalizes host+ip on the added server', async () => {
    const server = { ...makeServer('new-id'), host: '10.0.0.5', ip: undefined }
    mockIpc.servers.add.mockResolvedValue({ success: true, server })
    await useServersStore.getState().addServer(server)
    const added = useServersStore.getState().servers[0]
    expect(added.host).toBe('10.0.0.5')
    expect(added.ip).toBe('10.0.0.5')
  })

  it('returns failure result without adding to state', async () => {
    mockIpc.servers.add.mockResolvedValue({ success: false, reason: 'duplicate' })
    const result = await useServersStore.getState().addServer(makeServer('x'))
    expect(result.success).toBe(false)
    expect(useServersStore.getState().servers).toHaveLength(0)
  })

  it('handles IPC rejection gracefully', async () => {
    mockIpc.servers.add.mockRejectedValue(new Error('IPC error'))
    const result = await useServersStore.getState().addServer(makeServer('x'))
    expect(result.success).toBe(false)
    expect(useServersStore.getState().servers).toHaveLength(0)
  })
})

// ── removeServer ──────────────────────────────────────────────────────────────

describe('removeServer', () => {
  it('removes server from the list', async () => {
    useServersStore.setState({ servers: [makeServer('srv1')], initialized: true })
    mockIpc.servers.remove.mockResolvedValue(undefined)
    await useServersStore.getState().removeServer('srv1')
    expect(useServersStore.getState().servers).toHaveLength(0)
  })

  it('clears metrics and alerts for the removed server', async () => {
    const srv = makeServer('srv1', '10.0.0.1', 1433)
    useServersStore.setState({ servers: [srv], initialized: true })
    useMetricsStore.setState({
      metricsMap: { '10.0.0.1:1433': {} as never },
      summaries: { '10.0.0.1:1433': {} as never },
      historyMap: {},
      serverHealth: {},
      activeServerId: null,
      lastUpdate: null
    })
    mockIpc.servers.remove.mockResolvedValue(undefined)
    await useServersStore.getState().removeServer('srv1')
    expect(useMetricsStore.getState().metricsMap['10.0.0.1:1433']).toBeUndefined()
  })

  it('is resilient to IPC errors', async () => {
    useServersStore.setState({ servers: [makeServer('srv1')], initialized: true })
    mockIpc.servers.remove.mockRejectedValue(new Error('net error'))
    await expect(useServersStore.getState().removeServer('srv1')).resolves.not.toThrow()
  })
})

// ── updateServer ──────────────────────────────────────────────────────────────

describe('updateServer', () => {
  it('merges the patch into the matching server', async () => {
    useServersStore.setState({ servers: [makeServer('srv1')], initialized: true })
    mockIpc.servers.update.mockResolvedValue(undefined)
    await useServersStore.getState().updateServer('srv1', { notes: 'updated note' })
    const srv = useServersStore.getState().servers.find((s) => s.id === 'srv1')
    expect(srv?.notes).toBe('updated note')
  })

  it('does not modify other servers', async () => {
    useServersStore.setState({
      servers: [makeServer('srv1', '10.0.0.1'), makeServer('srv2', '10.0.0.2')],
      initialized: true
    })
    mockIpc.servers.update.mockResolvedValue(undefined)
    await useServersStore.getState().updateServer('srv1', { notes: 'note' })
    const srv2 = useServersStore.getState().servers.find((s) => s.id === 'srv2')
    expect(srv2?.notes).toBeUndefined()
  })
})
