import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { OLLAMA_HOST, checkOllamaHealth } from '../ollama'
import { DEFAULT_OLLAMA_MODEL } from './defaults'
import type { LlmProvider, LlmRequest, ToolDefinition } from './provider'

function toOllamaTool(def: ToolDefinition) {
  return {
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema
    }
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as { type?: string; text?: string }[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
  }
  return ''
}

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama' as const
  readonly model: string
  private _llm: ChatOllama | null = null

  constructor(model = DEFAULT_OLLAMA_MODEL) {
    this.model = model
  }

  private getLlm(): ChatOllama {
    if (!this._llm) {
      this._llm = new ChatOllama({
        model: this.model,
        baseUrl: OLLAMA_HOST,
        temperature: 0,
        numPredict: 1024,
        numCtx: 8192,
        keepAlive: '30m'
      })
    }
    return this._llm
  }

  async health(): Promise<boolean> {
    return checkOllamaHealth()
  }

  async stream(req: LlmRequest): Promise<void> {
    const { systemPrompt, messages, tools, onToolCall, onEvent, signal } = req

    const llm = tools.length > 0
      ? this.getLlm().bindTools(tools.map(toOllamaTool))
      : this.getLlm()

    const lcMessages = [
      new SystemMessage(systemPrompt),
      ...messages.map((m) => {
        if (m.role === 'user') return new HumanMessage(m.content)
        if (m.role === 'tool') return new ToolMessage({ content: m.content, tool_call_id: m.toolName ?? 'tool' })
        return new AIMessage(m.content)
      })
    ]

    // Agentic loop: tool-use può richiedere più round-trip
    const MAX_ITERATIONS = 8
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal.aborted) {
        onEvent({ type: 'error', message: 'Cancelled' })
        return
      }

      const response = await (llm as ChatOllama).invoke(lcMessages, { signal })

      const toolCalls = Array.isArray((response as { tool_calls?: unknown[] }).tool_calls)
        ? (response as { tool_calls: { name: string; args: Record<string, unknown>; id?: string }[] }).tool_calls
        : []

      if (toolCalls.length === 0) {
        // Risposta finale — streamma i token
        const text = extractText(response.content)
        if (text) {
          for (const char of text) {
            onEvent({ type: 'token', text: char })
          }
        }
        onEvent({ type: 'done' })
        return
      }

      // Esegui tool calls in sequenza
      lcMessages.push(new AIMessage({ content: '', tool_calls: toolCalls }))

      for (const tc of toolCalls) {
        onEvent({ type: 'tool_start', name: tc.name })
        try {
          const output = await onToolCall(tc.name, tc.args)
          onEvent({ type: 'tool_end', name: tc.name, output: output.slice(0, 2000) })
          lcMessages.push(new ToolMessage({ content: output, tool_call_id: tc.id ?? tc.name }))
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          onEvent({ type: 'tool_end', name: tc.name, output: `Error: ${errMsg}` })
          lcMessages.push(new ToolMessage({ content: `Error: ${errMsg}`, tool_call_id: tc.id ?? tc.name }))
        }
      }
    }

    onEvent({ type: 'error', message: 'Max iterations reached without final answer' })
  }
}
