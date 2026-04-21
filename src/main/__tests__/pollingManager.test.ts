/**
 * AREA 1 — Correttezza logica PollingManager
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type { ServerHealthPayload } from '../ipc/types'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../collectors/sqlCollector', () => ({ collectMetrics: vi.fn() }))
vi.mock('../store/dbCustomFields', () => ({ getAllCustomFields: vi.fn(() => ({})) }))
// startWorker now calls loadHistoryFromDb → mock to isolate the test from the DB
vi.mock('../store/metricsRepository', () => ({
  cleanup: vi.fn(),
  findLastNBulk: vi.fn(() => ({})),
  batchSave: vi.fn()
}))
vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({ retentionMinutes: 60 }))
}))
vi.mock('../store/serverStore')

import { BrowserWindow } from 'electron'
import { collectMetrics } from '../collectors/sqlCollector'
import {
  startWorker,
  stopWorker,
  setActiveServer,
  syncServers,
  __resetForTests,
  __getJobForTest
} from '../metricsWorker'
import type { CollectMetricsRequest } from '../ipc/types'
import type { ServerMetrics } from '../collectors/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeServer(ip: string, port = 1433): CollectMetricsRequest {
  return { ip, port, useWindowsAuth: true }
}

function makeMetrics(): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: {
      version: '2019', edition: 'Dev', memoryUsedMb: 100,
      memoryTargetMb: 200, cpuUsagePercent: 10, uptimeDays: 1, logicalCpus: 8, physicalCpus: 4
    },
    databases: [], activeSessions: [], topQueries: [],
    backupStatus: [], waitStats: [], diskVolumes: [], databaseFiles: []
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

/**
 * Drains the microtask queue enough for one complete async job cycle.
 * Does NOT advance fake timers, so no new scheduled jobs are triggered.
 */
async function drainJobCycle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

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

describe('AREA 1 — PollingManager', () => {

  describe('BATCH_SIZE', () => {

    it('is never exceeded: 35 servers → collectMetrics called exactly 30 times (BATCH_SIZE=30)', () => {
      vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
      const servers = Array.from({ length: 35 }, (_, i) => makeServer(`10.0.0.${i + 1}`))
      startWorker({ intervalSeconds: 60, servers })
      // scheduleTick executes the first batch synchronously — at most BATCH_SIZE=30 jobs
      expect(vi.mocked(collectMetrics)).toHaveBeenCalledTimes(30)
    })

    it('with 5 servers exactly 5 jobs start (fewer than batch size)', () => {
      vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
      startWorker({ intervalSeconds: 60, servers: Array.from({ length: 5 }, (_, i) => makeServer(`10.0.0.${i + 1}`)) })
      expect(vi.mocked(collectMetrics)).toHaveBeenCalledTimes(5)
    })
  })

  describe('setActiveServer', () => {

    it('bumps the job priority to 0 synchronously', () => {
      vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1'), makeServer('10.0.0.2')] })
      expect(__getJobForTest('10.0.0.2:1433')?.priority).toBe(1)
      setActiveServer('10.0.0.2:1433')
      expect(__getJobForTest('10.0.0.2:1433')?.priority).toBe(0)
    })

    it('lowers to 1 the priority of other jobs that were at 0', () => {
      vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1'), makeServer('10.0.0.2')], activeServerId: '10.0.0.1:1433' })
      expect(__getJobForTest('10.0.0.1:1433')?.priority).toBe(0)
      setActiveServer('10.0.0.2:1433')
      expect(__getJobForTest('10.0.0.1:1433')?.priority).toBe(1)
      expect(__getJobForTest('10.0.0.2:1433')?.priority).toBe(0)
    })

    it('does NOT trigger multiple fetches when called 5 times in 100 ms (debounce 300 ms)', async () => {
      vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1')] })
      vi.mocked(collectMetrics).mockClear()

      // 5 rapid calls in 100 ms
      for (let i = 0; i < 5; i++) {
        setActiveServer('10.0.0.1:1433')
        vi.advanceTimersByTime(20)
      }
      // The debounce (300 ms) has not fired yet
      expect(vi.mocked(collectMetrics)).not.toHaveBeenCalled()

      // Fire the debounce (but NOT the 1000ms scheduler timeout)
      vi.advanceTimersByTime(300)
      await drainJobCycle()

      // At most 1 fetch from the debounce
      expect(vi.mocked(collectMetrics).mock.calls.length).toBeLessThanOrEqual(1)
    })
  })

  describe('syncServers — UPSERT', () => {

    it('adds new servers with nextRun ≤ now (immediate)', () => {
      startWorker({ intervalSeconds: 60, servers: [] })
      const now = Date.now()
      syncServers([makeServer('192.168.1.1')])
      const job = __getJobForTest('192.168.1.1:1433')
      expect(job).toBeDefined()
      expect(job!.nextRun).toBeLessThanOrEqual(now + 1)
    })

    it('removes deleted servers from the jobMap', () => {
      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1'), makeServer('10.0.0.2')] })
      syncServers([makeServer('10.0.0.1')])
      expect(__getJobForTest('10.0.0.1:1433')).toBeDefined()
      expect(__getJobForTest('10.0.0.2:1433')).toBeUndefined()
    })

    it('preserves failCount and lastSuccess for existing servers', async () => {
      const messages = captureRendererMessages()
      const server = makeServer('10.0.0.1')

      // First call fails, all subsequent ones are not triggered
      vi.mocked(collectMetrics).mockRejectedValueOnce(new Error('timeout'))
      vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))  // keep hanging

      startWorker({ intervalSeconds: 60, servers: [server] })
      await drainJobCycle()

      const health = messages.filter((m) => m.channel === 'server:healthUpdate').at(-1)?.data as ServerHealthPayload
      expect(health?.failCount).toBe(1)

      // syncServers with the same server — failCount must be preserved
      syncServers([server])
      expect(__getJobForTest('10.0.0.1:1433')?.failCount).toBe(1)
    })

    it('updates server credentials without touching backoff state', async () => {
      captureRendererMessages()
      vi.mocked(collectMetrics).mockRejectedValueOnce(new Error('auth'))
      vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1')] })
      await drainJobCycle()

      syncServers([{ ...makeServer('10.0.0.1'), username: 'newuser' }])
      const job = __getJobForTest('10.0.0.1:1433')
      expect(job?.server.username).toBe('newuser')
      expect(job?.failCount).toBe(1)
    })
  })

  describe('Circuit breaker — exponential back-off', () => {

    it('failCount=1 → nextRun in 600 s (INTERVAL_OFFLINE_MS)', async () => {
      captureRendererMessages()
      vi.mocked(collectMetrics).mockRejectedValue(new Error('unreachable'))
      const now = Date.now()

      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1')] })
      await drainJobCycle()

      const job = __getJobForTest('10.0.0.1:1433')!
      expect(job.failCount).toBe(1)
      expect(job.nextRun).toBeGreaterThanOrEqual(now + 600_000)
      expect(job.nextRun).toBeLessThan(now + 601_000)
    })

    it('failCount=2 → backoff 1200 s (600 * 2^1)', async () => {
      captureRendererMessages()
      vi.mocked(collectMetrics).mockRejectedValue(new Error('fail'))

      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1')] })

      // First failure
      await drainJobCycle()
      expect(__getJobForTest('10.0.0.1:1433')?.failCount).toBe(1)

      // Advance to the second attempt
      const j1 = __getJobForTest('10.0.0.1:1433')!
      vi.advanceTimersByTime(j1.nextRun - Date.now() + 1)
      await drainJobCycle()

      const j2 = __getJobForTest('10.0.0.1:1433')!
      expect(j2.failCount).toBe(2)
      expect(j2.nextRun).toBeGreaterThanOrEqual(Date.now() + 1_200_000 - 100)
    })

    it('failCount=3 → backoff 2400 s (600 * 2^2)', async () => {
      captureRendererMessages()
      vi.mocked(collectMetrics).mockRejectedValue(new Error('fail'))

      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1')] })
      await drainJobCycle()  // fail 1

      for (let i = 0; i < 2; i++) {
        const j = __getJobForTest('10.0.0.1:1433')!
        vi.advanceTimersByTime(j.nextRun - Date.now() + 1)
        await drainJobCycle()
      }

      const job = __getJobForTest('10.0.0.1:1433')!
      expect(job.failCount).toBe(3)
      expect(job.nextRun).toBeGreaterThanOrEqual(Date.now() + 2_400_000 - 100)
    })

    it('capped at 3,600,000 ms (1 hour) regardless of the number of failures', async () => {
      captureRendererMessages()
      vi.mocked(collectMetrics).mockRejectedValue(new Error('fail'))

      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1')] })

      for (let i = 0; i < 15; i++) {
        await drainJobCycle()
        const j = __getJobForTest('10.0.0.1:1433')
        if (!j) break
        vi.advanceTimersByTime(j.nextRun - Date.now() + 1)
      }

      const job = __getJobForTest('10.0.0.1:1433')!
      // Backoff does not exceed 1 h: nextRun ≤ now + BACKOFF_CAP (3600s)
      expect(job.nextRun).toBeLessThanOrEqual(Date.now() + 3_601_000)
    })

    it('reset: failCount returns to 0 and lastSuccess is set after the first success', async () => {
      captureRendererMessages()
      let callN = 0
      vi.mocked(collectMetrics).mockImplementation(async () => {
        callN++
        if (callN <= 2) throw new Error('fail')
        return makeMetrics()
      })

      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1')] })
      await drainJobCycle()  // fail 1

      const j1 = __getJobForTest('10.0.0.1:1433')!
      vi.advanceTimersByTime(j1.nextRun - Date.now() + 1)
      await drainJobCycle()  // fail 2

      const j2 = __getJobForTest('10.0.0.1:1433')!
      vi.advanceTimersByTime(j2.nextRun - Date.now() + 1)
      await drainJobCycle()  // success

      const job = __getJobForTest('10.0.0.1:1433')!
      expect(job.failCount).toBe(0)
      expect(job.lastFailed).toBe(false)
      expect(job.lastSuccess).not.toBeNull()
    })
  })

  describe('stopWorker', () => {

    it('clears tickHandle and activeDebounce: no job starts after stop', async () => {
      vi.mocked(collectMetrics).mockReturnValue(new Promise(() => {}))
      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1')] })
      setActiveServer('10.0.0.1:1433')  // creates activeDebounce

      const callsBefore = vi.mocked(collectMetrics).mock.calls.length
      stopWorker()

      vi.advanceTimersByTime(300_000)
      await drainJobCycle()

      expect(vi.mocked(collectMetrics).mock.calls.length).toBe(callsBefore)
    })

    it('jobMap is empty after stopWorker', () => {
      startWorker({ intervalSeconds: 60, servers: [makeServer('10.0.0.1'), makeServer('10.0.0.2')] })
      stopWorker()
      expect(__getJobForTest('10.0.0.1:1433')).toBeUndefined()
      expect(__getJobForTest('10.0.0.2:1433')).toBeUndefined()
    })
  })
})
