import 'server-only'
import type { AgentRun, SessionSnapshot } from './types'

// ============================================================================
// Orchestrator (roadmap 1.4): Monitor → Research → Coach for ONE decision event.
// Decisions agreed 2026-09-23 (see LEARNINGS 1.4); pipeline.test.ts checks each.
// Implementation written by Claude at Bhavya's request.
//
// Plain TypeScript, no LLM. The agents are injected (`PipelineDeps`), so the
// control flow is tested with fakes. Never throws: every outcome is a PipelineRun.
//
// Fallback ladder [decision 2]:
//   research ok  + coach ok  → 'full'
//   research bad + coach ok  → 'monitor_only'  (coach saw Monitor's facts only)
//   coach bad (either case)  → 'template'      (deterministic message from the event)
//   event not reproduced     → 'rejected'      (no tokens spent) [decision 1]
// ============================================================================

/** What Monitor (2.1) emits: deterministic facts about one user decision. */
export interface DecisionEvent {
  /** Monitor's taxonomy, e.g. 'panic_sell' (defined in 2.1) */
  kind: string
  simMinute: number
  symbol?: string
  /** facts Monitor computed from state; the only facts Coach gets if Research fails */
  facts: Record<string, string | number | boolean>
  /** one plain sentence; the template fallback is built from it */
  summary: string
}

export interface CoachInput<Findings> {
  event: DecisionEvent
  /** null when Research failed: Coach must work from Monitor's facts alone */
  findings: Findings | null
}

/**
 * `MonitorInput` is whatever Monitor needs to re-detect the event. Since 2.1
 * that's the session's journal (lib/monitor: monitorSession), because events like
 * panic_sell depend on what came before, not one state. Defaults to the M1 snapshot.
 */
export interface PipelineDeps<Findings, Feedback, MonitorInput = SessionSnapshot> {
  /** Monitor's pure rules, re-run on the server's copy of state [decision 1] */
  detect: (input: MonitorInput) => DecisionEvent[]
  research: (event: DecisionEvent, opts: { timeoutMs: number }) => Promise<AgentRun<Findings>>
  coach: (input: CoachInput<Findings>, opts: { timeoutMs: number }) => Promise<AgentRun<Feedback>>
  /** deterministic last resort; must not fail */
  template: (event: DecisionEvent) => Feedback
  newId?: () => string
}

export interface PipelineBudget {
  /** wall-clock limit for the whole pipeline [decision 3] */
  deadlineMs: number
  /** time held back for Coach: Research is cut off early to leave this much */
  coachReserveMs: number
}

/** Runtime list (the database CHECK constraint is tested against it). */
export const PIPELINE_PATHS = ['full', 'monitor_only', 'template', 'rejected'] as const
export type PipelinePath = (typeof PIPELINE_PATHS)[number]

export interface PipelineRun<Findings, Feedback> {
  pipelineId: string
  /** the SERVER-detected event (trusted), not the one the client claimed */
  event: DecisionEvent | null
  path: PipelinePath
  /** what the user sees; null only when rejected */
  feedback: Feedback | null
  research: AgentRun<Findings> | null
  coach: AgentRun<Feedback> | null
  /** anything that went wrong outside the agents' own runs (thrown errors, cut-offs) */
  notes: string[]
  timings: { researchMs: number; coachMs: number; totalMs: number }
}

/** Matches a claimed event against the server's own detection: same kind, minute and symbol. */
function sameEvent(a: DecisionEvent, b: DecisionEvent): boolean {
  return a.kind === b.kind && a.simMinute === b.simMinute && a.symbol === b.symbol
}

const CUT_OFF = Symbol('cut off')

/** Races a runner against a deadline, so a runner that ignores its timeout can't stall the pipeline. */
async function within<T>(ms: number, work: () => Promise<T>): Promise<T | typeof CUT_OFF> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cutOff = new Promise<typeof CUT_OFF>(resolve => { timer = setTimeout(() => resolve(CUT_OFF), Math.max(0, ms)) })
  try {
    return await Promise.race([work(), cutOff])
  } finally {
    clearTimeout(timer)
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function runPipeline<Findings, Feedback, MonitorInput = SessionSnapshot>(
  claimed: DecisionEvent,
  monitorInput: MonitorInput,
  deps: PipelineDeps<Findings, Feedback, MonitorInput>,
  budget: PipelineBudget,
): Promise<PipelineRun<Findings, Feedback>> {
  const started = Date.now()
  const elapsed = () => Date.now() - started
  const notes: string[] = []
  const result = (
    event: DecisionEvent | null, path: PipelinePath, feedback: Feedback | null,
    research: AgentRun<Findings> | null, coach: AgentRun<Feedback> | null,
    researchMs: number, coachMs: number,
  ): PipelineRun<Findings, Feedback> => ({
    pipelineId: deps.newId?.() ?? crypto.randomUUID(),
    event, path, feedback, research, coach, notes,
    timings: { researchMs, coachMs, totalMs: elapsed() },
  })

  // ── Monitor: re-detect on the server before spending tokens [decision 1] ──
  let event: DecisionEvent | undefined
  try {
    event = deps.detect(monitorInput).find(e => sameEvent(e, claimed))
  } catch (err) {
    notes.push(`detect threw: ${message(err)}`)
  }
  if (!event) {
    notes.push(`claimed event ${claimed.kind}@${claimed.simMinute} not reproduced by Monitor`)
    return result(null, 'rejected', null, null, null, 0, 0)
  }
  const trusted = event

  // ── Research, cut off early enough to leave Coach its reserve [decision 3] ──
  const researchStart = elapsed()
  const researchBudget = budget.deadlineMs - budget.coachReserveMs - researchStart
  let research: AgentRun<Findings> | null = null
  try {
    const r = await within(researchBudget, () => deps.research(trusted, { timeoutMs: researchBudget }))
    if (r === CUT_OFF) notes.push(`research cut off after ${researchBudget}ms`)
    else research = r
  } catch (err) {
    notes.push(`research threw: ${message(err)}`)
  }
  const researchMs = elapsed() - researchStart
  const findings = research?.status === 'ok' ? research.output : null

  // ── Coach, with whatever time is left ──
  const coachStart = elapsed()
  const coachBudget = budget.deadlineMs - coachStart
  let coach: AgentRun<Feedback> | null = null
  try {
    const r = await within(coachBudget, () => deps.coach({ event: trusted, findings }, { timeoutMs: coachBudget }))
    if (r === CUT_OFF) notes.push(`coach cut off after ${coachBudget}ms`)
    else coach = r
  } catch (err) {
    notes.push(`coach threw: ${message(err)}`)
  }
  const coachMs = elapsed() - coachStart

  // ── Fallback ladder [decision 2] ──
  if (coach?.status === 'ok' && coach.output !== null) {
    return result(trusted, findings !== null ? 'full' : 'monitor_only', coach.output, research, coach, researchMs, coachMs)
  }
  return result(trusted, 'template', deps.template(trusted), research, coach, researchMs, coachMs)
}
