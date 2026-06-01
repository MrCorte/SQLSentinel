import { getRawSettings } from '../../store/sqlserver/settingsRepository'
import { decrypt } from '../../utils/safeStorageUtil'
import { OllamaProvider } from './ollamaProvider'
import { ClaudeProvider } from './claudeProvider'
import type { LlmProvider } from './provider'
import { normalizeOllamaModel } from './defaults'

export type { LlmProvider, LlmRequest, LlmMessage, ToolDefinition } from './provider'
export { DEFAULT_OLLAMA_MODEL } from './defaults'

export type ProviderName = 'ollama' | 'claude'

interface AiProviderSettings {
  provider: ProviderName
  ollamaModel: string
  claudeApiKey?: string
  claudeModel: string
}

const AI_KEYS = [
  'ai_provider',
  'ai_ollama_model',
  'ai_claude_api_key',
  'ai_claude_model'
]

async function loadAiSettings(): Promise<AiProviderSettings> {
  const map = await getRawSettings(AI_KEYS)
  return {
    provider: (map['ai_provider'] as ProviderName) ?? 'ollama',
    ollamaModel: normalizeOllamaModel(map['ai_ollama_model']),
    claudeApiKey: map['ai_claude_api_key'] ? decrypt(map['ai_claude_api_key']) : undefined,
    claudeModel: map['ai_claude_model'] ?? 'claude-haiku-4-5-20251001'
  }
}

export async function getProvider(override?: ProviderName): Promise<LlmProvider> {
  const settings = await loadAiSettings()
  const name = override ?? settings.provider

  if (name === 'claude') {
    const apiKey = settings.claudeApiKey
    if (!apiKey) {
      throw new Error('Claude API key not configured. Go to Settings → AI Provider to add it.')
    }
    return new ClaudeProvider(apiKey, settings.claudeModel)
  }

  return new OllamaProvider(settings.ollamaModel)
}

export async function getProviderName(): Promise<ProviderName> {
  return (await loadAiSettings()).provider
}
