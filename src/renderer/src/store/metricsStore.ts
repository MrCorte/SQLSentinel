import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ServerMetrics, ServerHealthPayload, DatabaseInfo } from '../../../preload/index'

// Delta type for partial updates from main process
export interface DeltaMetrics extends ServerMetrics {
  isDelta?: boolean
}

// ── Two-tier store types ───────────────────────────────────────────────────

/**
 * Lightweight summary for the server list view (all 200 servers).
 * Avoids storing full ServerMetrics for idle servers.
 */
export interface ServerSummary {
  cpuUsagePercent: number
  memoryUsedMb: number
  memoryTargetMb: number
  uptimeDays: number
  collectedAt: Date
  dbCount: number
  offlineDbCount: number
}

/** Single data point for sparkline charts. */
export interface HistoryPoint {
  ts: number // ms timestamp
  value: number
}

/** Per-server ring buffers. */
export interface ServerHistory {
  cpu: HistoryPoint[]
  memory: HistoryPoint[]
}

// Ring buffer caps
const MAX_HISTORY_ACTIVE = 60
const MAX_HISTORY_IDLE = 10

function pushCapped(buf: HistoryPoint[], point: HistoryPoint, cap: number): HistoryPoint[] {
  // Avoid the [...buf, point] then-slice double allocation when at/over cap.
  if (buf.length < cap) return [...buf, point]
  // At cap: drop oldest in a single allocation
  return [...buf.slice(buf.length - cap + 1), point]
}

function memPercent(info: ServerMetrics['instanceInfo']): number {
  return info.memoryTargetMb > 0 ? Math.round((info.memoryUsedMb / info.memoryTargetMb) * 100) : 0
}

function buildSummary(m: ServerMetrics): ServerSummary {
  return {
    cpuUsagePercent: m.instanceInfo.cpuUsagePercent,
    memoryUsedMb: m.instanceInfo.memoryUsedMb,
    memoryTargetMb: m.instanceInfo.memoryTargetMb,
    uptimeDays: m.instanceInfo.uptimeDays,
    collectedAt: m.collectedAt,
    dbCount: m.databases.length,
    offlineDbCount: m.databases.filter((d) => d.stateDesc !== 'ONLINE').length
  }
}

// ── Store interface ────────────────────────────────────────────────────────

interface MetricsStore {
  /** Full metrics — kept for the active server only (evict others via evictFullMetrics). */
  metricsMap: Record<string, ServerMetrics>
  /** Lightweight summaries for all servers (server list / KPI cards). */
  summaries: Record<string, ServerSummary>
  /** Sparkline ring buffers per server. */
  historyMap: Record<string, ServerHistory>
  /** ID of the server currently being viewed in the detail page. */
  activeServerId: string | null
  /** Timestamp of the last setMetrics / applyDelta call. */
  lastUpdate: Date | null
  /** Circuit-breaker health per server (keyed by "ip:port"). */
  serverHealth: Record<string, ServerHealthPayload>

  setMetrics: (serverId: string, m: ServerMetrics) => void
  applyDelta: (serverId: string, delta: DeltaMetrics) => void
  applyDeltaBatch: (batch: Array<{ serverId: string; metrics: DeltaMetrics }>) => void
  setServerHealth: (health: ServerHealthPayload) => void
  /** Mark which server the user is currently viewing. */
  setActiveServerId: (id: string | null) => void
  /** Remove full metrics for a server to free renderer memory. */
  evictFullMetrics: (serverId: string) => void
  /** Clear ring-buffer history. Pass serverId to reset one server, omit to reset all. */
  resetHistory: (serverId?: string) => void
  /** Remove all stored data for a server (call when server is deleted). */
  deleteServerData: (serverId: string) => void
  /**
   * Pre-populates the store at boot from the SQLite history (called once only).
   * For each server: updates metricsMap/summaries with the most recent snapshot and
   * builds the historyMap ring-buffers from all available snapshots.
   */
  seedFromHistory: (allHistory: Record<string, ServerMetrics[]>) => void
  /**
   * Pre-populates database lists at boot from the server_databases SQLite table.
   * Fills servers that have no entry in metricsMap yet, and repairs entries
   * that only have non-database metrics. Never overwrites a non-empty DB list.
   */
  seedFromDatabases: (databasesByServer: Record<string, DatabaseInfo[]>) => void
}

// ── Store implementation ───────────────────────────────────────────────────

export const useMetricsStore = create<MetricsStore>()(
  subscribeWithSelector(immer((set) => ({
    metricsMap: {},
    summaries: {},
    historyMap: {},
    activeServerId: null,
    lastUpdate: null,
    serverHealth: {},

    setActiveServerId: (id) =>
      set((state) => {
        state.activeServerId = id
      }),

    evictFullMetrics: (serverId) =>
      set((state) => {
        delete state.metricsMap[serverId]
      }),

    resetHistory: (serverId) =>
      set((state) => {
        if (serverId) {
          state.historyMap[serverId] = { cpu: [], memory: [] }
        } else {
          Object.keys(state.historyMap).forEach((id) => {
            state.historyMap[id] = { cpu: [], memory: [] }
          })
        }
      }),

    deleteServerData: (serverId) =>
      set((state) => {
        delete state.metricsMap[serverId]
        delete state.summaries[serverId]
        delete state.historyMap[serverId]
        delete state.serverHealth[serverId]
      }),

    seedFromHistory: (allHistory) =>
      set((state) => {
        for (const [sid, history] of Object.entries(allHistory)) {
          if (history.length === 0) continue
          const latest = history[history.length - 1]
          state.metricsMap[sid] = latest
          state.summaries[sid] = buildSummary(latest)
          const cpu: HistoryPoint[] = []
          const memory: HistoryPoint[] = []
          for (const m of history) {
            const ts = new Date(m.collectedAt).getTime()
            cpu.push({ ts, value: m.instanceInfo.cpuUsagePercent })
            memory.push({ ts, value: memPercent(m.instanceInfo) })
          }
          const cap = state.activeServerId === sid ? MAX_HISTORY_ACTIVE : MAX_HISTORY_IDLE
          state.historyMap[sid] = {
            cpu: cpu.slice(-cap),
            memory: memory.slice(-cap)
          }
        }
        if (Object.keys(allHistory).length > 0) state.lastUpdate = new Date()
      }),

    seedFromDatabases: (databasesByServer) =>
      set((state) => {
        for (const [sid, databases] of Object.entries(databasesByServer)) {
          if (databases.length === 0) continue
          const existing = state.metricsMap[sid]
          if (existing) {
            if (existing.databases.length === 0) {
              existing.databases = databases
              state.summaries[sid] = buildSummary(existing)
            }
            continue
          }
          const stub: ServerMetrics = {
            collectedAt: new Date(0),
            instanceInfo: {
              version: '',
              edition: '',
              memoryUsedMb: 0,
              memoryTargetMb: 0,
              cpuUsagePercent: 0,
              uptimeDays: 0,
              logicalCpus: 0,
              physicalCpus: 0
            },
            databases,
            activeSessions: [],
            topQueries: [],
            backupStatus: [],
            waitStats: [],
            diskVolumes: [],
            databaseFiles: []
          }
          state.metricsMap[sid] = stub
          // Don't set summaries — KPI cards should stay blank until real data arrives
        }
      }),

    setMetrics: (serverId, m) =>
      set((state) => {
        applyFullSnapshot(state, serverId, m)
        state.lastUpdate = new Date()
      }),

    setServerHealth: (health) =>
      set((state) => {
        state.serverHealth[health.serverId] = health
      }),

    applyDelta: (serverId, delta) =>
      set((state) => {
        applyOne(state, serverId, delta)
        state.lastUpdate = new Date()
      }),

    applyDeltaBatch: (batch) =>
      set((state) => {
        for (const { serverId, metrics: delta } of batch) {
          applyOne(state, serverId, delta)
        }
        state.lastUpdate = new Date()
      })
  })))
)

// ── Internal mutators (operate on Immer draft) ─────────────────────────────

type Draft = MetricsStore

function pushHistoryPoint(state: Draft, serverId: string, m: ServerMetrics): void {
  const isActive = state.activeServerId === serverId
  const cap = isActive ? MAX_HISTORY_ACTIVE : MAX_HISTORY_IDLE
  const hist = state.historyMap[serverId] ?? { cpu: [], memory: [] }
  const ts = m.collectedAt.getTime()
  state.historyMap[serverId] = {
    cpu: pushCapped(hist.cpu, { ts, value: m.instanceInfo.cpuUsagePercent }, cap),
    memory: pushCapped(hist.memory, { ts, value: memPercent(m.instanceInfo) }, cap)
  }
}

function applyFullSnapshot(state: Draft, serverId: string, m: ServerMetrics): void {
  // If the new snapshot has no databases but the existing entry does, the
  // queryDatabases query likely failed silently and returned []. Preserve the
  // known database list so the UI doesn't flash to 0 on a transient failure.
  const existing = state.metricsMap[serverId]
  if (m.databases.length === 0 && existing && existing.databases.length > 0) {
    m = { ...m, databases: existing.databases }
  }
  state.metricsMap[serverId] = m
  state.summaries[serverId] = buildSummary(m)
  pushHistoryPoint(state, serverId, m)
}

/** Unified delta-or-full mutator used by both applyDelta and applyDeltaBatch. */
function applyOne(state: Draft, serverId: string, delta: DeltaMetrics): void {
  if (!delta.isDelta) {
    applyFullSnapshot(state, serverId, delta)
    return
  }
  const existing = state.metricsMap[serverId]
  if (!existing) {
    // A delta is partial by contract. If the renderer missed the initial full
    // snapshot, storing an orphan delta as complete data makes tabs like
    // Databases appear empty when only non-DB fields changed.
    return
  }
  // Remove dropped databases (ghost-DB prevention)
  if (delta.removedDbs?.length) {
    const removed = new Set(delta.removedDbs)
    existing.databases = existing.databases.filter((d) => !removed.has(d.name))
  }
  // Merge: O(N) using a name→index Map. The previous findIndex() inside forEach
  // was O(N²) — visible in profiles at ~1500 DBs across 200 servers per batch.
  if (delta.databases.length > 0) {
    const indexByName = new Map<string, number>()
    for (let i = 0; i < existing.databases.length; i++) {
      indexByName.set(existing.databases[i].name, i)
    }
    for (const changedDb of delta.databases) {
      const idx = indexByName.get(changedDb.name)
      if (idx !== undefined) {
        existing.databases[idx] = changedDb
      } else {
        indexByName.set(changedDb.name, existing.databases.length)
        existing.databases.push(changedDb)
      }
    }
  }
  // Instance-level fields
  Object.assign(existing.instanceInfo, delta.instanceInfo)
  existing.activeSessions = delta.activeSessions
  existing.backupStatus = delta.backupStatus
  existing.collectedAt = delta.collectedAt
  // Strip transient delta metadata so it never persists in the store
  delete existing.isDelta
  delete existing.removedDbs

  state.summaries[serverId] = buildSummary(existing)
  pushHistoryPoint(state, serverId, existing)
}
