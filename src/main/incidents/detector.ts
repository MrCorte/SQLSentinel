import { onIncidentAlert } from '../metricsWorker'
import * as repository from './repository'
import { getInstanceAliases } from '../store/sqlserver/serverRepository'
import { getActiveAgentCount } from './incidentAgent'
import { createLogger } from '../utils/logger'
import type { Alert } from '../ipc/types'

// Hard cap on simultaneous incident agents to prevent an alert storm from
// overwhelming the SQL Server being monitored with parallel diagnostic queries.
const MAX_CONCURRENT_AGENTS = 5

const log = createLogger('incident-detector')

// Dedup is now scoped to "the same SQL Server instance" (host:port:instanceName)
// and "any active status" (open / investigating / awaiting_approval). A new alert
// only spawns a fresh incident when no active one exists for that instance+category.
// Resolved/archived incidents are explicitly NOT resurrected — they stay closed.

const SEVERITY_RANK: Record<string, number> = { WARNING: 1, CRITICAL: 2 }

type IncidentCallback = (type: 'created' | 'updated', incidentId: string) => void

let _callback: IncidentCallback | null = null
// Populated by registerIncidentHandlers to avoid a circular dep at import time.
let _agentRunner: ((id: string) => void) | null = null
// Tracks agents that are queued (setImmediate) but haven't started yet.
let _pendingAgentCount = 0

export function onIncidentChange(cb: IncidentCallback): void {
  _callback = cb
}

export function setAgentRunner(fn: (id: string) => void): void {
  _agentRunner = fn
}

export function attachDetector(): void {
  onIncidentAlert((alert: Alert) => {
    handleAlert(alert).catch((err) => {
      log.error('[detector] failed to process alert:', err)
    })
  })
  log.info('[detector] attached to alert pipeline')
}

async function handleAlert(alert: Alert): Promise<void> {
  const detectedAt = alert.detectedAt instanceof Date
    ? alert.detectedAt.getTime()
    : new Date(alert.detectedAt).getTime()

  // Resolve all serverIds that point to the SAME SQL Server instance, so two
  // registrations of the same host:port:instanceName share one incident.
  const aliases = getInstanceAliases(alert.serverId)
  const existing = await repository.findActiveForInstance(aliases, alert.category)

  if (existing) {
    await repository.addEvent(existing.id, 'alert_added', {
      alertId: alert.id,
      severity: alert.severity,
      message: alert.message,
      detectedAt: alert.detectedAt
    }, detectedAt)

    if ((SEVERITY_RANK[alert.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
      await repository.escalateSeverity(existing.id, alert.severity)
    }

    log.info(`[detector] alert appended to incident ${existing.id} (${alert.category})`)
    _callback?.('updated', existing.id)
  } else {
    const incident = await repository.createIncident(
      alert.serverId,
      alert.category,
      alert.severity,
      detectedAt
    )
    await repository.addEvent(incident.id, 'alert_added', {
      alertId: alert.id,
      severity: alert.severity,
      message: alert.message,
      detectedAt: alert.detectedAt
    }, detectedAt)

    log.info(`[detector] new incident ${incident.id} created (${alert.category}, ${alert.severity})`)
    _callback?.('created', incident.id)
    // Fire agent asynchronously so the alert pipeline is never blocked.
    if (_agentRunner) {
      const inflight = _pendingAgentCount + getActiveAgentCount()
      if (inflight >= MAX_CONCURRENT_AGENTS) {
        log.warn(
          `[detector] agent queue full (${inflight}/${MAX_CONCURRENT_AGENTS}) — skipping agent for incident ${incident.id}`
        )
        await repository.addEvent(incident.id, 'agent_run', {
          status: 'skipped',
          reason: 'queue_full'
        })
      } else {
        _pendingAgentCount++
        setImmediate(() => {
          _pendingAgentCount--
          _agentRunner!(incident.id)
        })
      }
    }
  }
}
