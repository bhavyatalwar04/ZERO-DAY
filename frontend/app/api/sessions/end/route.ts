import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/db/admin'
import { completeSession, type SessionsDb } from '@/lib/db/sessions'
import { handleEndSession } from '@/lib/session/end-session'
import { SCENARIOS } from '@/lib/engine/scenarios'
import type { Action } from '@/lib/engine/live-reducer'
import type { JournalEntry } from '@/lib/session/journal'
import { scorecard } from '@/lib/scoring/scorecard'
import { STUDY_MODE, studyCondition } from '@/lib/study/condition'

// Marks a live session completed once its action log is fully synced (3.3, ADR-005),
// and stores its scorecard (5.3/5.4) computed by replay of the stored log.
// Not covered by proxy.ts (API routes answer 401 themselves).
export async function POST(req: Request) {
  const supabase = await createClient()   // the user's own client: RLS limits reads to their sessions
  return handleEndSession(req, {
    async userId() {
      const { data } = await supabase.auth.getUser()
      return data.user?.id ?? null
    },
    async complete(userId, sessionId) {
      return completeSession(createAdminClient() as unknown as SessionsDb, userId, sessionId, new Date(), await scoreSession(sessionId, userId))
    },
  })

  /** The scorecard, or undefined if it can't be computed. Never blocks ending the session. */
  async function scoreSession(sessionId: string, userId: string): Promise<unknown> {
    try {
      const { data: s } = await supabase.from('sessions').select('scenario_id').eq('id', sessionId).maybeSingle()
      const scenario = s ? SCENARIOS[(s as { scenario_id: string }).scenario_id] : undefined
      if (!scenario) return undefined
      const { data, error } = await supabase.from('session_actions').select('seq, sim_minute, action').eq('session_id', sessionId).order('seq')
      if (error || !data?.length) return undefined
      const entries = (data as { seq: number; sim_minute: number; action: Action }[])
        .map((r): JournalEntry<Action> => ({ seq: r.seq, simMinute: r.sim_minute, action: r.action }))
      return scorecard(entries, scenario.dataset, STUDY_MODE ? { condition: studyCondition(userId) } : {})
    } catch (e) {
      console.error('[sessions/end] scorecard failed:', e instanceof Error ? e.message : e)
      return undefined
    }
  }
}
