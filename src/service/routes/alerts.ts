import { Router, type Request, type Response } from 'express'
import { getAlerts, acknowledgeAlert } from '../../main/metricsWorker'

export function createAlertsRouter(): Router {
  const router = Router()

  router.get('/', (_req: Request, res: Response) => {
    res.json({ ok: true, data: getAlerts() })
  })

  router.post('/:id/acknowledge', (req: Request, res: Response) => {
    const ok = acknowledgeAlert(req.params['id'] as string)
    res.json({ ok, data: { success: ok } })
  })

  return router
}
