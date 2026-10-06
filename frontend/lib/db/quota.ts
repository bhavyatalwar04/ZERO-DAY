import 'server-only'

// 8.4 Per-user rate limits on the Groq-backed routes (ADR-012), enforced in the
// database by consume_quota() (migration 20261003090000) so they hold across
// serverless instances. Written by Claude at Bhavya's request (2026-10-03).

export const QUOTAS = {
  /** coach pipeline runs: each is up to ~8k tokens (Research + Coach) */
  pipeline: { max: 40, windowSeconds: 3600 },
  /** V1 ORUS routes (help chat, tutor, debrief, …) */
  'v1-ai': { max: 60, windowSeconds: 3600 },
} as const
export type QuotaBucket = keyof typeof QUOTAS

/** The slice of a Supabase client this needs: an RPC as the signed-in user. */
export interface RpcClient {
  rpc(fn: 'consume_quota', args: { p_bucket: string; p_max: number; p_window_seconds: number }): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * 'ok' | 'exceeded', or 'unavailable' when the check itself failed (e.g. the
 * migration isn't applied yet). Unavailable FAILS OPEN: a missing limiter must not
 * take the coach down; it is logged so it gets fixed.
 */
export async function consumeQuota(db: RpcClient, bucket: QuotaBucket): Promise<'ok' | 'exceeded' | 'unavailable'> {
  const q = QUOTAS[bucket]
  try {
    const { data, error } = await db.rpc('consume_quota', { p_bucket: bucket, p_max: q.max, p_window_seconds: q.windowSeconds })
    if (error) { console.warn(`[quota] ${bucket}: check unavailable (${error.message}); allowing`); return 'unavailable' }
    return data === true ? 'ok' : 'exceeded'
  } catch (e) {
    console.warn(`[quota] ${bucket}: check failed (${e instanceof Error ? e.message : e}); allowing`)
    return 'unavailable'
  }
}
