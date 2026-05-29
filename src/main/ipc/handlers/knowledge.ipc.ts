import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import {
  langGraphAsk,
  langGraphStream,
  abortActiveStream,
  reloadDynamicTsqlMap,
  TSQL_MAP_BUILTIN,
  type AgentHistory
} from '../../ai/langGraphAgent'
import { getProvider } from '../../ai/providers'
import { resetIndex, preWarmIndex } from '../../store/sqlserver/knowledgeRepository'
import { getQueryEmbedding, packEmbedding } from '../../ai/embedder'
import {
  addRow as addFeedbackRow,
  removeRow as removeFeedbackRow,
  removeByQuestion as removeByQuestionFromIndex,
  preWarm as preWarmFeedbackIndex
} from '../../ai/feedbackIndex'
import { invalidate as invalidateResponseCache, putCachedApproved } from '../../ai/responseCache'
import {
  insertFeedback,
  listAll as listAllFeedback,
  deleteFeedback as deleteFeedbackRow,
  findPromotionCandidates,
  insertTsqlMapEntry,
  listTsqlMapEntries,
  deleteTsqlMapEntry,
  hashQuestion
} from '../../store/sqlserver/aiFeedbackRepository'
import {
  IpcChannel,
  type IpcResult,
  type AiStreamEvent,
  type AiFeedbackSaveInput,
  type AiFeedbackRecord,
  type PromotionCandidateDto,
  type TsqlMapEntryDto,
  type PromoteToTsqlMapInput
} from '../types'

// Promoted map entries become trusted query templates the agent can later run,
// so validate the renderer-supplied payload before persisting it: bound the key
// charset/length, cap the SQL size, and reject anything that isn't read-only.
const KEY_NAME_RE = /^[a-z0-9_-]{1,64}$/i
// Statement-modifying / out-of-server constructs that must never appear in a
// promoted (auto-runnable) template. Mirrors executeReadOnly.WRITE_PATTERN.
const TSQL_WRITE_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE|MERGE|BULK|GRANT|REVOKE|DENY|KILL|DBCC|CHECKPOINT|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|OPENROWSET|OPENQUERY|OPENDATASOURCE|WAITFOR|xp_cmdshell|sp_configure|sp_executesql)\b/i

function validatePromotionInput(input: PromoteToTsqlMapInput): string | null {
  if (!input || typeof input.keyName !== 'string' || !KEY_NAME_RE.test(input.keyName)) {
    return 'Invalid keyName (allowed: letters, digits, _ -, 1-64 chars)'
  }
  if (typeof input.tsql !== 'string' || input.tsql.length === 0 || input.tsql.length > 8000) {
    return 'Invalid tsql (must be 1-8000 chars)'
  }
  if (TSQL_WRITE_PATTERN.test(input.tsql)) {
    return 'Promoted T-SQL must be read-only (no write/EXEC/DBCC/etc.)'
  }
  if (input.aliases != null) {
    if (
      !Array.isArray(input.aliases) ||
      input.aliases.some((a) => typeof a !== 'string' || a.length > 128)
    ) {
      return 'Invalid aliases'
    }
  }
  return null
}

export function registerKnowledgeHandlers(): void {
  handle(IpcChannel.AI_CHECK, async (): Promise<IpcResult<boolean>> => {
    try {
      const provider = await getProvider()
      return { ok: true, data: await provider.health() }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.AI_AGENT_ASK,
    async (
      _event: IpcMainInvokeEvent,
      question: string,
      history: AgentHistory[]
    ): Promise<IpcResult<string>> => {
      try {
        return { ok: true, data: await langGraphAsk(question, history) }
      } catch (err) {
        log.error('[IPC] AI_AGENT_ASK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // Starts a streaming session. Returns immediately; events arrive via AI_STREAM_EVENT push.
  handle(
    IpcChannel.AI_AGENT_STREAM,
    (
      event: IpcMainInvokeEvent,
      question: string,
      history: AgentHistory[],
      options?: { targetServerId?: string }
    ): IpcResult<void> => {
      const sender = event.sender
      const send = (ev: AiStreamEvent): void => {
        if (!sender.isDestroyed()) sender.send(IpcChannel.AI_STREAM_EVENT, ev)
      }
      langGraphStream(question, history, send, options).catch((err) => {
        send({ type: 'error', message: safeError(err) })
      })
      return { ok: true, data: undefined }
    }
  )

  handle(IpcChannel.AI_AGENT_CANCEL, (): void => {
    abortActiveStream()
  })

  handle(IpcChannel.AI_VEC_RELOAD, (): IpcResult<void> => {
    try {
      resetIndex()
      preWarmIndex()
      return { ok: true, data: undefined }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  // ── AI feedback ────────────────────────────────────────────────────────────
  handle(
    IpcChannel.AI_SAVE_FEEDBACK,
    async (_event, input: AiFeedbackSaveInput): Promise<IpcResult<string>> => {
      try {
        // Best-effort embedding — save the row even if Ollama is down.
        let embedding: Buffer | null = null
        let vec: Float32Array | null = null
        if (input.rating === 1) {
          try {
            vec = await getQueryEmbedding(input.question)
            embedding = packEmbedding(vec)
          } catch {
            // Row will be saved without embedding; won't be matched by findSimilar
            // until a future re-embed job (out of MVP scope).
          }
        }
        const id = await insertFeedback({
          question: input.question,
          response: input.response,
          rating: input.rating,
          embedding,
          provider: input.provider,
          model: input.model,
          incidentId: input.incidentId ?? null
        })
        if (input.rating === 1 && vec) {
          addFeedbackRow({ id, question: input.question, response: input.response, vec })
          // Re-cache the approved answer with a 1-hour TTL so subsequent identical
          // questions are answered instantly with the user-validated response.
          putCachedApproved(input.question, input.response)
        }
        // Drop any cached response for this question so a re-ask reflects the
        // user's signal — especially important on 👎 where the cache would
        // otherwise replay the (now disliked) answer for up to 10 minutes.
        invalidateResponseCache(input.question)
        // On 👎, retract any previously approved entries for this question from the
        // few-shot index so the bad answer can no longer appear as a past example.
        if (input.rating === -1) {
          removeByQuestionFromIndex(input.question)
        }
        return { ok: true, data: id }
      } catch (err) {
        log.error('[IPC] AI_SAVE_FEEDBACK:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(IpcChannel.AI_LIST_FEEDBACK, async (): Promise<IpcResult<AiFeedbackRecord[]>> => {
    try {
      const rows = await listAllFeedback()
      return {
        ok: true,
        data: rows.map((r) => ({
          id: r.id,
          question: r.question,
          response: r.response,
          rating: r.rating,
          provider: r.provider,
          model: r.model,
          incidentId: r.incidentId,
          createdAt: r.createdAt,
          createdBy: r.createdBy,
          hasEmbedding: r.embedding != null
        }))
      }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  handle(IpcChannel.AI_DELETE_FEEDBACK, async (_event, id: string): Promise<IpcResult<void>> => {
    try {
      await deleteFeedbackRow(id)
      removeFeedbackRow(id)
      return { ok: true, data: undefined }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.AI_LIST_PROMOTION_CANDIDATES,
    async (): Promise<IpcResult<PromotionCandidateDto[]>> => {
      try {
        const rows = await findPromotionCandidates()
        return { ok: true, data: rows }
      } catch (err) {
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(
    IpcChannel.AI_PROMOTE_TO_TSQL_MAP,
    async (_event, input: PromoteToTsqlMapInput): Promise<IpcResult<string>> => {
      try {
        const validationError = validatePromotionInput(input)
        if (validationError) return { ok: false, error: validationError }
        const id = await insertTsqlMapEntry({
          keyName: input.keyName,
          aliases: input.aliases,
          tsql: input.tsql,
          promotedHash: input.promotedHash
        })
        await reloadDynamicTsqlMap()
        return { ok: true, data: id }
      } catch (err) {
        log.error('[IPC] AI_PROMOTE_TO_TSQL_MAP:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )

  handle(IpcChannel.AI_LIST_TSQL_MAP, async (): Promise<IpcResult<TsqlMapEntryDto[]>> => {
    try {
      const promoted = await listTsqlMapEntries()
      const builtin: TsqlMapEntryDto[] = Object.entries(TSQL_MAP_BUILTIN).map(([key, tsql]) => ({
        id: `builtin:${key}`,
        keyName: key,
        aliases: [],
        tsql,
        promotedFrom: null,
        promotedHash: null,
        createdAt: '',
        origin: 'builtin' as const
      }))
      const promotedDto: TsqlMapEntryDto[] = promoted.map((e) => ({
        ...e,
        origin: 'promoted' as const
      }))
      return { ok: true, data: [...promotedDto, ...builtin] }
    } catch (err) {
      return { ok: false, error: safeError(err) }
    }
  })

  handle(
    IpcChannel.AI_DELETE_TSQL_MAP_ENTRY,
    async (_event, id: string): Promise<IpcResult<void>> => {
      try {
        if (id.startsWith('builtin:')) {
          return { ok: false, error: 'Built-in entries cannot be deleted' }
        }
        await deleteTsqlMapEntry(id)
        await reloadDynamicTsqlMap()
        return { ok: true, data: undefined }
      } catch (err) {
        return { ok: false, error: safeError(err) }
      }
    }
  )

  // Suppress unused-import lints when the module is loaded but storage isn't ready
  void preWarmFeedbackIndex
  void hashQuestion
}
