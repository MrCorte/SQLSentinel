import { createLogger } from '../utils/logger'

const log = createLogger('retry')

function isRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (/econnrefused|econnreset|etimedout|epipe|enotfound/.test(msg)) return true
  // HTTP 429 rate-limit and 5xx server errors
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1_000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isRetryable(err) || attempt === maxAttempts) throw err
      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      log.warn(
        `attempt ${attempt}/${maxAttempts} failed: ${err instanceof Error ? err.message : String(err)} — retrying in ${delay}ms`
      )
      await sleep(delay)
    }
  }
  // TypeScript flow analysis — unreachable at runtime
  throw new Error('withRetry: unreachable')
}
