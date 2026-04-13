import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { agentTools } from './agentTools'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Sei un DBA esperto SQL Server. Rispondi SEMPRE in italiano.
Prima di rispondere usa i tool per raccogliere dati reali sui server monitorati.

Struttura la risposta con queste sezioni:
**OSSERVAZIONE**: dati rilevanti trovati tramite i tool
**CAUSA PROBABILE**: diagnosi basata sui dati
**AZIONE IMMEDIATA**: usa suggest_tsql e mostra la query T-SQL pronta
**PROSSIMI CHECK**: lista azioni di follow-up consigliate

Usa solo query SELECT, mai DML (no INSERT/UPDATE/DELETE/DROP).
Se non hai abbastanza dati scrivi "Ho bisogno di più contesto."`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentHistory {
  role: 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// Lazy agent factory (singleton, created on first use)
// ---------------------------------------------------------------------------

let _agent: ReturnType<typeof createReactAgent> | null = null

function getAgent(): ReturnType<typeof createReactAgent> {
  if (_agent) return _agent
  const llm = new ChatOllama({
    model: 'deepseek-coder:1.3b',
    baseUrl: 'http://localhost:11434',
    temperature: 0.1,
    numPredict: 512,
    numCtx: 4096
  })
  _agent = createReactAgent({
    llm,
    tools: agentTools,
    stateModifier: SYSTEM_PROMPT
  })
  return _agent
}

// Invalidate cached agent (e.g. when Ollama config changes)
export function resetAgent(): void {
  _agent = null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function langGraphAsk(
  question: string,
  history: AgentHistory[] = []
): Promise<string> {
  const agent = getAgent()

  const messages = [
    ...history.slice(-6).map((h) =>
      h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content)
    ),
    new HumanMessage(question)
  ]

  const result = await agent.invoke({ messages })
  const last = result.messages[result.messages.length - 1]

  if (typeof last.content === 'string') return last.content
  if (Array.isArray(last.content)) {
    // LangChain may return array of content blocks
    return last.content
      .filter((b): b is { type: 'text'; text: string } => typeof b === 'object' && b !== null && 'text' in b)
      .map((b) => b.text)
      .join('')
  }
  return JSON.stringify(last.content)
}
