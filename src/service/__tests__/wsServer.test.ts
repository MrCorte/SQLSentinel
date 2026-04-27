// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import WebSocket from 'ws'
import { createWsServer } from '../wsServer'

let httpServer: ReturnType<typeof createServer>
let wss: ReturnType<typeof createWsServer>
const TEST_SECRET = 'test-secret-1234'
const TEST_PORT = 57499

beforeAll(async () => {
  httpServer = createServer()
  wss = createWsServer(httpServer, TEST_SECRET, () => {})
  await new Promise<void>((r) => httpServer.listen(TEST_PORT, '127.0.0.1', r))
})

afterAll(async () => {
  await new Promise<void>((r) => httpServer.close(() => r()))
})

describe('createWsServer', () => {
  it('rejects connection without correct secret', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?secret=wrong`)
    await new Promise<void>((resolve) => {
      ws.on('close', (code) => {
        expect(code).toBe(4401)
        resolve()
      })
    })
  })

  it('accepts connection with correct secret and receives service:ready', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?secret=${TEST_SECRET}`)
    const msg = await new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()))
    })
    const parsed = JSON.parse(msg)
    expect(parsed.type).toBe('service:ready')
    ws.close()
  })

  it('broadcast sends message to all connected clients', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?secret=${TEST_SECRET}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?secret=${TEST_SECRET}`)

    // Wait for both to be ready (skip the service:ready message)
    await Promise.all([
      new Promise<void>((r) => ws1.on('open', () => r())),
      new Promise<void>((r) => ws2.on('open', () => r()))
    ])
    // Flush service:ready messages
    await new Promise((r) => setTimeout(r, 50))

    const received: string[] = []
    ws1.on('message', (d) => received.push(d.toString()))
    ws2.on('message', (d) => received.push(d.toString()))

    wss.broadcast('test:event', { hello: 'world' })

    await new Promise((r) => setTimeout(r, 50))
    expect(received).toHaveLength(2)
    expect(JSON.parse(received[0])).toEqual({ type: 'test:event', data: { hello: 'world' } })

    ws1.close()
    ws2.close()
  })
})
