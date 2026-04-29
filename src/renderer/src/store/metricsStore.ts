import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ServerMetrics, ServerHealthPayload } from '../../../preload/index'

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
}

// ── Store implementation ───────────────────────────────────────────────────

export const useMetricsStore = create<MetricsStore>()(
  immer((set) => ({
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
  }))
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
    state.metricsMap[serverId] = delta
    state.summaries[serverId] = buildSummary(delta)
    return
  }
  // Remove dropped databases (ghost-DB prevention)
  if (delta.removedDbs?.length) {
    const removed = new Set(delta.removedDbs)
    existing.databases = existing.databases.filter((d) => !removed.has(d.name))
  }
  // Merge: update or insert changed databases
  delta.databases.forEach((changedDb) => {
    const idx = existing.databases.findIndex((d) => d.name === changedDb.name)
    if (idx >= 0) existing.databases[idx] = changedDb
    else existing.databases.push(changedDb)
  })
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
