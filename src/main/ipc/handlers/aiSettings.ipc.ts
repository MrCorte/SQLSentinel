import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { IpcChannel } from '../types'
import type { IpcResult, AiProviderSettings, AiProviderName } from '../types'
import { getRawSettings, setRawSetting } from '../../store/sqlserver/settingsRepository'
import { encrypt, decrypt, isAvailable as safeStorageAvailable } from '../../utils/safeStorageUtil'
import { getProvider } from '../../ai/providers'
import { normalizeOllamaModel } from '../../ai/providers/defaults'

const AI_SETTING_KEYS = [
  'ai_provider',
  'ai_ollama_model',
  'ai_claude_api_key',
  'ai_claude_model',
  'ai_redact_query_text',
  'ai_agent_actions_enabled'
] as const

async function readSettings(): Promise<AiProviderSettings> {
  const map = await getRawSettings(AI_SETTING_KEYS as unknown as string[])
  const provider = (map['ai_provider'] as AiProviderName) ?? 'ollama'
  const rawKey = map['ai_claude_api_key']

  // Return a masked preview of the API key so the UI can show it's set without exposing the secret.
  let claudeApiKey: string | undefined
  if (rawKey) {
    try {
      const plain = decrypt(rawKey)
      claudeApiKey = plain.length > 8 ? `${plain.slice(0, 8)}…` : '••••••••'
    } catch {
      claudeApiKey = '••••••••'
    }
  }

  return {
    provider,
    ollamaModel: normalizeOllamaModel(map['ai_ollama_model']),
    claudeApiKey,
    claudeModel: map['ai_claude_model'] ?? 'claude-haiku-4-5-20251001',
    redactQueryText: map['ai_redact_query_text'] !== 'false',
    agentActionsEnabled: map['ai_agent_actions_enabled'] !== 'false'
  }
}

export function registerAiSettingsHandlers(): void {
  handle(IpcChannel.AI_GET_SETTINGS, async (): Promise<IpcResult<AiProviderSettings>> => {
    try {
      return { ok: true, data: await readSettings() }
    } catch (err) {
      log.error('[IPC] AI_GET_SETTINGS:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.AI_SAVE_SETTINGS,
    async (
      _event: IpcMainInvokeEvent,
      settings: Partial<AiProviderSettings>
    ): Promise<IpcResult<null>> => {
      try {
        if (settings.provider != null) await setRawSetting('ai_provider', settings.provider)
        if (settings.ollamaModel != null)
          await setRawSetting('ai_ollama_model', settings.ollamaModel.trim())
        if (settings.claudeModel != null)
          await setRawSetting('ai_claude_model', settings.claudeModel.trim())
        if (settings.redactQueryText != null)
          await setRawSetting('ai_redact_query_text', String(settings.redactQueryText))
        if (settings.agentActionsEnabled != null)
          await setRawSetting('ai_agent_actions_enabled', String(settings.agentActionsEnabled))

        if (settings.claudeApiKey != null && settings.claudeApiKey.trim() !== '') {
          // Only update the stored key if it's a real value (not the masked placeholder).
          const raw = settings.claudeApiKey.trim()
          if (!raw.endsWith('…') && raw !== '••••••••') {
            if (!safeStorageAvailable()) {
              throw new Error(
                'Secure storage unavailable — cannot store Claude API key safely. Launch the app as a logged-in user.'
              )
            }
            await setRawSetting('ai_claude_api_key', encrypt(raw))
          }
        }

        return { ok: true, data: null }
      } catch (err) {
        log.error('[IPC] AI_SAVE_SETTINGS:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(IpcChannel.AI_CHECK_PROVIDER, async (): Promise<IpcResult<boolean>> => {
    try {
      const provider = await getProvider()
      const ok = await provider.health()
      return { ok: true, data: ok }
    } catch (err) {
      log.error('[IPC] AI_CHECK_PROVIDER:', safeError(err))
      return { ok: true, data: false }
    }
  })
}
