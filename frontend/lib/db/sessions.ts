import 'server-only'
import type { CompleteResult } from '@/lib/session/end-session'

// Server-side session writes (3.3). The service-role client bypasses RLS, so the
// ownership check here IS the access control: every filter matters.
// Written by Claude at Bhavya's request (2026-10-02).

/** The slice of the Supabase query builder this uses (so tests can pass a fake). */
export interface SessionsDb {
  from(table: 'sessions'): {
    update(values: { status: 'completed'; ended_at: string; result?: unknown }): {
      eq(col: string, v: string): {
        eq(col: string, v: string): {
          eq(col: string, v: string): {
            select(cols: 'id'): PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>
          }
        }
      }
    }
  }
}

/** `result`: the session's scorecard (5.3), computed by the server by replay; omitted if it couldn't be. */
export async function completeSession(db: SessionsDb, userId: string, sessionId: string, now = new Date(), result?: unknown): Promise<CompleteResult> {
  const { data, error } = await db.from('sessions')
    .update({ status: 'completed', ended_at: now.toISOString(), ...(result !== undefined ? { result } : {}) })
    .eq('id', sessionId)
    .eq('user_id', userId)      // owner only
    .eq('status', 'active')     // ending twice, or ending an abandoned session, is a no-op
    .select('id')
  if (error) return { error: error.message }
  return data && data.length > 0 ? 'completed' : 'not_found'
}
