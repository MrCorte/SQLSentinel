import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'node:http'
import type { WsClientMessage } from '../shared/serviceProtocol'
import { createLogger } from '../main/utils/logger'

const log = createLogger('ws-server')

export interface WsServerHandle {
  broadcast(type: string, data?: unknown): void
  connectedClients(): number
}

export function createWsServer(
  httpServer: Server,
  secret: string,
  onClientMessage: (msg: WsClientMessage) => void
): WsServerHandle {
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://localhost`)
    if (url.searchParams.get('secret') !== secret) {
      ws.close(4401, 'Unauthorized')
      return
    }

    ws.send(JSON.stringify({ type: 'service:ready' }))

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsClientMessage
        onClientMessage(msg)
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('error', (err) => log.warn('[WS] client error:', err.message))
  })

  return {
    broadcast(type: string, data?: unknown): void {
      const payload = JSON.stringify({ type, data })
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload)
        }
      })
    },
    connectedClients(): number {
      return [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN).length
    }
  }
}
