import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../database'
import { upsert } from '../serverRepository'
import { findLastN, findLastNBulk, batchSave } from '../metricsRepository'
import type { ServerMetrics } from '../../collectors/types'

function makeMetrics(version: string, collectedAt?: Date): ServerMetrics {
  return {
    collectedAt: collectedAt ?? new Date(),
    instanceInfo: {
      version,
      edition: 'Enterprise',
      memoryUsedMb: 1024,
      memoryTargetMb: 4096,
      cpuUsagePercent: 10,
      uptimeDays: 1,
      logicalCpus: 4,
      physicalCpus: 2,
    },
    databases: [],
    activeSessions: [],
    topQueries: [],
    backupStatus: [],
    waitStats: [],
    diskVolumes: [],
    databaseFiles: [],
  }
}

const SERVER_A = { ip: '10.0.0.1', port: 1433, useWindowsAuth: false, lastSeenAt: null, lastMetricsAt: null }
const SERVER_B = { ip: '10.0.0.2', port: 1433, useWindowsAuth: false, lastSeenAt: null, lastMetricsAt: null }

describe('findLastNBulk', () => {
  let idA: string
  let idB: string

  beforeEach(() => {
    initDb(':memory:')
    idA = upsert(SERVER_A).id
    idB = upsert(SERVER_B).id
    batchSave([
      { serverId: idA, metrics: makeMetrics('SQL 2019 v1', new Date('2026-01-01T10:00:00Z')) },
      { serverId: idA, metrics: makeMetrics('SQL 2019 v2', new Date('2026-01-02T10:00:00Z')) },
      { serverId: idA, metrics: makeMetrics('SQL 2019 v3', new Date('2026-01-03T10:00:00Z')) },
      { serverId: idB, metrics: makeMetrics('SQL 2022 v1', new Date('2026-01-01T10:00:00Z')) },
      { serverId: idB, metrics: makeMetrics('SQL 2022 v2', new Date('2026-01-02T10:00:00Z')) },
    ])
  })

  afterEach(() => {
    closeDb()
  })

  it('restituisce gli stessi dati di N chiamate findLastN separate', () => {
    const bulk = findLastNBulk([idA, idB], 10)
    const singleA = findLastN(idA, 10)
    const singleB = findLastN(idB, 10)

    expect(bulk[idA]).toHaveLength(singleA.length)
    expect(bulk[idB]).toHaveLength(singleB.length)

    // Ordine: dal più vecchio al più recente (stesso di findLastN)
    expect(bulk[idA]?.[0].instanceInfo.version).toBe('SQL 2019 v1')
    expect(bulk[idA]?.[2].instanceInfo.version).toBe('SQL 2019 v3')
    expect(bulk[idB]?.[1].instanceInfo.version).toBe('SQL 2022 v2')
  })

  it('rispetta il limite N', () => {
    const bulk = findLastNBulk([idA], 2)
    // Con N=2 restituisce solo i 2 più recenti
    expect(bulk[idA]).toHaveLength(2)
    expect(bulk[idA]?.[0].instanceInfo.version).toBe('SQL 2019 v2')
    expect(bulk[idA]?.[1].instanceInfo.version).toBe('SQL 2019 v3')
  })

  it('restituisce oggetto vuoto per lista serverIds vuota', () => {
    expect(findLastNBulk([], 10)).toEqual({})
  })

  it('ignora server_id non presenti nel DB', () => {
    const bulk = findLastNBulk([idA, 'srv-INESISTENTE'], 10)
    expect(bulk[idA]).toHaveLength(3)
    expect(bulk['srv-INESISTENTE']).toBeUndefined()
  })
})
