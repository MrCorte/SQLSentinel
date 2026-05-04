import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'node:http'
import type { WsClientMessage } from '../shared/serviceProtocol'
import { createLogger } from '../main/utils/logger'

const log = createLogger('ws-server')

export interface WsServerHandle {
  broadcast(type: string, data?: unknown): void
  connectedClients(): number
}

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false
  return (
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.startsWith('127.') ||
    addr.startsWith('::ffff:127.')
  )
}

export function createWsServer(
  httpServer: Server,
  secret: string,
  onClientMessage: (msg: WsClientMessage) => void
): WsServerHandle {
  // verifyClient runs at the HTTP upgrade handshake, before the WebSocket is
  // accepted. We enforce: loopback origin, no browser Origin header (prevents
  // any local browser tab from opening a WS), and bearer in Authorization or
  // Sec-WebSocket-Protocol — never in the URL (which leaks into logs).
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, done) => {
      const remoteAddr = info.req.socket.remoteAddress
      if (!isLoopback(remoteAddr)) {
        log.warn('[WS] Rejected non-loopback connection from', remoteAddr)
        done(false, 403, 'Forbidden')
        return
      }
      // A WebSocket connection from a browser context will always carry an
      // Origin header; the Electron main process (Node ws client) does not.
      // Reject any connection that presents an Origin to block accidental
      // exposure to local browser tabs even if the secret leaks.
      if (info.req.headers['origin']) {
        log.warn('[WS] Rejected connection with Origin header:', info.req.headers['origin'])
        done(false, 403, 'Forbidden')
        return
      }
      // Auth: prefer Authorization header (Bearer <secret>); fall back to
      // Sec-WebSocket-Protocol subprotocol (some clients can't set arbitrary
      // headers). The legacy ?secret= query param is no longer accepted.
      const auth = info.req.headers['authorization']
      const subproto = info.req.headers['sec-websocket-protocol']
      const headerSecret = typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice('Bearer '.length).trim()
        : null
      const subprotoSecret = typeof subproto === 'string' ? subproto.trim() : null
      if (headerSecret !== secret && subprotoSecret !== secret) {
        done(false, 401, 'Unauthorized')
        return
      }
      done(true)
    }
  })

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
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
