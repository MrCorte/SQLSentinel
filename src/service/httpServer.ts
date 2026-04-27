import express, { type Request, type Response, type NextFunction } from 'express'
import { createServer } from 'node:http'
import type { WsServerHandle } from './wsServer'
import { createServersRouter } from './routes/servers'
import { createMetricsRouter } from './routes/metrics'
import { createSettingsRouter } from './routes/settings'
import { createAlertsRouter } from './routes/alerts'
import type { ServiceHealth } from '../shared/serviceProtocol'

export function createHttpServer(secret: string, wsHandle: WsServerHandle) {
  const app = express()
  app.use(express.json())

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
