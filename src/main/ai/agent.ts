import { gatherContext } from './context'
import { ollamaChat } from './ollama'
import { retrieveFromBooks } from './rag'
import type { ChatMessage } from './ollama'

const SYSTEM_PROMPT = `Sei un DBA esperto SQL Server. Rispondi SEMPRE in italiano.
Struttura la risposta in 3 sezioni brevi:
1. OSSERVAZIONE: cosa vedi nei dati
2. CAUSA PROBABILE: diagnosi
3. AZIONE IMMEDIATA: query SELECT da eseguire (no DROP/DELETE/UPDATE)
Se i dati non bastano scrivi solo "Ho bisogno di più contesto".`

export async function aiAsk(
  question: string,
  history: ChatMessage[] = []
): Promise<string> {
  const [ctx, bookChunks] = await Promise.all([
    gatherContext(),
    retrieveFromBooks(question, 5)
  ])

  const bookSection =
    bookChunks.length > 0
      ? `\n\nCONOSCENZA DAI LIBRI SQL:\n${bookChunks
          .map((c, i) => `[${i + 1}] ${c.content}`)
          .join('\n\n')}`
      : ''

  const systemWithCtx = `${SYSTEM_PROMPT}${bookSection}\n\nDATI CORRENTI:\n${JSON.stringify(ctx, null, 2)}`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemWithCtx },
    ...history.slice(-6),
    { role: 'user', content: question }
  ]
  return ollamaChat(messages)
}
