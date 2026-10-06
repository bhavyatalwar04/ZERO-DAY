import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/db/admin'
import { recordPipelineRun } from '@/lib/db/audit'
import { createGroqCaller, ModelCallError, type ModelCaller } from '@/lib/agents/model'
import { withRetry } from '@/lib/agents/retry'
import { consumeQuota, type RpcClient } from '@/lib/db/quota'
import { PIPELINE_BUDGET } from '@/lib/agents/budgets'
import { runResearch } from '@/lib/agents/research/research'
import { runCoach } from '@/lib/agents/coach/coach'
import { handlePipelineRequest } from '@/lib/agents/pipeline-request'
import type { JournalEntry } from '@/lib/session/journal'
import type { Action } from '@/lib/engine/live-reducer'

// Decision event → Research → Coach → feedback (see lib/agents/pipeline-request.ts).
// Not covered by proxy.ts: API routes answer 401 themselves.
export const maxDuration = 30

const groqKeys = () =>
  Object.keys(process.env).filter(k => /^GROQ_API_KEY_\d+$/.test(k)).sort().map(k => process.env[k]!).filter(Boolean)

export async function POST(req: Request) {
  const supabase = await createClient()   // the user's own client: reads are RLS-scoped to them
  const keys = groqKeys()
  // No key configured: the agents fail cleanly and the user still gets the template feedback.
  const model: ModelCaller = keys.length
    ? withRetry(createGroqCaller({ keys }))
    : async () => { throw new ModelCallError('http', 'No GROQ_API_KEY_* is configured on the server', 500) }

  return handlePipelineRequest(req, {
    async userId() {
      const { data } = await supabase.auth.getUser()
      return data.user?.id ?? null
    },
    async loadSession(sessionId) {
      const { data } = await supabase.from('sessions').select('scenario_id').eq('id', sessionId).maybeSingle()
      return data ? { scenarioId: (data as { scenario_id: string }).scenario_id } : null
    },
    async loadActions(sessionId, uptoSeq) {
      const { data, error } = await supabase.from('session_actions')
        .select('seq, sim_minute, action').eq('session_id', sessionId).lte('seq', uptoSeq).order('seq')
      if (error) return { error: error.message }
      return (data as { seq: number; sim_minute: number; action: Action }[])
        .map((r): JournalEntry<Action> => ({ seq: r.seq, simMinute: r.sim_minute, action: r.action }))
    },
    quota: () => consumeQuota(supabase as unknown as RpcClient, 'pipeline'),
    async pastSessions() {
      const { data } = await supabase.from('sessions').select('result').eq('status', 'completed').order('ended_at', { ascending: false }).limit(50)
      return (data ?? []) as { result: unknown }[]
    },
    research: (input, ctx) => runResearch(input, { model, ctx }),
    coach: input => runCoach(input, { model }),
    // The audit trail is server-written (ADR-003): service role, through the atomic RPC (3.6).
    record: async input => {
      try {
        return await recordPipelineRun(createAdminClient(), input)
      } catch (err) {
        // e.g. SUPABASE_SERVICE_ROLE_KEY missing: the user still gets their feedback.
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    },
    budget: PIPELINE_BUDGET,
  })
}
