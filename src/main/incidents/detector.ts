import { onIncidentAlert } from '../metricsWorker'
import * as repository from './repository'
import { createLogger } from '../utils/logger'
import type { Alert } from '../ipc/types'

const log = createLogger('incident-detector')

const GROUPING_WINDOW_MS = 15 * 60 * 1000

const SEVERITY_RANK: Record<string, number> = { WARNING: 1, CRITICAL: 2 }

type IncidentCallback = (type: 'created' | 'updated', incidentId: string) => void

let _callback: IncidentCallback | null = null

export function onIncidentChange(cb: IncidentCallback): void {
  _callback = cb
}

export function attachDetector(): void {
  onIncidentAlert((alert: Alert) => {
    try {
      handleAlert(alert)
    } catch (err) {
      log.error('[detector] failed to process alert:', err)
    }
  })
  log.info('[detector] attached to alert pipeline')
}

function handleAlert(alert: Alert): void {
  const detectedAt = alert.detectedAt instanceof Date
    ? alert.detectedAt.getTime()
    : new Date(alert.detectedAt).getTime()

  const existing = repository.findOpenByServerAndCategory(alert.serverId, alert.category)

  if (existing && detectedAt - existing.openedAt < GROUPING_WINDOW_MS) {
    repository.addEvent(existing.id, 'alert_added', {
      alertId: alert.id,
      severity: alert.severity,
      message: alert.message,
      detectedAt: alert.detectedAt
    }, detectedAt)

    if ((SEVERITY_RANK[alert.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
      repository.escalateSeverity(existing.id, alert.severity)
    }

    log.info(`[detector] alert appended to incident ${existing.id} (${alert.category})`)
    _callback?.('updated', existing.id)
  } else {
    const incident = repository.createIncident(
      alert.serverId,
      alert.category,
      alert.severity,
      detectedAt
    )
    repository.addEvent(incident.id, 'alert_added', {
      alertId: alert.id,
      severity: alert.severity,
      message: alert.message,
      detectedAt: alert.detectedAt
    }, detectedAt)

    log.info(`[detector] new incident ${incident.id} created (${alert.category}, ${alert.severity})`)
    _callback?.('created', incident.id)
  }
}
