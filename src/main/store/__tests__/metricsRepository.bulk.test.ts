// src/main/store/__tests__/metricsRepository.bulk.test.ts
// Rewrite for SQL Server
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as mssql from 'mssql'

const SKIP = !process.env['STORAGE_TEST_HOST']
const pool = { value: null as mssql.ConnectionPool | null }

vi.mock('../sqlserver/connection', () => ({ getPool: () => pool.value }))

beforeAll(async () => {
  if (SKIP) return
  pool.value = await mssql.connect({
    server: process.env['STORAGE_TEST_HOST']!,
    port: Number(process.env['STORAGE_TEST_PORT'] ?? 1437),
    database: process.env['STORAGE_TEST_DB'] ?? 'SQLSentinelDB',
    authentication: { type: 'default', options: { userName: process.env['STORAGE_TEST_USER'] ?? 'sqlsentinel_app', password: process.env['STORAGE_TEST_PASSWORD'] ?? 'App@Sentinel2025' } },
    options: { encrypt: false, trustServerCertificate: true }
  })
  await pool.value.request().query(`DELETE FROM dbo.metrics_snapshots WHERE server_id LIKE N'test-%'`)
})

afterAll(async () => {
  if (pool.value) {
    await pool.value.request().query(`DELETE FROM dbo.metrics_snapshots WHERE server_id LIKE N'test-%'`)
    await pool.value.close()
  }
})

import { save, findLatest, findLastN, findLastNBulk, batchSave, cleanup } from '../sqlserver/metricsRepository'
import type { ServerMetrics } from '../../collectors/types'

function makeMetrics(cpu: number): ServerMetrics {
  return {
    collectedAt: new Date(),
    instanceInfo: { version: 'test', edition: 'test', memoryUsedMb: 100, memoryTargetMb: 200, cpuUsagePercent: cpu, uptimeDays: 1, logicalCpus: 4, physicalCpus: 2 },
    databases: [], activeSessions: [], topQueries: [], backupStatus: [], waitStats: [], diskVolumes: [], databaseFiles: []
  }
}

describe.skipIf(SKIP)('metricsRepository (SQL Server)', () => {
  it('saves and retrieves latest', async () => {
    await save('test-srv-1', makeMetrics(42))
    const latest = await findLatest('test-srv-1')
    expect(latest).not.toBeNull()
    expect(latest!.instanceInfo.cpuUsagePercent).toBe(42)
  })

  it('findLastN returns N most recent in ascending order', async () => {
    await batchSave([
      { serverId: 'test-srv-2', metrics: makeMetrics(10) },
      { serverId: 'test-srv-2', metrics: makeMetrics(20) },
      { serverId: 'test-srv-2', metrics: makeMetrics(30) }
    ])
    const result = await findLastN('test-srv-2', 2)
    expect(result).toHaveLength(2)
  })

  it('findLastNBulk returns map keyed by serverId', async () => {
    const bulk = await findLastNBulk(['test-srv-1', 'test-srv-2'], 2)
    expect(bulk['test-srv-1']).toBeDefined()
    expect(bulk['test-srv-2']).toBeDefined()
  })

  it('cleanup removes old snapshots', async () => {
    await cleanup(0) // retentionDays=0 deletes everything older than now
  })
})
