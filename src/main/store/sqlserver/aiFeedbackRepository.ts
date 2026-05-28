import * as sql from 'mssql'
import { createHash } from 'crypto'
import { getPool } from './connection'

export interface AiFeedbackRow {
  id: string
  question: string
  response: string
  questionHash: string
  rating: 1 | -1
  embedding: Buffer | null
  provider: string
  model: string
  incidentId: string | null
  createdAt: string
  createdBy: string | null
}

export interface AiFeedbackInput {
  question: string
  response: string
  rating: 1 | -1
  embedding: Buffer | null
  provider: string
  model: string
  incidentId?: string | null
  createdBy?: string | null
}

export interface PromotionCandidate {
  questionHash: string
  exampleQuestion: string
  upvotes: number
  bestResponse: string
  latestProvider: string
  latestModel: string
}

export interface TsqlMapEntry {
  id: string
  keyName: string
  aliases: string[]
  tsql: string
  promotedFrom: string | null
  promotedHash: string | null
  createdAt: string
}

// Normalize a question to a stable hash key — lowercase, collapse whitespace,
// drop punctuation. "Show me what is blocked!" and "show me what is blocked"
// must hash to the same value so we can group near-duplicates.
export function hashQuestion(question: string): string {
  const normalized = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return createHash('sha256').update(normalized).digest('hex')
}

export async function insertFeedback(input: AiFeedbackInput): Promise<string> {
  const pool = getPool()
  const id = crypto.randomUUID()
  const questionHash = hashQuestion(input.question)
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('question', sql.NVarChar(2000), input.question.slice(0, 2000))
    .input('response', sql.NVarChar(sql.MAX), input.response)
    .input('question_hash', sql.Char(64), questionHash)
    .input('rating', sql.SmallInt, input.rating)
    .input('embedding', sql.VarBinary(sql.MAX), input.embedding)
    .input('provider', sql.NVarChar(20), input.provider)
    .input('model', sql.NVarChar(100), input.model)
    .input('incident_id', sql.NVarChar(36), input.incidentId ?? null)
    .input('created_by', sql.NVarChar(100), input.createdBy ?? null)
    .query(`INSERT INTO dbo.ai_feedback
            (id, question, response, question_hash, rating, embedding, provider, model, incident_id, created_by)
            VALUES (@id, @question, @response, @question_hash, @rating, @embedding,
                    @provider, @model, @incident_id, @created_by)`)
  return id
}

interface RawFeedbackRow {
  id: string
  question: string
  response: string
  question_hash: string
  rating: number
  embedding: Buffer | null
  provider: string
  model: string
  incident_id: string | null
  created_at: Date | string
  created_by: string | null
}

function rowToRecord(row: RawFeedbackRow): AiFeedbackRow {
  return {
    id: row.id,
    question: row.question,
    response: row.response,
    questionHash: row.question_hash,
    rating: row.rating > 0 ? 1 : -1,
    embedding: row.embedding,
    provider: row.provider,
    model: row.model,
    incidentId: row.incident_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdBy: row.created_by
  }
}

export async function listAll(): Promise<AiFeedbackRow[]> {
  const pool = getPool()
  const r = await pool.request().query<RawFeedbackRow>(
    `SELECT id, question, response, question_hash, rating, embedding,
              provider, model, incident_id, created_at, created_by
       FROM dbo.ai_feedback ORDER BY created_at DESC`
  )
  return r.recordset.map(rowToRecord)
}

// Used by feedbackIndex.preWarm — only positive rows with an embedding.
export async function listEmbeddable(): Promise<AiFeedbackRow[]> {
  const pool = getPool()
  const r = await pool.request().query<RawFeedbackRow>(
    `SELECT id, question, response, question_hash, rating, embedding,
              provider, model, incident_id, created_at, created_by
       FROM dbo.ai_feedback WHERE rating = 1 AND embedding IS NOT NULL`
  )
  return r.recordset.map(rowToRecord)
}

export async function deleteFeedback(id: string): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .query(`DELETE FROM dbo.ai_feedback WHERE id = @id`)
}

// Promotion candidates: question_hash with ≥ MIN_UPVOTES positive ratings,
// not already promoted into ai_tsql_map.
const MIN_UPVOTES_FOR_PROMOTION = 3

export async function findPromotionCandidates(): Promise<PromotionCandidate[]> {
  const pool = getPool()
  const r = await pool.request().input('min', sql.Int, MIN_UPVOTES_FOR_PROMOTION).query<{
    question_hash: string
    example_question: string
    upvotes: number
    best_response: string
    latest_provider: string
    latest_model: string
  }>(`
      WITH grouped AS (
        SELECT question_hash, COUNT(*) AS upvotes
        FROM dbo.ai_feedback
        WHERE rating = 1
        GROUP BY question_hash
        HAVING COUNT(*) >= @min
      ),
      latest AS (
        SELECT question_hash, response, provider, model, question,
               ROW_NUMBER() OVER (PARTITION BY question_hash ORDER BY created_at DESC) AS rn
        FROM dbo.ai_feedback
        WHERE rating = 1
      )
      SELECT g.question_hash,
             l.question         AS example_question,
             g.upvotes,
             l.response         AS best_response,
             l.provider         AS latest_provider,
             l.model            AS latest_model
      FROM grouped g
      JOIN latest l ON l.question_hash = g.question_hash AND l.rn = 1
      -- NOT EXISTS (vs the previous NOT IN) avoids NULL-comparison surprises
      -- when ai_tsql_map.promoted_hash is NULL, and matches the seek-friendly
      -- filtered IX_ai_tsql_map_promoted_hash predicate.
      WHERE NOT EXISTS (
        SELECT 1 FROM dbo.ai_tsql_map m
        WHERE m.promoted_hash IS NOT NULL
          AND m.promoted_hash = g.question_hash
      )
      ORDER BY g.upvotes DESC`)
  return r.recordset.map((row) => ({
    questionHash: row.question_hash,
    exampleQuestion: row.example_question,
    upvotes: row.upvotes,
    bestResponse: row.best_response,
    latestProvider: row.latest_provider,
    latestModel: row.latest_model
  }))
}

export interface InsertTsqlMapEntryInput {
  keyName: string
  aliases: string[]
  tsql: string
  promotedFrom?: string | null
  promotedHash?: string | null
}

export async function insertTsqlMapEntry(input: InsertTsqlMapEntryInput): Promise<string> {
  const pool = getPool()
  const id = crypto.randomUUID()
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('key_name', sql.NVarChar(100), input.keyName)
    .input('aliases', sql.NVarChar(sql.MAX), JSON.stringify(input.aliases))
    .input('tsql', sql.NVarChar(sql.MAX), input.tsql)
    .input('promoted_from', sql.NVarChar(36), input.promotedFrom ?? null)
    .input('promoted_hash', sql.Char(64), input.promotedHash ?? null)
    .query(`INSERT INTO dbo.ai_tsql_map (id, key_name, aliases, tsql, promoted_from, promoted_hash)
            VALUES (@id, @key_name, @aliases, @tsql, @promoted_from, @promoted_hash)`)
  return id
}

export async function listTsqlMapEntries(): Promise<TsqlMapEntry[]> {
  const pool = getPool()
  const r = await pool.request().query<{
    id: string
    key_name: string
    aliases: string
    tsql: string
    promoted_from: string | null
    promoted_hash: string | null
    created_at: Date | string
  }>(`SELECT id, key_name, aliases, tsql, promoted_from, promoted_hash, created_at
        FROM dbo.ai_tsql_map ORDER BY created_at DESC`)
  return r.recordset.map((row) => ({
    id: row.id,
    keyName: row.key_name,
    aliases: safeParseAliases(row.aliases),
    tsql: row.tsql,
    promotedFrom: row.promoted_from,
    promotedHash: row.promoted_hash,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  }))
}

function safeParseAliases(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

export async function deleteTsqlMapEntry(id: string): Promise<void> {
  const pool = getPool()
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .query(`DELETE FROM dbo.ai_tsql_map WHERE id = @id`)
}
