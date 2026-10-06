import 'server-only'
import { ModelCallError, type ModelCaller } from './model'
import { backoffDelay, type RetryPolicy } from './backoff'

export { backoffDelay, type RetryPolicy }

// ============================================================================
// Retry with exponential backoff + full jitter (roadmap 1.6).
// A decorator: wraps any ModelCaller and returns a ModelCaller, so the
// transport stays "one call" and the runners don't know retries exist.
// Written by Claude at Bhavya's request (2026-09-23).
// ============================================================================

// maxRetryAfterMs 4000: Research's whole budget is 9 s (budgets.ts), so a longer wait can't pay off.
export const DEFAULT_RETRY: RetryPolicy = { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 2000, maxRetryAfterMs: 4000 }

/** Only failures that waiting can fix. A 400/404, a malformed tool call or an abort will fail the same way again. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ModelCallError)) return false
  switch (err.kind) {
    case 'network':
    case 'rate_limited':
      return true
    case 'http':
      return err.status === 408 || (err.status !== undefined && err.status >= 500)
    default:
      return false   // tool_use_failed (the loop nudges instead), aborted, bad_response
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ModelCallError('aborted', 'Aborted during retry backoff')); return }
    const onAbort = () => { clearTimeout(timer); reject(new ModelCallError('aborted', 'Aborted during retry backoff')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function withRetry(
  caller: ModelCaller,
  policy: RetryPolicy = DEFAULT_RETRY,
  hooks: {
    /** injectable for tests */
    random?: () => number
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
    /** e.g. to log retries into the audit trail */
    onRetry?: (info: { retry: number; delayMs: number; error: ModelCallError }) => void
  } = {},
): ModelCaller {
  const random = hooks.random ?? Math.random
  const wait = hooks.sleep ?? sleep
  return async req => {
    for (let retry = 0; ; retry++) {
      try {
        return await caller(req)
      } catch (err) {
        if (!isRetryable(err) || retry >= policy.maxRetries || req.signal.aborted) throw err
        // Honour the provider's "retry after": retrying sooner just burns another 429 (seen live, 2026-10-02).
        const hint = (err as ModelCallError).retryAfterMs
        if (hint !== undefined && policy.maxRetryAfterMs !== undefined && hint > policy.maxRetryAfterMs) throw err
        const delayMs = hint !== undefined && policy.maxRetryAfterMs !== undefined
          ? hint + backoffDelay(0, policy, random)   // small jitter on top, so parallel callers don't collide
          : backoffDelay(retry, policy, random)
        hooks.onRetry?.({ retry: retry + 1, delayMs, error: err as ModelCallError })
        await wait(delayMs, req.signal)
      }
    }
  }
}
