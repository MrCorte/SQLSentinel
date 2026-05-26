import { Router, type Request, type Response } from 'express'
import { getSettings, saveSettings } from '../../main/store/sqlserver/settingsRepository'
import type { AppSettings } from '../../main/store/sqlserver/settingsRepository'

export function createSettingsRouter(): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    res.json({ ok: true, data: await getSettings() })
  })

  router.put('/', async (req: Request, res: Response) => {
    await saveSettings(req.body as Partial<AppSettings>)
    res.json({ ok: true, data: await getSettings() })
  })

  return router
}
