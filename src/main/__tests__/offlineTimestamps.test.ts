/**
 * AREA — dbOfflineTimestamps enrichment
 * Verifies that offlineSince is set on the first detection of stateDesc != 'ONLINE',
 * does not advance on subsequent polls, and is removed when the DB comes back ONLINE.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({
  collectMetrics: vi.fn(),
  collectMetricsCritical: vi.fn()
}))
vi.mock('../store/sqlserver/dbCustomFieldsRepository', () => ({
  getAllCustomFields: vi.fn(async () => ({}))
}))
vi.mock('../store/sqlserver/metricsRepository', () => ({
  cleanup: vi.fn(async () => {}),
  findLastNBulk: vi.fn(async () => ({})),
  batchSave: vi.fn(async () => {})
}))
vi.mock('../store/sqlserver/settingsRepository', () => ({
  getSettings: vi.fn(async () => ({ retentionMinutes: 60 }))
}))
vi.mock('../store/sqlserver/serverDatabasesRepository', () => ({
  upsertDatabases: vi.fn(async () => {}),
  syncFullSnapshot: vi.fn(async () => {}),
  deleteByNames: vi.fn(async () => {}),
  getAllGroupedByServer: vi.fn(async () => ({}))
}))
vi.mock('../store/sqlserver/serverRepository')
vi.mock('../collectors/agCollector', () => ({
  detectAndSyncReplicaRoles: vi.fn(() => Promise.resolve([]))
}))

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
      version: '2019',
      edition: 'Dev',
      memoryUsedMb: 100,
      memoryTargetMb: 200,
      cpuUsagePercent: 10,
      uptimeDays: 1,
      logicalCpus: 8,
      physicalCpus: 4
    },
    databases: [],
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: [],
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

    vi.mocked(collectMetrics).mockResolvedValue(
      makeMetrics({
        collectedAt: t0,
        databases: [
          {
            name: 'TestDB',
            stateDesc: 'OFFLINE',
            recoveryModel: 'FULL',
            sizeMb: 100,
            logSizeMb: 10
          }
        ]
      })
    )

    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await drainJobCycle()

    const offlineMap = __getDbOfflineTimestampsForTest(SID)
    expect(offlineMap?.get('TestDB')).toBe(t0.toISOString())
  })

  it('does not update offlineSince on the second poll of the same offline DB', async () => {
    captureRendererMessages()
    const t0 = new Date('2025-01-01T10:00:00.000Z')
    const t1 = new Date('2025-01-01T10:01:00.000Z')
    vi.setSystemTime(t0)

    vi.mocked(collectMetrics)
      .mockResolvedValueOnce(
        makeMetrics({
          collectedAt: t0,
          databases: [
            {
              name: 'TestDB',
              stateDesc: 'OFFLINE',
              recoveryModel: 'FULL',
              sizeMb: 100,
              logSizeMb: 10
            }
          ]
        })
      )
      .mockResolvedValue(
        makeMetrics({
          collectedAt: t1,
          databases: [
            {
              name: 'TestDB',
              stateDesc: 'OFFLINE',
              recoveryModel: 'FULL',
              sizeMb: 100,
              logSizeMb: 10
            }
          ]
        })
      )

    // activeServerId → priority 0 → interval 60s (not 300s)
    startWorker({ intervalSeconds: 60, servers: [makeServer()], activeServerId: SID })
    await drainJobCycle()

    // Second poll
    vi.setSystemTime(t1)
    await vi.advanceTimersByTimeAsync(60_000)

    const offlineMap = __getDbOfflineTimestampsForTest(SID)
    // Must have remained t0, not t1
    expect(offlineMap?.get('TestDB')).toBe(t0.toISOString())
  })

  it('removes offlineSince when the DB comes back ONLINE', async () => {
    captureRendererMessages()
    const t0 = new Date('2025-01-01T10:00:00.000Z')
    const t1 = new Date('2025-01-01T10:01:00.000Z')
    vi.setSystemTime(t0)

    vi.mocked(collectMetrics)
      .mockResolvedValueOnce(
        makeMetrics({
          collectedAt: t0,
          databases: [
            {
              name: 'TestDB',
              stateDesc: 'OFFLINE',
              recoveryModel: 'FULL',
              sizeMb: 100,
              logSizeMb: 10
            }
          ]
        })
      )
      .mockResolvedValue(
        makeMetrics({
          collectedAt: t1,
          databases: [
            {
              name: 'TestDB',
              stateDesc: 'ONLINE',
              recoveryModel: 'FULL',
              sizeMb: 100,
              logSizeMb: 10
            }
          ]
        })
      )

    // activeServerId → priority 0 → interval 60s (not 300s)
    startWorker({ intervalSeconds: 60, servers: [makeServer()], activeServerId: SID })
    await drainJobCycle()

    // Verify that it was offline after the first poll
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

    vi.mocked(collectMetrics).mockResolvedValue(
      makeMetrics({
        collectedAt: t0,
        databases: [
          {
            name: 'TestDB',
            stateDesc: 'OFFLINE',
            recoveryModel: 'FULL',
            sizeMb: 100,
            logSizeMb: 10
          }
        ]
      })
    )

    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await drainJobCycle()

    expect(__getDbOfflineTimestampsForTest(SID)?.has('TestDB')).toBe(true)

    __resetForTests()

    expect(__getDbOfflineTimestampsForTest(SID)).toBeUndefined()
  })

  it('syncServers removes dbOfflineTimestamps of the deleted server', async () => {
    captureRendererMessages()
    const t0 = new Date('2025-01-01T10:00:00.000Z')
    vi.setSystemTime(t0)

    vi.mocked(collectMetrics).mockResolvedValue(
      makeMetrics({
        collectedAt: t0,
        databases: [
          {
            name: 'TestDB',
            stateDesc: 'OFFLINE',
            recoveryModel: 'FULL',
            sizeMb: 100,
            logSizeMb: 10
          }
        ]
      })
    )

    startWorker({ intervalSeconds: 60, servers: [makeServer()] })
    await drainJobCycle()

    expect(__getDbOfflineTimestampsForTest(SID)?.has('TestDB')).toBe(true)

    // Remove the server from the list
    syncServers([])

    expect(__getDbOfflineTimestampsForTest(SID)).toBeUndefined()
  })
})
