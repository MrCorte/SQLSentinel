import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { serviceApi } from '../../serviceClient'
import { IpcChannel, type AcknowledgeAlertRequest, type IpcResult, type Alert } from '../types'

export function registerAlarmHandlers(): void {
  handle(IpcChannel.ALERTS_GET_ALL, async (): Promise<IpcResult<Alert[]>> => {
    try {
      const res = await serviceApi.getAlerts()
      return res as IpcResult<Alert[]>
    } catch (err) {
      log.error('[IPC] ALERTS_GET_ALL:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.ALERTS_ACKNOWLEDGE,
    async (_event: IpcMainInvokeEvent, req: AcknowledgeAlertRequest): Promise<IpcResult<null>> => {
      try {
        await serviceApi.acknowledgeAlert(req.alertId)
        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] ALERTS_ACKNOWLEDGE:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
