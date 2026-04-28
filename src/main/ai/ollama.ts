import { Ollama } from 'ollama'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export const OLLAMA_HOST = 'http://127.0.0.1:11434'

const client = new Ollama({ host: OLLAMA_HOST })

export async function ollamaChat(
  messages: ChatMessage[],
  model = 'codellama:latest'
): Promise<string> {
  const res = await client.chat({
    model,
    messages,
    stream: false,
    options: {
      temperature: 0.1,
      top_p: 0.9,
      num_predict: 512
    }
  })
  return res.message.content
}

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    await client.list()
    return true
  } catch {
    return false
  }
}
