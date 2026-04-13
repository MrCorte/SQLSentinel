import { gatherContext } from './context'
import { ollamaChat } from './ollama'
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
  const ctx = await gatherContext()
  const systemWithCtx = `${SYSTEM_PROMPT}\n\nDATI CORRENTI:\n${JSON.stringify(ctx, null, 2)}`
  const messages: ChatMessage[] = [
    { role: 'system', content: systemWithCtx },
    ...history.slice(-6), // max 3 scambi precedenti per restare nel context window
    { role: 'user', content: question }
  ]
  return ollamaChat(messages)
}
