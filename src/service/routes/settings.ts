import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { getSettings, saveSettings } from '../../main/store/sqlserver/settingsRepository'

const SettingsPatchSchema = z.object({
  retentionMinutes: z.number().int().min(60).max(525600).optional(),
  backgroundEnabled: z.boolean().optional(),
  backgroundMode: z.enum(['light', 'full']).optional(),
  backgroundIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  backgroundNotifications: z.boolean().optional(),
  themeMode: z.enum(['light', 'dark', 'system']).optional()
})

export function createSettingsRouter(): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    res.json({ ok: true, data: await getSettings() })
  })

  router.put('/', async (req: Request, res: Response) => {
    const parsed = SettingsPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' })
      return
    }
    try {
      await saveSettings(parsed.data)
      res.json({ ok: true, data: await getSettings() })
    } catch {
      res.status(500).json({ ok: false, error: 'Internal error' })
    }
  })

  return router
}
