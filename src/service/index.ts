import { loadOrCreateConfig } from './serviceConfig'
import { createWsServer } from './wsServer'
import { createHttpServer } from './httpServer'
import * as serverStore from '../main/store/sqlserver/serverRepository'
import { startWorker, setPushHandler } from '../main/metricsWorker'
import { getSettings } from '../main/store/sqlserver/settingsRepository'
import { initStoragePool } from '../main/store/sqlserver/connection'
import { getStorageConfig } from '../main/store/storageConfig'
import { createLogger } from '../main/utils/logger'
import type { WsClientMessage } from '../shared/serviceProtocol'
import { setActiveServer } from '../main/metricsWorker'

const log = createLogger('service')

async function main(): Promise<void> {
  // 1. Load config (creates %ProgramData%\sqlsentinel\service.json if missing)
  const config = loadOrCreateConfig()
  log.info(`[service] Starting on port ${config.port}`)

  // 2. Init SQL Server storage pool — service shares the same storage config as
  //    the Electron main process (read from %APPDATA%/sql-sentinel-storage-config.json).
  const storageCfg = getStorageConfig()
  if (!storageCfg) {
    throw new Error(
      'Storage not configured. Launch the Electron app once to run the storage wizard.'
    )
  }
  await initStoragePool(storageCfg)
  log.info(`[service] Storage pool connected (${storageCfg.host}:${storageCfg.port})`)

  // 3. Load the server registry cache and run startup migrations
  await serverStore.init()
  serverStore.migrateHostField()
  await serverStore.migrateEncryptCredentials()

  // 4. Create HTTP server (needed by both Express and ws)
  const { httpServer } = createHttpServer(config.secret, {
    broadcast: () => {},
    connectedClients: () => 0
  })

  // 5. Create WebSocket server (attach to same httpServer)
  const wsHandle = createWsServer(
    httpServer,
    config.secret,
    (msg: WsClientMessage) => {
      if (msg.type === 'worker:setActive') {
        setActiveServer(msg.serverId)
      }
    }
  )

  // 6. Wire push handler: worker → WebSocket → all connected Electron apps
  setPushHandler((channel, data) => {
    wsHandle.broadcast(channel, data)
  })

  // 7. Start polling worker
  const settings = await getSettings()
  void settings // suppress unused warning — used in future to pass retentionDays
  const servers = serverStore.getAll()
  if (servers.length > 0) {
    // Never log the full server object — it contains plaintext credentials.
    // Log only host:port for traceability.
    const targets = servers.map((s) => ({
      ip: s.host,
      port: s.port,
      instanceName: s.instanceName,
      useWindowsAuth: s.useWindowsAuth,
      username: s.username,
      password: s.password
    }))
    log.info(
      `[service] Worker starting — monitoring: ${servers.map((s) => `${s.host}:${s.port}`).join(', ')}`
    )
    startWorker({ servers: targets, intervalSeconds: 60 })
  }

  // 8. Start listening
  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, '127.0.0.1', resolve)
  })
  log.info(`[service] Listening on 127.0.0.1:${config.port}`)
}

main().catch((err) => {
  console.error('[service] Fatal error:', err)
  process.exit(1)
})
