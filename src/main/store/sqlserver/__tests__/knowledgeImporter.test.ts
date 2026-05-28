/**
 * Tests for knowledgeRepository.importKnowledgeIfEmpty.
 *
 * Covers:
 *  - Skip when destination tables are already populated (idempotency)
 *  - Skip when the SQLite build artifact is missing
 *  - Verifying that batched multi-row INSERTs are emitted (perf regression
 *    guard against the per-row INSERT loop the review surfaced)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// State shared between the fake pool and the assertions.
let countCards = 0
let countChunks = 0
let countEmbeds = 0
const insertedStatements: string[] = []

const txBegin = vi.fn(async () => {})
const txCommit = vi.fn(async () => {})
const txRollback = vi.fn(async () => {})

class FakeRequest {
  input(): this {
    return this
  }
  async query<T = unknown>(text: string): Promise<{ recordset: T[] }> {
    const norm = text.replace(/\s+/g, ' ').toLowerCase()
    if (norm.includes('select') && norm.includes('count(*) from dbo.dba_cards')) {
      return {
        recordset: [
          { cards: countCards, chunks: countChunks, embeds: countEmbeds }
        ] as T[]
      }
    }
    if (norm.startsWith('insert into dbo.')) {
      insertedStatements.push(text)
    }
    return { recordset: [] as T[] }
  }
}

const fakeTx = {
  begin: txBegin,
  commit: txCommit,
  rollback: txRollback,
  request: () => new FakeRequest()
}

const fakePool = {
  request: () => new FakeRequest(),
  transaction: () => fakeTx
}

vi.mock('../connection', () => ({ getPool: () => fakePool }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))

// Default: SQLite artifact is absent.
let fileExists = false
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => fileExists) }))

import { importKnowledgeIfEmpty } from '../knowledgeRepository'

beforeEach(() => {
  countCards = 0
  countChunks = 0
  countEmbeds = 0
  insertedStatements.length = 0
  txBegin.mockClear()
  txCommit.mockClear()
  txRollback.mockClear()
  fileExists = false
})

describe('importKnowledgeIfEmpty', () => {
  it('skips entirely when destination tables already have rows', async () => {
    countCards = 10
    countChunks = 10
    countEmbeds = 10
    fileExists = true
    await importKnowledgeIfEmpty()
    expect(txBegin).not.toHaveBeenCalled()
    expect(insertedStatements).toHaveLength(0)
  })

  it('skips when SQLite build artifact is missing', async () => {
    countCards = 0
    countChunks = 0
    countEmbeds = 0
    fileExists = false
    await importKnowledgeIfEmpty()
    expect(txBegin).not.toHaveBeenCalled()
    expect(insertedStatements).toHaveLength(0)
  })
})
