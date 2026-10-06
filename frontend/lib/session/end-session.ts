import { z } from 'zod'

// POST /api/sessions/end (3.3, ADR-005). Users can't update `sessions` (RLS:
// ending a session is server-only, ADR-003), so this route does it for them
// with the service role, after checking who is asking. Only the owner can end
// a session, and only an active one. The result column stays null until 5.x.
// The handler takes its dependencies as arguments so it's testable without Next or Supabase.
// Written by Claude at Bhavya's request (2026-10-02).

export const EndSessionBody = z.object({ sessionId: z.uuid() })

export type CompleteResult = 'completed' | 'not_found' | { error: string }

export interface EndSessionDeps {
  /** The verified signed-in user (supabase.auth.getUser()), or null. */
  userId(): Promise<string | null>
  /** Mark the session completed iff it belongs to userId and is active. */
  complete(userId: string, sessionId: string): Promise<CompleteResult>
}

export async function handleEndSession(req: Request, deps: EndSessionDeps): Promise<Response> {
  const userId = await deps.userId()
  if (!userId) return Response.json({ error: 'not signed in' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { body = null }
  const parsed = EndSessionBody.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'body must be {"sessionId": "<uuid>"}' }, { status: 400 })

  const result = await deps.complete(userId, parsed.data.sessionId)
  if (result === 'completed') return Response.json({ ok: true })
  // Someone else's session and an unknown id look the same: don't reveal which ids exist.
  if (result === 'not_found') return Response.json({ error: 'no active session with that id' }, { status: 404 })
  console.error('[sessions/end]', result.error)
  return Response.json({ error: 'could not end session' }, { status: 500 })
}
