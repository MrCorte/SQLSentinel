import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

const servers = [
  {
    id: 'id-prod',
    host: 'prod01.corp.local',
    port: 1433,
    machineName: 'PROD01',
    useWindowsAuth: true,
    addedAt: ''
  },
  {
    id: 'id-test',
    host: 'test02.corp.local',
    port: 1433,
    machineName: 'TEST02',
    useWindowsAuth: true,
    addedAt: ''
  }
]
vi.mock('../../../store/sqlserver/serverRepository', () => ({ getAllStripped: () => servers }))

const listDigestsInWindow = vi.fn()
const listAnomalousWithEmbedding = vi.fn()
const loadBaselineHistory = vi.fn()
vi.mock('../../../store/sqlserver/telemetryDigestRepository', () => ({
  listDigestsInWindow: (...a: unknown[]) => listDigestsInWindow(...a),
  listAnomalousWithEmbedding: (...a: unknown[]) => listAnomalousWithEmbedding(...a),
  loadBaselineHistory: (...a: unknown[]) => loadBaselineHistory(...a)
}))

vi.mock('../../embedder', async () => {
  const real = await vi.importActual<typeof import('../../embedder')>('../../embedder')
  return { ...real, getQueryEmbedding: vi.fn(async () => new Float32Array([1, 0, 0])) }
})

import { retrieveTelemetry, matchServers, resetTelemetryIndex } from '../telemetryRetrieval'
import { packEmbedding } from '../../embedder'

const NOW = new Date(2026, 10, 12, 10, 30)

function digest(serverId: string, h: number, day: number, score: number, text: string) {
  return {
    id: `${serverId}-${day}-${h}`,
    serverId,
    bucketStart: new Date(2026, 10, day, h),
    bucketEnd: new Date(2026, 10, day, h + 1),
    cpuAvg: 50,
    cpuMax: 90,
    blockingMax: score > 0 ? 6 : 0,
    anomalyScore: score,
    anomalyFlags: score > 0 ? ['blocking'] : [],
    text
  }
}

beforeEach(() => {
  resetTelemetryIndex()
  listDigestsInWindow.mockReset().mockResolvedValue([])
  listAnomalousWithEmbedding.mockReset().mockResolvedValue([])
  loadBaselineHistory.mockReset().mockResolvedValue([])
})

describe('matchServers', () => {
  it('matches host short name and machine name, case-insensitively', () => {
    expect(matchServers('perché PROD01 era lento?', servers as never).map((s) => s.id)).toEqual([
      'id-prod'
    ])
    expect(matchServers('check prod01.corp.local', servers as never).map((s) => s.id)).toEqual([
      'id-prod'
    ])
    expect(matchServers('nothing here', servers as never)).toEqual([])
  })
})

describe('retrieveTelemetry', () => {
  it('scopes to the mentioned server and the parsed window', async () => {
    listDigestsInWindow.mockResolvedValue([
      digest(
        'id-prod',
        23,
        11,
        5,
        '[2026-11-11 23:00–00:00] prod01 — blocking up to 6 sessions ⚠ ANOMALIES: blocking'
      ),
      digest('id-prod', 1, 12, 0, '[2026-11-12 01:00–02:00] prod01 — CPU avg 10%')
    ])
    const r = await retrieveTelemetry('perché PROD01 era lento stanotte?', null, NOW)

    expect(listDigestsInWindow).toHaveBeenCalledTimes(1)
    const [sid, from, to] = listDigestsInWindow.mock.calls[0]
    expect(sid).toBe('id-prod')
    expect((from as Date).getTime()).toBe(new Date(2026, 10, 11, 22).getTime())
    expect((to as Date).getTime()).toBe(new Date(2026, 10, 12, 7).getTime())
    expect(r.temporal).toBe(true)
    expect(r.anomalous).toBe(1)
    expect(r.block).toContain('Window: last night')
    // ordine cronologico nel blocco
    expect(r.block.indexOf('2026-11-11 23:00')).toBeLessThan(r.block.indexOf('2026-11-12 01:00'))
  })

  it('is silent about quiet windows when the question is not temporal', async () => {
    listDigestsInWindow.mockResolvedValue([digest('id-prod', 9, 12, 0, 'quiet')])
    const r = await retrieveTelemetry('show blocking sessions', null, NOW)
    expect(r.temporal).toBe(false)
    expect(r.block).toMatch(/no anomalies detected/)
    expect(r.block).not.toContain('quiet')
  })

  it('adds the server baseline when enough history exists', async () => {
    listDigestsInWindow.mockResolvedValue([digest('id-prod', 9, 12, 3, 'hot hour')])
    loadBaselineHistory.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        bucketStart: new Date(2026, 10, 5 + i, 4),
        cpuAvg: 12,
        blockingMax: 0,
        topWaits: [{ waitType: 'CXPACKET', pct: 50, waitMs: 1 }]
      }))
    )
    const r = await retrieveTelemetry('è normale la CPU di PROD01?', null, NOW)
    expect(r.block).toContain('Usual behaviour of prod01.corp.local:1433')
    expect(r.block).toContain('CPU avg ~12%')
  })

  it('finds similar past episodes outside the window via embeddings', async () => {
    listDigestsInWindow.mockResolvedValue([
      digest('id-prod', 9, 12, 4, 'blocking now ⚠ ANOMALIES: blocking')
    ])
    listAnomalousWithEmbedding.mockResolvedValue([
      {
        ...digest('id-prod', 14, 3, 5, 'past blocking — root cause: missing index on Orders'),
        embedding: packEmbedding(new Float32Array([0.9, 0.1, 0]))
      },
      {
        ...digest('id-prod', 14, 4, 5, 'unrelated disk issue'),
        embedding: packEmbedding(new Float32Array([0, 1, 0]))
      }
    ])
    const r = await retrieveTelemetry('PROD01 ha blocking, è già successo?', null, NOW)
    expect(r.precedents).toHaveLength(1)
    expect(r.block).toContain('Similar past episodes')
    expect(r.block).toContain('missing index on Orders')
    expect(r.block).not.toContain('unrelated disk issue')
  })

  it('degrades gracefully with no servers', async () => {
    servers.length = 0
    const r = await retrieveTelemetry('ieri', null, NOW)
    expect(r.block).toBe('')
  })
})
