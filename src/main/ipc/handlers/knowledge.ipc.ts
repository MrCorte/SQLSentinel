import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { checkOllamaHealth } from '../../ai/ollama'
import { langGraphAsk, langGraphStream, abortActiveStream, type AgentHistory } from '../../ai/langGraphAgent'
import { IpcChannel, type IpcResult, type AiStreamEvent } from '../types'

export function registerKnowledgeHandlers(): void {
  handle(IpcChannel.AI_CHECK, async (): Promise<IpcResult<boolean>> => {
    try {
      return { ok: true, data: await checkOllamaHealth() }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.AI_AGENT_ASK,
    async (
      _event: IpcMainInvokeEvent,
      question: string,
      history: AgentHistory[]
    ): Promise<IpcResult<string>> => {
      try {
        return { ok: true, data: await langGraphAsk(question, history) }
      } catch (err) {
        log.error('[IPC] AI_AGENT_ASK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // Starts a streaming session. Returns immediately; events arrive via AI_STREAM_EVENT push.
  handle(
    IpcChannel.AI_AGENT_STREAM,
    (event: IpcMainInvokeEvent, question: string, history: AgentHistory[]): IpcResult<void> => {
      const sender = event.sender
      const send = (ev: AiStreamEvent): void => {
        if (!sender.isDestroyed()) sender.send(IpcChannel.AI_STREAM_EVENT, ev)
      }
      langGraphStream(question, history, send).catch((err) => {
        send({ type: 'error', message: safeError(err) })
      })
      return { ok: true, data: undefined }
    }
  )

  handle(IpcChannel.AI_AGENT_CANCEL, (): void => {
    abortActiveStream()
  })
}
