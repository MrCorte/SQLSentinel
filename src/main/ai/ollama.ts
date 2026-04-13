import { Ollama } from 'ollama'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const client = new Ollama({ host: 'http://127.0.0.1:11434' })

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

export async function ollamaEmbed(
  text: string,
  model = 'nomic-embed-text'
): Promise<number[]> {
  const res = await client.embed({ model, input: text })
  if (!res.embeddings || res.embeddings.length === 0) {
    throw new Error('[ollamaEmbed] Ollama returned empty embeddings')
  }
  return res.embeddings[0]
}
