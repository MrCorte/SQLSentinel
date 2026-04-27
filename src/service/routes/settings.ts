import { Router, type Request, type Response } from 'express'
import { getSettings, saveSettings } from '../../main/store/settings'
import type { AppSettings } from '../../main/store/settings'

export function createSettingsRouter(): Router {
  const router = Router()

  router.get('/', (_req: Request, res: Response) => {
    res.json({ ok: true, data: getSettings() })
  })

  router.put('/', (req: Request, res: Response) => {
    saveSettings(req.body as Partial<AppSettings>)
    res.json({ ok: true, data: getSettings() })
  })

  return router
}
