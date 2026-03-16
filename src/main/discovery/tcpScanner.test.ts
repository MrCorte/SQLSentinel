import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as net from 'net'
import { scanHost } from './tcpScanner'

vi.mock('net')

// Minimal shape of net.Socket used by scanHost
interface MockSocket {
  setTimeout: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

describe('scanHost', () => {
  let mockSocket: MockSocket
  let handlers: Record<string, () => void>

  beforeEach(() => {
    vi.clearAllMocks()

    handlers = {}
    mockSocket = {
      setTimeout: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler
      }),
      connect: vi.fn(),
      destroy: vi.fn()
    }

    vi.mocked(net.Socket).mockImplementation(function () {
      return mockSocket as unknown as net.Socket
    })
  })

  it('returns reachable=true when the socket connects successfully', async () => {
    mockSocket.connect.mockImplementation(() => {
      handlers['connect']?.()
    })

    const result = await scanHost('192.168.1.10', 1433, 500)

    expect(result.reachable).toBe(true)
    expect(result.ip).toBe('192.168.1.10')
    expect(result.port).toBe(1433)
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0)
    expect(result.discoveredAt).toBeInstanceOf(Date)
    expect(mockSocket.destroy).toHaveBeenCalledOnce()
  })

  it('returns reachable=false when the socket emits an error (e.g. ECONNREFUSED)', async () => {
    mockSocket.connect.mockImplementation(() => {
      handlers['error']?.()
    })

    const result = await scanHost('192.168.1.10', 1433, 500)

    expect(result.reachable).toBe(false)
    expect(result.ip).toBe('192.168.1.10')
    expect(result.port).toBe(1433)
    expect(mockSocket.destroy).toHaveBeenCalledOnce()
  })

  it('returns reachable=false when the socket times out', async () => {
    mockSocket.connect.mockImplementation(() => {
      handlers['timeout']?.()
    })

    const result = await scanHost('10.0.0.1', 1433, 500)

    expect(result.reachable).toBe(false)
    expect(result.ip).toBe('10.0.0.1')
    expect(result.port).toBe(1433)
    expect(mockSocket.destroy).toHaveBeenCalledOnce()
  })

  it('does not call cleanup twice if both error and timeout fire', async () => {
    mockSocket.connect.mockImplementation(() => {
      handlers['error']?.()
      // Simulate a spurious timeout after error
      handlers['timeout']?.()
    })

    const result = await scanHost('192.168.1.10', 1433, 500)

    expect(result.reachable).toBe(false)
    // destroy must be called exactly once despite two events
    expect(mockSocket.destroy).toHaveBeenCalledOnce()
  })

  it('sets the socket timeout to the provided timeoutMs', async () => {
    mockSocket.connect.mockImplementation(() => {
      handlers['connect']?.()
    })

    await scanHost('192.168.1.10', 1433, 750)

    expect(mockSocket.setTimeout).toHaveBeenCalledWith(750)
  })
})
