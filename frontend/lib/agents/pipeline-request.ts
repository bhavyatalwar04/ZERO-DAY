import 'server-only'
import { z } from 'zod'
import type { LiveSessionState } from '@/types/live'
import type { Action } from '@/lib/engine/live-reducer'
import { SCENARIOS } from '@/lib/engine/scenarios'
import type { JournalEntry } from '@/lib/session/journal'
import { replaySteps, ReplayError } from '@/lib/session/replay'
import { engineFor, monitorSession } from '@/lib/monitor/monitor'
import { runPipeline, type DecisionEvent, type PipelineBudget, type PipelineRun } from './pipeline'
import type { AgentRun, ToolContext } from './types'
import type { ResearchFindings, ResearchInput } from './research/research'
import { coachTemplate, type CoachFeedback, type CoachRunInput } from './coach/coach'
import { coachHistory } from './coach/history'
import type { AuditInput } from '@/lib/db/audit'

// ============================================================================
// POST /api/pipeline (2.x wiring, ADR-002/003/008): one decision event →
// feedback, with the server trusting only what it can rebuild itself:
//   1. who is asking (getUser), and that the session is theirs (RLS read);
//   2. the session's stored action log, replayed through the engine (P1: server replay);
//   3. Monitor re-run on that log: the claimed event must reappear, or the run is 'rejected'
//      before any tokens are spent;
//   4. Research → Coach → template ladder (runPipeline), then the audit write.
// Dependencies are injected, so this is tested without Next, Supabase or Groq.
// Written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

export const PipelineBody = z.object({
  sessionId: z.uuid(),
  actionSeq: z.number().int().min(0),
  claimed: z.object({
    kind: z.string().min(1).max(40),
    simMinute: z.number().int().min(0),
    symbol: z.string().max(20).optional(),
  }),
})

export interface PipelineRequestDeps {
  userId(): Promise<string | null>
  /** The session if it exists AND belongs to the caller (an RLS-scoped read), else null. */
  loadSession(sessionId: string): Promise<{ scenarioId: string } | null>
  /** Stored actions with seq ≤ uptoSeq, in order. */
  loadActions(sessionId: string, uptoSeq: number): Promise<JournalEntry<Action>[] | { error: string }>
  research(input: ResearchInput, ctx: Omit<ToolContext, 'signal'>): Promise<AgentRun<ResearchFindings>>
  coach(input: CoachRunInput): Promise<AgentRun<CoachFeedback>>
  record(input: AuditInput<ResearchFindings, CoachFeedback>): Promise<{ ok: true; id: string } | { ok: false; error: string }>
  /** The caller's past sessions (RLS-scoped), for the Coach's history (2.6). Optional: absent = no past history. */
  pastSessions?(): Promise<{ result: unknown }[]>
  /** 8.4 per-user rate limit (consume_quota). Optional: absent = unlimited (tests). */
  quota?(): Promise<'ok' | 'exceeded' | 'unavailable'>
  budget: PipelineBudget
  newId?: () => string
}

export interface PipelineResponse {
  pipelineId: string
  path: PipelineRun<ResearchFindings, CoachFeedback>['path']
  feedback: CoachFeedback | null
  event: Pick<DecisionEvent, 'kind' | 'simMinute' | 'symbol' | 'summary'> | null
  audited: boolean
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

export async function handlePipelineRequest(req: Request, deps: PipelineRequestDeps): Promise<Response> {
  const userId = await deps.userId()
  if (!userId) return json({ error: 'not signed in' }, 401)

  let raw: unknown
  try { raw = await req.json() } catch { raw = null }
  const body = PipelineBody.safeParse(raw)
  if (!body.success) return json({ error: 'invalid body' }, 400)
  const { sessionId, actionSeq, claimed } = body.data

  const session = await deps.loadSession(sessionId)
  if (!session) return json({ error: 'no such session' }, 404)
  const scenario = SCENARIOS[session.scenarioId]
  if (!scenario) return json({ error: `scenario ${session.scenarioId} is not supported yet` }, 400)

  const entries = await deps.loadActions(sessionId, actionSeq)
  if ('error' in entries) return json({ error: 'could not load the session log' }, 500)
  // The browser syncs asynchronously: the action may not be stored yet. It retries on 409.
  if (entries.length <= actionSeq) return json({ error: 'not_synced', stored: entries.length }, 409)

  // Server replay (P1): the state the user saw when deciding, rebuilt from the log alone.
  let stateBefore: LiveSessionState | undefined
  try {
    for (const step of replaySteps(engineFor(session.scenarioId), entries)) {
      if (step.entry.seq === actionSeq) stateBefore = step.before
    }
  } catch (err) {
    if (err instanceof ReplayError) return json({ error: `session log is inconsistent: ${err.message}` }, 422)
    throw err
  }

  const ctx: Omit<ToolContext, 'signal'> = {
    session: { source: 'server_replay', scenarioId: session.scenarioId, simMinute: claimed.simMinute, state: stateBefore! },
    scenario: scenario.dataset,
  }
  const claimedEvent: DecisionEvent = { ...claimed, facts: {}, summary: '' }

  // 8.4: the per-user limit, checked only now that the request is valid and about to spend tokens.
  if ((await deps.quota?.()) === 'exceeded') return json({ error: 'rate_limited' }, 429)

  const run = await runPipeline<ResearchFindings, CoachFeedback, readonly JournalEntry<Action>[]>(claimedEvent, entries, {
    // Only events triggered by THIS action count: an older event can't be replayed for fresh feedback.
    detect: log => monitorSession(log, scenario.dataset).filter(e => e.actionSeq === actionSeq),
    research: event => deps.research({ event, scenarioLabel: scenario.label, market: scenario.market }, ctx),
    coach: async ({ event, findings }) => deps.coach({
      event, findings, scenarioLabel: scenario.label, market: scenario.market,
      history: coachHistory(event.kind, actionSeq, monitorSession(entries, scenario.dataset), (await deps.pastSessions?.().catch(() => [])) ?? []),
    }),
    template: coachTemplate,
    newId: deps.newId,
  }, deps.budget)

  // The audit write never blocks feedback (ADR-003): failures are logged and reported as audited:false.
  const audit = await deps.record({ sessionId, actionSeq: run.path === 'rejected' ? null : actionSeq, stateBefore, run })
  if (!audit.ok) console.error('[pipeline] audit write failed:', audit.error)

  const response: PipelineResponse = {
    pipelineId: run.pipelineId,
    path: run.path,
    feedback: run.feedback,
    event: run.event && { kind: run.event.kind, simMinute: run.event.simMinute, symbol: run.event.symbol, summary: run.event.summary },
    audited: audit.ok,
  }
  return json(response)
}
