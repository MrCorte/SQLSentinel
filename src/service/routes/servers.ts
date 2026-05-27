import { Router, type Request, type Response } from 'express'
import * as serverStore from '../../main/store/serverStore'
import { syncServers, stopWorker } from '../../main/metricsWorker'
import type { AddServerBody, UpdateServerBody, MigrateServersBody, ServiceResult } from '../../shared/serviceProtocol'
import type { StoredServer } from '../../main/store/serverStore'

function toCollectRequest(s: StoredServer) {
  return {
    ip: s.host,
    port: s.port,
    instanceName: s.instanceName,
    useWindowsAuth: s.useWindowsAuth,
    username: s.username,
    password: s.password
  }
}

function refreshWorker(): void {
  const servers = serverStore.getAll()
  if (servers.length === 0) {
    stopWorker()
    return
  }
  syncServers(servers.map(toCollectRequest))
}

export function createServersRouter(): Router {
  const router = Router()

  // GET /api/servers
  router.get('/', (_req: Request, res: Response) => {
    const result: ServiceResult<StoredServer[]> = {
      ok: true,
      data: serverStore.getAll().map(serverStore.stripCredentials)
    }
    res.json(result)
  })

  // POST /api/servers
  router.post('/', (req: Request, res: Response) => {
    const body = req.body as AddServerBody
    const result = serverStore.add(body)
    if (result.success && result.server) {
      refreshWorker()
      serverStore.writeAutoBackup()
      res.status(201).json({
        ok: true,
        data: { ...result, server: serverStore.stripCredentials(result.server) }
      })
    } else {
      res.status(409).json({ ok: false, error: result.reason ?? 'add failed' })
    }
  })

  // PUT /api/servers/:id
  router.put('/:id', (req: Request, res: Response) => {
    const patch = req.body as UpdateServerBody
    serverStore.update(req.params['id'] as string, patch)
    refreshWorker()
    serverStore.writeAutoBackup()
    res.json({ ok: true, data: { success: true } })
  })

  // DELETE /api/servers/:id
  router.delete('/:id', (req: Request, res: Response) => {
    serverStore.remove(req.params['id'] as string)
    refreshWorker()
    serverStore.writeAutoBackup()
    res.json({ ok: true, data: { success: true } })
  })

  // POST /api/servers/migrate — bulk import from Electron (one-time migration)
  router.post('/migrate', (req: Request, res: Response) => {
    const { servers } = req.body as MigrateServersBody
    let imported = 0
    for (const s of servers) {
      const existing = serverStore.getByIpPort(s.host, s.port)
      if (!existing) {
        serverStore.add(s)
        imported++
      }
    }
    if (imported > 0) {
      refreshWorker()
      serverStore.writeAutoBackup()
    }
    res.json({ ok: true, data: { imported } })
  })

  return router
}
