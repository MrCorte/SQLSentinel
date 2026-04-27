import { join } from 'node:path'
import { loadOrCreateConfig } from './serviceConfig'
import { createWsServer } from './wsServer'
import { createHttpServer } from './httpServer'
import { initDb } from '../main/store/database'
import * as serverStore from '../main/store/serverStore'
import { startWorker, setPushHandler } from '../main/metricsWorker'
import { getSettings } from '../main/store/settings'
import { createLogger } from '../main/utils/logger'
import type { WsClientMessage } from '../shared/serviceProtocol'
import { setActiveServer } from '../main/metricsWorker'

const log = createLogger('service')

async function main(): Promise<void> {
  // 1. Load config (creates %ProgramData%\sqlsentinel\service.json if missing)
  const config = loadOrCreateConfig()
  log.info(`[service] Starting on port ${config.port}`)

  // 2. Init SQLite
  const dbPath = join(
    process.env['APPDATA'] ?? process.env['HOME'] ?? '.',
    'sqlsentinel',
    'data.db'
  )
  initDb(dbPath)
  log.info(`[service] Database: ${dbPath}`)

  // 3. Run startup migrations
  serverStore.migrateHostField()
  serverStore.migrateEncryptCredentials()

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
  const settings = getSettings()
  void settings // suppress unused warning — used in future to pass retentionDays
  const servers = serverStore.getAll()
  if (servers.length > 0) {
    startWorker({
      servers: servers.map((s) => ({
        ip: s.host,
        port: s.port,
        instanceName: s.instanceName,
        useWindowsAuth: s.useWindowsAuth,
        username: s.username,
        password: s.password
      })),
      intervalSeconds: 60
    })
    log.info(`[service] Worker started — monitoring ${servers.length} server(s)`)
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
