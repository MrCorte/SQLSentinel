import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { StoredServer } from '../../main/store/serverStore'

vi.mock('../../main/store/serverStore', () => ({
  add: vi.fn(),
  getAll: vi.fn(() => []),
  stripCredentials: vi.fn((server: StoredServer) => {
    const { password: _password, encryptedPassword: _encryptedPassword, ...safe } = server
    return safe
  }),
  writeAutoBackup: vi.fn()
}))

vi.mock('../../main/metricsWorker', () => ({
  syncServers: vi.fn(),
  stopWorker: vi.fn()
}))

import { createHttpServer } from '../httpServer'
import * as serverStore from '../../main/store/serverStore'

const SECRET = 'test-secret'

let httpServer: Server | null = null
let baseUrl = ''

function makeServer(overrides: Partial<StoredServer> = {}): StoredServer {
  return {
    id: 'srv-1',
    host: 'localhost',
    port: 1433,
    useWindowsAuth: false,
    username: `user_${randomUUID().replaceAll('-', '')}`,
    password: randomUUID(),
    encryptedPassword: 'encrypted',
    addedAt: '2026-05-27T00:00:00.000Z',
    ...overrides
  }
}

async function startServer(): Promise<void> {
  const created = createHttpServer(SECRET, { connectedClients: () => 0 })
  httpServer = created.httpServer
  await new Promise<void>((resolve) => {
    httpServer?.listen(0, '127.0.0.1', resolve)
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
  baseUrl = `http://127.0.0.1:${address.port}`
}

async function stopServer(): Promise<void> {
  if (!httpServer) return
  await new Promise<void>((resolve) => httpServer?.close(() => resolve()))
  httpServer = null
  baseUrl = ''
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(serverStore.add).mockReturnValue({ success: true, server: makeServer() })
  await startServer()
})

afterEach(async () => {
  await stopServer()
})

describe('servers service route', () => {
  it('returns ServerAddResult shape from POST /api/servers', async () => {
    const submittedUsername = `user_${randomUUID().replaceAll('-', '')}`
    const submittedPassword = randomUUID()
    vi.mocked(serverStore.add).mockReturnValue({
      success: true,
      server: makeServer({ username: submittedUsername, password: submittedPassword })
    })
    const response = await fetch(`${baseUrl}/api/servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`
      },
      body: JSON.stringify({
        host: 'localhost',
        port: 1433,
        useWindowsAuth: false,
        username: submittedUsername,
        password: submittedPassword
      })
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      data: {
        success: true,
        server: {
          id: 'srv-1',
          host: 'localhost',
          port: 1433,
          username: submittedUsername
        }
      }
    })
    expect(body.data.server.password).toBeUndefined()
    expect(body.data.server.encryptedPassword).toBeUndefined()
  })
})
