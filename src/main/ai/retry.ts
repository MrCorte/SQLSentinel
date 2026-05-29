import { createLogger } from '../utils/logger'

const log = createLogger('retry')

function isRetryable(err: unknown): boolean {
  // Prefer a structured HTTP status when the error carries one (Anthropic SDK,
  // node-fetch, etc.) — far more reliable than scanning the message text.
  const status =
    (err as { status?: unknown; statusCode?: unknown })?.status ??
    (err as { statusCode?: unknown })?.statusCode
  if (typeof status === 'number') {
    return status === 429 || (status >= 500 && status <= 599)
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (/econnrefused|econnreset|etimedout|epipe|enotfound/.test(msg)) return true
  // HTTP 429 rate-limit and 5xx server errors. Require an http/status qualifier
  // so we don't retry on incidental numbers (e.g. "returned 500 rows").
  if (/\b(status|code|http)\b\D{0,8}(429|5\d\d)\b/.test(msg)) return true
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
