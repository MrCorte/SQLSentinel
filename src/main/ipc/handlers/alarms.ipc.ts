import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { serviceApi, getStatus } from '../../serviceClient'
import { getAlerts, acknowledgeAlert } from '../../metricsWorker'
import { IpcChannel, type AcknowledgeAlertRequest, type IpcResult, type Alert } from '../types'

// Quando il Windows Service è il collector attivo gli alert vivono lì; quando è
// giù (macOS dev, service non installato o crashato) il collector è il worker
// in-process e gli alert stanno nella sua memoria. Senza il fallback locale la
// pagina alert restava cieca ("fetch failed") ogni volta che il service non c'era.
function serviceIsActive(): boolean {
  return getStatus() === 'connected'
}

export function registerAlarmHandlers(): void {
  handle(IpcChannel.ALERTS_GET_ALL, async (): Promise<IpcResult<Alert[]>> => {
    try {
      if (!serviceIsActive()) return { ok: true, data: getAlerts() }
      const res = await serviceApi.getAlerts()
      return res as IpcResult<Alert[]>
    } catch (err) {
      log.error('[IPC] ALERTS_GET_ALL:', safeError(err))
      // Il service è caduto tra il check e la fetch: servi comunque lo stato locale.
      return { ok: true, data: getAlerts() }
    }
  })

  handle(
    IpcChannel.ALERTS_ACKNOWLEDGE,
    async (_event: IpcMainInvokeEvent, req: AcknowledgeAlertRequest): Promise<IpcResult<null>> => {
      try {
        if (!serviceIsActive()) {
          acknowledgeAlert(req.alertId)
          return { ok: true, data: null }
        }
        await serviceApi.acknowledgeAlert(req.alertId)
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] ALERTS_ACKNOWLEDGE:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
