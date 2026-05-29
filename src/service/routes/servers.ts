import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import * as serverStore from '../../main/store/sqlserver/serverRepository'
import { syncServers, stopWorker } from '../../main/metricsWorker'
import type { ServiceResult } from '../../shared/serviceProtocol'
import type { StoredServer } from '../../main/store/sqlserver/serverRepository'

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

// The update schema allows `null` for clearable fields (host can't be cleared),
// but serverStore.update expects Partial<StoredServer> and treats `undefined`
// as "set column to NULL". Map null→undefined to satisfy the type while keeping
// the clear-a-field semantics intact.
function toUpdatePatch(data: Record<string, unknown>): Partial<StoredServer> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) out[k] = v === null ? undefined : v
  return out as Partial<StoredServer>
}

function refreshWorker(): void {
  const servers = serverStore.getAll()
  if (servers.length === 0) {
    stopWorker()
    return
  }
  syncServers(servers.map(toCollectRequest))
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const AddServerSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  instanceName: z.string().max(128).optional(),
  useWindowsAuth: z.boolean(),
  username: z.string().max(128).optional(),
  password: z.string().max(256).optional(),
  hostingType: z.enum(['on-premise', 'cloud']).optional(),
  notes: z.string().max(1000).optional(),
  // Elevated remediation credential (used only to execute approved fixes).
  // Empty string is allowed so the UI can disable/clear it.
  remediationUsername: z.string().max(200).optional(),
  remediationPassword: z.string().max(256).optional(),
  remediationUseWindowsAuth: z.boolean().optional()
})

const UpdateServerSchema = AddServerSchema.partial().extend({
  unreachable: z.boolean().optional(),
  unreachableSince: z.string().datetime({ offset: true }).optional().or(z.null()),
  lastSeen: z.string().datetime({ offset: true }).optional().or(z.null()),
  agGroupId: z.string().max(128).optional().or(z.null()),
  agName: z.string().max(128).optional().or(z.null()),
  agRole: z.enum(['PRIMARY', 'SECONDARY', 'RESOLVING']).optional().or(z.null()),
  logicalCpus: z.number().int().min(1).max(1024).optional().or(z.null()),
  physicalCpus: z.number().int().min(1).max(1024).optional().or(z.null()),
  machineName: z.string().max(255).optional().or(z.null())
})

const MigrateServerSchema = AddServerSchema.extend({
  id: z.string().max(64).optional(),
  addedAt: z.string().max(64).optional()
})

const MigrateServersSchema = z.object({
  servers: z.array(MigrateServerSchema).min(1).max(500)
})

// ── Router ────────────────────────────────────────────────────────────────────

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
  router.post('/', async (req: Request, res: Response) => {
    const parsed = AddServerSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' })
      return
    }
    try {
      const result = await serverStore.add(parsed.data)
      if (result.success && result.server) {
        refreshWorker()
        serverStore.writeAutoBackup()
        res.status(201).json({ ok: true, data: serverStore.stripCredentials(result.server) })
      } else {
        res.status(409).json({ ok: false, error: result.reason ?? 'add failed' })
      }
    } catch {
      res.status(500).json({ ok: false, error: 'Internal error' })
    }
  })

  // PUT /api/servers/:id
  router.put('/:id', async (req: Request, res: Response) => {
    const parsed = UpdateServerSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' })
      return
    }
    try {
      await serverStore.update(req.params['id'] as string, toUpdatePatch(parsed.data))
      refreshWorker()
      serverStore.writeAutoBackup()
      res.json({ ok: true, data: { success: true } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'update failed'
      res.status(msg.includes('not found') ? 404 : 500).json({ ok: false, error: msg })
    }
  })

  // DELETE /api/servers/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await serverStore.remove(req.params['id'] as string)
      refreshWorker()
      serverStore.writeAutoBackup()
      res.json({ ok: true, data: { success: true } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'delete failed'
      res.status(msg.includes('not found') ? 404 : 500).json({ ok: false, error: msg })
    }
  })

  // POST /api/servers/migrate — bulk import from Electron (one-time migration)
  router.post('/migrate', async (req: Request, res: Response) => {
    const parsed = MigrateServersSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' })
      return
    }
    try {
      let imported = 0
      for (const s of parsed.data.servers) {
        const existing = serverStore.getByIpPort(s.host, s.port)
        if (!existing) {
          await serverStore.add(s)
          imported++
        }
      }
      if (imported > 0) {
        refreshWorker()
        serverStore.writeAutoBackup()
      }
      res.json({ ok: true, data: { imported } })
    } catch {
      res.status(500).json({ ok: false, error: 'Internal error' })
    }
  })

  return router
}
