import { Router, type Request, type Response } from 'express'
import * as metricsRepository from '../../main/store/metricsRepository'
import { getHistoryAll } from '../../main/metricsWorker'

export function createMetricsRouter(): Router {
  const router = Router()

  // GET /api/metrics/history/bulk — all servers, last N snapshots
  router.get('/history/bulk', (_req: Request, res: Response) => {
    res.json({ ok: true, data: getHistoryAll() })
  })

  // GET /api/metrics/:serverId/history?days=N
  router.get('/:serverId/history', (req: Request, res: Response) => {
    const days = parseInt((req.query['days'] as string) ?? '1', 10)
    const rows = metricsRepository.findHistory(req.params['serverId'] as string, days)
    res.json({ ok: true, data: rows })
  })

  return router
}
