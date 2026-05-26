export const DEFAULT_OLLAMA_MODEL = 'gemma4:e4b'
export const LEGACY_DEFAULT_OLLAMA_MODEL = 'llama3.2:3b'

export function normalizeOllamaModel(model: string | undefined): string {
  if (!model || model === LEGACY_DEFAULT_OLLAMA_MODEL) return DEFAULT_OLLAMA_MODEL
  return model
}
