import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { getAlerts, acknowledgeAlert } from '../../metricsWorker'
import { IpcChannel, type AcknowledgeAlertRequest, type IpcResult, type Alert } from '../types'

export function registerAlarmHandlers(): void {
  handle(IpcChannel.ALERTS_GET_ALL, async (): Promise<IpcResult<Alert[]>> => {
    try {
      return { ok: true, data: getAlerts() }
    } catch (err) {
      log.error('[IPC] ALERTS_GET_ALL:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.ALERTS_ACKNOWLEDGE,
    async (_event: IpcMainInvokeEvent, req: AcknowledgeAlertRequest): Promise<IpcResult<null>> => {
      try {
        const ok = acknowledgeAlert(req.alertId)
        if (!ok) return { ok: false, error: `Alert ${req.alertId} not found` }
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] ALERTS_ACKNOWLEDGE:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
