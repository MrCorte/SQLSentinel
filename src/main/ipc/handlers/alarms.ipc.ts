import type { IpcMainInvokeEvent } from 'electron'
import { handle } from '../handleWrapper'
import { getAlerts, acknowledgeAlert } from '../../metricsWorker'
import {
  IpcChannel,
  type AcknowledgeAlertRequest,
  type IpcResult,
  type Alert,
} from '../types'

export function registerAlarmHandlers(): void {
  // ALERTS_GET_ALL — restituisce tutti gli alert (anche riconosciuti)
  handle(IpcChannel.ALERTS_GET_ALL, async (): Promise<IpcResult<Alert[]>> => {
    return { ok: true, data: getAlerts() }
  })

  // ALERTS_ACKNOWLEDGE — segna un alert come riconosciuto
  handle(
    IpcChannel.ALERTS_ACKNOWLEDGE,
    async (
      _event: IpcMainInvokeEvent,
      req: AcknowledgeAlertRequest
    ): Promise<IpcResult<null>> => {
      const ok = acknowledgeAlert(req.alertId)
      if (!ok) return { ok: false, error: `Alert ${req.alertId} non trovato` }
      return { ok: true, data: null }
    }
  )
}
