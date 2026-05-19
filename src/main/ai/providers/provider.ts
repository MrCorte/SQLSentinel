import type { AiStreamEvent } from '../../ipc/types'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface LlmMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
}

export interface LlmRequest {
  systemPrompt: string
  messages: LlmMessage[]
  tools: ToolDefinition[]
  onToolCall: (name: string, params: Record<string, unknown>) => Promise<string>
  onEvent: (ev: AiStreamEvent) => void
  signal: AbortSignal
}

export interface LlmProvider {
  readonly name: 'ollama' | 'claude'
  readonly model: string
  stream(req: LlmRequest): Promise<void>
  health(): Promise<boolean>
}
