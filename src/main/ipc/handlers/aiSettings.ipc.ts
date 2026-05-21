import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { IpcChannel } from '../types'
import type { IpcResult, AiProviderSettings, AiProviderName } from '../types'
import { getDb } from '../../store/database'
import { encrypt, decrypt, isAvailable as safeStorageAvailable } from '../../store/safeStorageUtil'
import { getProvider } from '../../ai/providers'

function loadRaw(): { map: Record<string, string> } {
  const db = getDb()
  const rows = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings').all()
  return { map: Object.fromEntries(rows.map((r) => [r.key, r.value])) }
}

function upsert(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

function readSettings(): AiProviderSettings {
  const { map } = loadRaw()
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
    ollamaModel: map['ai_ollama_model'] ?? 'llama3.2:3b',
    claudeApiKey,
    claudeModel: map['ai_claude_model'] ?? 'claude-haiku-4-5-20251001',
    redactQueryText: map['ai_redact_query_text'] !== 'false',
    agentActionsEnabled: map['ai_agent_actions_enabled'] !== 'false'
  }
}

export function registerAiSettingsHandlers(): void {
  handle(IpcChannel.AI_GET_SETTINGS, (): IpcResult<AiProviderSettings> => {
    try {
      return { ok: true, data: readSettings() }
    } catch (err) {
      log.error('[IPC] AI_GET_SETTINGS:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.AI_SAVE_SETTINGS, (
    _event: IpcMainInvokeEvent,
    settings: Partial<AiProviderSettings>
  ): IpcResult<null> => {
    try {
      if (settings.provider != null) upsert('ai_provider', settings.provider)
      if (settings.ollamaModel != null) upsert('ai_ollama_model', settings.ollamaModel.trim())
      if (settings.claudeModel != null) upsert('ai_claude_model', settings.claudeModel.trim())
      if (settings.redactQueryText != null) upsert('ai_redact_query_text', String(settings.redactQueryText))
      if (settings.agentActionsEnabled != null) upsert('ai_agent_actions_enabled', String(settings.agentActionsEnabled))

      if (settings.claudeApiKey != null && settings.claudeApiKey.trim() !== '') {
        // Only update the stored key if it's a real value (not the masked placeholder).
        const raw = settings.claudeApiKey.trim()
        if (!raw.endsWith('…') && raw !== '••••••••') {
          if (!safeStorageAvailable()) {
            throw new Error('Secure storage unavailable — cannot store Claude API key safely. Launch the app as a logged-in user.')
          }
          upsert('ai_claude_api_key', encrypt(raw))
        }
      }

      return { ok: true, data: null }
    } catch (err) {
      log.error('[IPC] AI_SAVE_SETTINGS:', safeError(err))
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.AI_CHECK_PROVIDER, async (): Promise<IpcResult<boolean>> => {
    try {
      const provider = getProvider()
      const ok = await provider.health()
      return { ok: true, data: ok }
    } catch (err) {
      log.error('[IPC] AI_CHECK_PROVIDER:', safeError(err))
      return { ok: true, data: false }
    }
  })
}
