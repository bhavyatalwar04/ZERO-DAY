// Pure backoff maths, shared by the server-side agent retry (retry.ts) and the
// browser-side session sync (lib/session/sync.ts). No 'server-only' here on
// purpose: retry.ts is server-only because it wraps the Groq caller.

export interface RetryPolicy {
  /** retries AFTER the first attempt: 2 = up to 3 calls */
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  /**
   * When the provider says how long to wait (429 retry-after): wait that long if it is
   * at most this, otherwise give up at once (the caller's budget can't afford it).
   * Unset = ignore the provider's hint.
   */
  maxRetryAfterMs?: number
}

/** Full jitter: a random wait in [0, min(cap, base·2^n)], so many clients don't retry in lockstep. */
export function backoffDelay(retry: number, policy: RetryPolicy, random: () => number): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retry) * random()
}
