import express, { type Request, type Response, type NextFunction } from 'express'
import { createServer } from 'node:http'
import type { WsServerHandle } from './wsServer'
import { createServersRouter } from './routes/servers'
import { createMetricsRouter } from './routes/metrics'
import { createSettingsRouter } from './routes/settings'
import { createAlertsRouter } from './routes/alerts'
import type { ServiceHealth } from '../shared/serviceProtocol'

// Per-IP rate limiter: 200 req / minute. The service binds to loopback only,
// so the only client should be the Electron main process — anything beyond
// this is either a runaway loop or a local-attacker probe.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 200
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    next()
    return
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    res.status(429).json({ ok: false, error: 'Too many requests' })
    return
  }
  next()
}

// Loopback-only enforcement: defence-in-depth on top of the listen() bind.
// Prevents accidental exposure if the bind address is misconfigured.
function requireLoopback(req: Request, res: Response, next: NextFunction): void {
  const addr = req.socket.remoteAddress ?? ''
  // Accept IPv4 loopback (127.0.0.0/8), IPv6 loopback (::1) and the IPv4-mapped variant.
  const ok =
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.startsWith('127.') ||
    addr.startsWith('::ffff:127.')
  if (!ok) {
    res.status(403).json({ ok: false, error: 'Forbidden — loopback only' })
    return
  }
  next()
}

export function createHttpServer(secret: string, wsHandle: WsServerHandle) {
  const app = express()
  app.disable('x-powered-by')
  // 256 KB cap is generous for a metrics-config payload but safely below the
  // default 100MB express.json() ceiling on JSON-bomb inputs.
  app.use(express.json({ limit: '256kb' }))
  app.use(requireLoopback)
  app.use(rateLimit)

  // Auth middleware — all routes except /health require Bearer token
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next()
    const auth = req.headers['authorization'] ?? ''
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ ok: false, error: 'Unauthorized' })
      return
    }
    next()
  })

  // Health (no auth)
  app.get('/health', (_req: Request, res: Response) => {
    const body: ServiceHealth = {
      ok: true,
      version: '1.0.0',
      uptime: process.uptime(),
      serversMonitored: wsHandle.connectedClients()
    }
    res.json(body)
  })

  app.use('/api/servers', createServersRouter())
  app.use('/api/metrics', createMetricsRouter())
  app.use('/api/settings', createSettingsRouter())
  app.use('/api/alerts', createAlertsRouter())

  const httpServer = createServer(app)
  return { app, httpServer }
}
