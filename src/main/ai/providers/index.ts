import { getDb } from '../../store/database'
import { decrypt } from '../../store/safeStorageUtil'
import { OllamaProvider } from './ollamaProvider'
import { ClaudeProvider } from './claudeProvider'
import type { LlmProvider } from './provider'

export type { LlmProvider, LlmRequest, LlmMessage, ToolDefinition } from './provider'

export type ProviderName = 'ollama' | 'claude'

interface AiProviderSettings {
  provider: ProviderName
  ollamaModel: string
  claudeApiKey?: string
  claudeModel: string
}

function loadAiSettings(): AiProviderSettings {
  const db = getDb()
  const rows = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings').all()
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    provider: (map['ai_provider'] as ProviderName) ?? 'ollama',
    ollamaModel: map['ai_ollama_model'] ?? 'llama3.2:3b',
    claudeApiKey: map['ai_claude_api_key'] ? decrypt(map['ai_claude_api_key']) : undefined,
    claudeModel: map['ai_claude_model'] ?? 'claude-haiku-4-5-20251001'
  }
}

export function getProvider(override?: ProviderName): LlmProvider {
  const settings = loadAiSettings()
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

export function getProviderName(): ProviderName {
  return loadAiSettings().provider
}
