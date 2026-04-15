/**
 * AREA — dbOfflineTimestamps enrichment
 * Verifica che offlineSince venga impostato al primo rilevamento di stateDesc != 'ONLINE',
 * non avanzi ai poll successivi, e venga rimosso quando il DB torna ONLINE.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn(), collectMetricsCritical: vi.fn() }))
vi.mock('../store/dbCustomFields', () => ({ getAllCustomFields: vi.fn(() => ({})) }))
vi.mock('../store/metricsRepository', () => ({
  cleanup: vi.fn(),
  findLastNBulk: vi.fn(() => ({})),
  batchSave: vi.fn()
}))
vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({ retentionMinutes: 60 }))
}))
vi.mock('../store/serverStore')
vi.mock('../collectors/agCollector', () => ({ detectAndSyncReplicaRoles: vi.fn(() => Promise.resolve([])) }))

import { BrowserWindow } from 'electron'
import { collectMetrics } from '../collectors/sqlCollector'
import {
  startWorker,
  syncServers,
  __resetForTests,
  __getDbOfflineTimestampsForTest
} from '../metricsWorker'
import type { CollectMetricsRequest } from '../ipc/types'
import type { ServerMetrics } from '../collectors/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeServer(ip = '10.0.0.1', port = 1433): CollectMetricsRequest {
  return { ip, port, useWindowsAuth: true }
}

function makeMetrics(overrides: Partial<ServerMetrics> = {}): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: '2019', edition: 'Dev', memoryUsedMb: 100,
      memoryTargetMb: 200, cpuUsagePercent: 10, uptimeDays: 1,
      logicalCpus: 8, physicalCpus: 4
    },
    databases: [], activeSessions: [], topQueries: [],
    backupStatus: [], waitStats: [], diskVolumes: [], databaseFiles: [],
    ...overrides
  }
}

function captureRendererMessages(): { channel: string; data: unknown }[] {
  const messages: { channel: string; data: unknown }[] = []
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
    {
      isDestroyed: () => false,
      isVisible: () => true,
      webContents: { send: (ch: string, d: unknown) => messages.push({ channel: ch, data: d }) }
    } as unknown as Electron.BrowserWindow
  ])
  return messages
}

async function drainJobCycle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const SID = '10.0.0.1:1433'

beforeEach(() => {
  vi.useFakeTimers()
  __resetForTests()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  vi.mocked(collectMetrics).mockReset()
})

afterEach(() => {
  __resetForTests()
  vi.useRealTimers()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('dbOfflineTimestamps — enrichment', () => {

  it('imposta offlineSince al primo poll che rileva un DB non-ONLINE', async () => {
    captureRendererMessages()
    const t0 = new Date('2025-01-01T10:00:00.000Z')
    vi.setSystemTime(t0)

    vi.mocked(collectMetrics).mockResolvedValue(makeMetrics({
      collectedAt: t0,
      databases: [{ name: 'TestDB', stateDesc: 'OFFLINE', recoveryModel: 'FULL', sizeMb: 100, logSizeMb: 10 }]
    }))

    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await drainJobCycle()

    const offlineMap = __getDbOfflineTimestampsForTest(SID)
    expect(offlineMap?.get('TestDB')).toBe(t0.toISOString())
  })

  it('non aggiorna offlineSince al secondo poll dello stesso DB offline', async () => {
    captureRendererMessages()
    const t0 = new Date('2025-01-01T10:00:00.000Z')
    const t1 = new Date('2025-01-01T10:01:00.000Z')
    vi.setSystemTime(t0)

    vi.mocked(collectMetrics)
      .mockResolvedValueOnce(makeMetrics({
        collectedAt: t0,
        databases: [{ name: 'TestDB', stateDesc: 'OFFLINE', recoveryModel: 'FULL', sizeMb: 100, logSizeMb: 10 }]
      }))
      .mockResolvedValue(makeMetrics({
        collectedAt: t1,
        databases: [{ name: 'TestDB', stateDesc: 'OFFLINE', recoveryModel: 'FULL', sizeMb: 100, logSizeMb: 10 }]
      }))

    // activeServerId → priority 0 → intervallo 60s (non 300s)
    startWorker({ intervalSeconds: 60, servers: [makeServer()], activeServerId: SID })
    await drainJobCycle()

    // Secondo poll
    vi.setSystemTime(t1)
    await vi.advanceTimersByTimeAsync(60_000)

    const offlineMap = __getDbOfflineTimestampsForTest(SID)
    // Deve essere rimasto t0, non t1
    expect(offlineMap?.get('TestDB')).toBe(t0.toISOString())
  })

  it('rimuove offlineSince quando il DB torna ONLINE', async () => {
    captureRendererMessages()
    const t0 = new Date('2025-01-01T10:00:00.000Z')
    const t1 = new Date('2025-01-01T10:01:00.000Z')
    vi.setSystemTime(t0)

    vi.mocked(collectMetrics)
      .mockResolvedValueOnce(makeMetrics({
        collectedAt: t0,
        databases: [{ name: 'TestDB', stateDesc: 'OFFLINE', recoveryModel: 'FULL', sizeMb: 100, logSizeMb: 10 }]
      }))
      .mockResolvedValue(makeMetrics({
        collectedAt: t1,
        databases: [{ name: 'TestDB', stateDesc: 'ONLINE', recoveryModel: 'FULL', sizeMb: 100, logSizeMb: 10 }]
      }))

    // activeServerId → priority 0 → intervallo 60s (non 300s)
    startWorker({ intervalSeconds: 60, servers: [makeServer()], activeServerId: SID })
    await drainJobCycle()

    // Verifica che fosse offline dopo il primo poll
    expect(__getDbOfflineTimestampsForTest(SID)?.has('TestDB')).toBe(true)

    // Secondo poll: DB torna ONLINE
    vi.setSystemTime(t1)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(__getDbOfflineTimestampsForTest(SID)?.has('TestDB')).toBe(false)
  })

  it('__resetForTests pulisce dbOfflineTimestamps', async () => {
    captureRendererMessages()
    const t0 = new Date('2025-01-01T10:00:00.000Z')
    vi.setSystemTime(t0)

    vi.mocked(collectMetrics).mockResolvedValue(makeMetrics({
      collectedAt: t0,
      databases: [{ name: 'TestDB', stateDesc: 'OFFLINE', recoveryModel: 'FULL', sizeMb: 100, logSizeMb: 10 }]
    }))

    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await drainJobCycle()

    expect(__getDbOfflineTimestampsForTest(SID)?.has('TestDB')).toBe(true)

    __resetForTests()

    expect(__getDbOfflineTimestampsForTest(SID)).toBeUndefined()
  })

  it('syncServers rimuove dbOfflineTimestamps del server eliminato', async () => {
    captureRendererMessages()
    const t0 = new Date('2025-01-01T10:00:00.000Z')
    vi.setSystemTime(t0)

    vi.mocked(collectMetrics).mockResolvedValue(makeMetrics({
      collectedAt: t0,
      databases: [{ name: 'TestDB', stateDesc: 'OFFLINE', recoveryModel: 'FULL', sizeMb: 100, logSizeMb: 10 }]
    }))

    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await drainJobCycle()

    expect(__getDbOfflineTimestampsForTest(SID)?.has('TestDB')).toBe(true)

    // Rimuoviamo il server dalla lista
    syncServers([])

    expect(__getDbOfflineTimestampsForTest(SID)).toBeUndefined()
  })

})
