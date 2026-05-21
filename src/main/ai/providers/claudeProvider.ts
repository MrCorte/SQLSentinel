import type {
  default as AnthropicSDK,
  Tool,
  MessageParam,
  MessageStreamParams,
  ToolUseBlock,
  ToolResultBlockParam
} from '@anthropic-ai/sdk'
import type { LlmProvider, LlmRequest, ToolDefinition } from './provider'

// SDK loaded only on first Claude invocation — prevents app crash if the
// package isn't installed (e.g. fresh clone without npm install).
let _SdkClass: typeof AnthropicSDK | null = null

async function getSdkClass(): Promise<typeof AnthropicSDK> {
  if (!_SdkClass) {
    try {
      const mod = await import('@anthropic-ai/sdk')
      _SdkClass = mod.default as typeof AnthropicSDK
    } catch {
      throw new Error(
        '@anthropic-ai/sdk not found. Run "npm install" in the project root.'
      )
    }
  }
  return _SdkClass
}

function toAnthropicTool(def: ToolDefinition): Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.inputSchema as Tool['input_schema']
  }
}

export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude' as const
  readonly model: string
  private _client: AnthropicSDK | null = null
  private readonly apiKey: string

  constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
    this.apiKey = apiKey
    this.model = model
  }

  private async getClient(): Promise<AnthropicSDK> {
    if (!this._client) {
      const Anthropic = await getSdkClass()
      this._client = new Anthropic({ apiKey: this.apiKey })
    }
    return this._client
  }

  async health(): Promise<boolean> {
    try {
      const client = await this.getClient()
      await client.models.list()
      return true
    } catch {
      return false
    }
  }

  async stream(req: LlmRequest): Promise<void> {
    const { systemPrompt, messages, tools, onToolCall, onEvent, signal } = req

    const client = await this.getClient()
    const anthropicTools = tools.map(toAnthropicTool)

    // Maintain a typed Anthropic message list so multi-turn tool loops carry
    // full content arrays (text + tool_use blocks) as the API requires.
    const anthropicMessages: MessageParam[] = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))

    const MAX_ITERATIONS = 8
    let totalTokensIn = 0
    let totalTokensOut = 0

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal.aborted) {
        onEvent({ type: 'error', message: 'Cancelled' })
        return
      }

      const streamParams: MessageStreamParams = {
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
        messages: anthropicMessages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {})
      }

      let finalText = ''
      const toolUseBlocks: ToolUseBlock[] = []

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
            toolUseBlocks.push(event.content_block as ToolUseBlock)
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

      // Append the full assistant content (text + tool_use blocks) so the next
      // turn has matching tool_use IDs for the tool_result blocks.
      anthropicMessages.push({ role: 'assistant', content: finalMessage.content })

      const toolResults: ToolResultBlockParam[] = []
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

      anthropicMessages.push({ role: 'user', content: toolResults })
    }

    onEvent({ type: 'error', message: 'Max iterations reached without final answer' })

    // Suppress unused variable warning for token counters (used for future billing/logging)
    void totalTokensIn
    void totalTokensOut
  }
}
