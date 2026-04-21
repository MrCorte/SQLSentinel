import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { checkOllamaHealth } from '../../ai/ollama'
import { langGraphAsk, type AgentHistory } from '../../ai/langGraphAgent'
import { IpcChannel, type IpcResult } from '../types'

export function registerKnowledgeHandlers(): void {
  // AI_CHECK — verifica se Ollama è raggiungibile localmente
  handle(IpcChannel.AI_CHECK, async (): Promise<IpcResult<boolean>> => {
    try {
      return { ok: true, data: await checkOllamaHealth() }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  // AI_AGENT_ASK — agente DBA multi-step con tool calling (LangGraph + Ollama)
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
}
