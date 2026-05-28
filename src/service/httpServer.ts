import express, { type Request, type Response, type NextFunction, type ErrorRequestHandler } from 'express'
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

// Evict expired buckets every 5 minutes to prevent unbounded Map growth if
// the bind address is ever misconfigured and multiple IPs connect.
setInterval(() => {
  const now = Date.now()
  for (const [ip, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip)
  }
}, 5 * 60_000).unref()

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

// Defence vs deeply nested JSON ({"a":{"a":{"a":...}}}). The size limit alone
// doesn't help — 200 KB of nested braces fits well under 256 KB and forces
// O(depth) recursion in the parser. We post-validate the parsed object's
// depth and reject anything beyond a sane ceiling.
const MAX_JSON_DEPTH = 24

function depthOf(value: unknown, max: number, depth = 0): number {
  if (depth > max) return depth
  if (Array.isArray(value)) {
    let m = depth
    for (const v of value) {
      m = Math.max(m, depthOf(v, max, depth + 1))
      if (m > max) return m
    }
    return m
  }
  if (value && typeof value === 'object') {
    let m = depth
    for (const v of Object.values(value)) {
      m = Math.max(m, depthOf(v, max, depth + 1))
      if (m > max) return m
    }
    return m
  }
  return depth
}

function depthGuard(req: Request, res: Response, next: NextFunction): void {
  const body = req.body
  if (body == null) return next()
  if (depthOf(body, MAX_JSON_DEPTH) > MAX_JSON_DEPTH) {
    res.status(400).json({ ok: false, error: 'Request body is too deeply nested' })
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
  app.use(depthGuard)
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

  // Catch-all error handler: prevents unhandled exceptions from leaking stack
  // traces or crashing the process. Routes that throw will land here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(500).json({ ok: false, error: 'Internal server error' })
  }
  app.use(errorHandler)

  const httpServer = createServer(app)
  return { app, httpServer }
}
