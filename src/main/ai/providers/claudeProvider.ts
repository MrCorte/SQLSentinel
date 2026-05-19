import Anthropic from '@anthropic-ai/sdk'
import type { LlmProvider, LlmRequest, ToolDefinition } from './provider'

function toAnthropicTool(def: ToolDefinition): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.inputSchema as Anthropic.Tool['input_schema']
  }
}

export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude' as const
  readonly model: string
  private _client: Anthropic | null = null
  private readonly apiKey: string

  constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
    this.apiKey = apiKey
    this.model = model
  }

  private getClient(): Anthropic {
    if (!this._client) {
      this._client = new Anthropic({ apiKey: this.apiKey })
    }
    return this._client
  }

  async health(): Promise<boolean> {
    try {
      await this.getClient().models.list()
      return true
    } catch {
      return false
    }
  }

  async stream(req: LlmRequest): Promise<void> {
    const { systemPrompt, messages, tools, onToolCall, onEvent, signal } = req

    const client = this.getClient()
    const anthropicTools = tools.map(toAnthropicTool)

    const buildMessages = (msgs: typeof messages): Anthropic.MessageParam[] =>
      msgs.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))

    const currentMessages = [...messages]

    const MAX_ITERATIONS = 8
    let totalTokensIn = 0
    let totalTokensOut = 0

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal.aborted) {
        onEvent({ type: 'error', message: 'Cancelled' })
        return
      }

      const streamParams: Anthropic.MessageStreamParams = {
        model: this.model,
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            // Cache system prompt + tools — costanti tra invocazioni
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: buildMessages(currentMessages),
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {})
      }

      let finalText = ''
      const toolUseBlocks: Anthropic.ToolUseBlock[] = []

      const stream = client.messages.stream(streamParams)

      for await (const event of stream) {
        if (signal.aborted) {
          onEvent({ type: 'error', message: 'Cancelled' })
          return
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            onEvent({ type: 'token', text: event.delta.text })
            finalText += event.delta.text
          }
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            onEvent({ type: 'tool_start', name: event.content_block.name })
            toolUseBlocks.push(event.content_block as Anthropic.ToolUseBlock)
          }
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            totalTokensOut += event.usage.output_tokens
          }
        } else if (event.type === 'message_start') {
          if (event.message.usage) {
            totalTokensIn += event.message.usage.input_tokens
          }
        }
      }

      const finalMessage = await stream.finalMessage()

      if (finalMessage.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
        onEvent({ type: 'done' })
        return
      }

      // Processa tool calls
      currentMessages.push({ role: 'assistant', content: finalText })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of toolUseBlocks) {
        const inputObj = (block.input ?? {}) as Record<string, unknown>
        try {
          const output = await onToolCall(block.name, inputObj)
          onEvent({ type: 'tool_end', name: block.name, output: output.slice(0, 2000) })
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: output })
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          onEvent({ type: 'tool_end', name: block.name, output: `Error: ${errMsg}` })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${errMsg}`,
            is_error: true
          })
        }
      }

      currentMessages.push({
        role: 'user',
        content: JSON.stringify(toolResults)
      })
    }

    onEvent({ type: 'error', message: 'Max iterations reached without final answer' })
  }
}
