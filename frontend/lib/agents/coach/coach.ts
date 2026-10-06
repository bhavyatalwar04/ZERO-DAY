import 'server-only'
import { z } from 'zod'
import type { MarketSpec } from '@/lib/engine/markets'
import { describeHistory, type CoachHistory } from './history'
import type { AgentRun, AgentSpec } from '../types'
import type { CoachInput, DecisionEvent } from '../pipeline'
import type { ModelCaller } from '../model'
import { runSingleShot } from '../single-shot'
import { COACH_LIMITS } from '../budgets'
import { ungroundedNumbers } from '../research/grounding'
import { clock } from '../research/tools'
import type { ResearchFindings } from '../research/research'
import { feedbackTemplate } from '@/lib/monitor/templates'

// ============================================================================
// Coach agent (2.5, ADR-001): one strict-JSON call that turns Monitor's event
// (and Research's findings, when Research succeeded) into short behavioural
// feedback. Content rules from the M1 live runs, ENFORCED by a check, not just asked for:
//   - no market facts the inputs don't contain (checked for numbers: every
//     number must come from the event or the findings);
//   - no stop-loss advice: stop-losses never execute in this engine (AUDIT §1.4 #1, P2).
// `coachTemplate` is the pipeline's deterministic last resort (ADR-002).
// Written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

/** Provisional until 2.7. Research runs on qwen, so the two agents use separate per-model limits (ADR-008). */
export const COACH_MODEL = 'openai/gpt-oss-20b'

export const CoachFeedback = z.object({
  message: z.string().min(20).max(400).describe('2-3 sentences to the user, in the second person: name the pattern, why it matters, one thing to try instead'),
  severity: z.enum(['info', 'caution', 'warning']).describe('info = worth knowing; caution = a costly habit; warning = a pattern that loses money fast'),
  question: z.string().min(5).max(160).describe('One short reflective question for the user'),
})
export type CoachFeedback = z.infer<typeof CoachFeedback>

export type CoachRunInput = CoachInput<ResearchFindings> & { scenarioLabel: string; market?: MarketSpec; history?: CoachHistory }

export function describeCoachInput({ event, findings, scenarioLabel, market, history }: CoachRunInput): string {
  const facts = Object.entries(event.facts).map(([k, v]) => `- ${k}: ${v}`).join('\n')
  const research = findings
    ? [`Market context (from the research agent):`, findings.summary, ...findings.evidence.map(e => `- ${e.fact}`)].join('\n')
    : 'Market context: unavailable. Work from the decision facts only.'
  return [
    `Scenario: ${scenarioLabel}. Time: ${clock(event.simMinute, market)} ${market?.tz ?? 'IST'}.`,
    `Pattern detected: ${event.kind}${event.symbol ? ` (${event.symbol})` : ''}.`,
    `What the user did: ${event.summary}`,
    `Decision facts:\n${facts}`,
    research,
    ...describeHistory(event.kind, history),
  ].join('\n')
}

const STOP_LOSS = /stop[\s-]?loss|\bSL\b|stop[\s-]?(?:order|price)|trailing stop/i

/** The content rules, enforced. Returns a message the model can act on, or null. */
export function checkCoach(out: CoachFeedback, _steps: unknown, input: CoachRunInput): string | null {
  const text = `${out.message} ${out.question}`
  const problems: string[] = []
  if (STOP_LOSS.test(text)) problems.push('Do not mention stop-losses or stop orders: they do not execute in this simulator. Suggest something the user can actually do (pause, size smaller, wait, use a limit order, write down a reason).')
  const bad = ungroundedNumbers(text, describeCoachInput(input))
  if (bad.length) problems.push(`These numbers are not in the facts you were given: ${bad.join(', ')}. Use only the numbers provided, or none.`)
  return problems.length ? problems.join(' ') : null
}

export function coachSpec(model = COACH_MODEL): AgentSpec<CoachRunInput, CoachFeedback> {
  return {
    name: 'coach',
    kind: 'single_shot',
    model,
    systemPrompt: [
      'You are the Coach in a trading simulator that replays a historical market day for learners.',
      'A monitor flagged one of the user\'s decisions as a behavioural pattern. Give short, specific feedback.',
      'Rules:',
      '- Speak to the user directly ("you"). Be direct and kind; no lectures, no jargon without a plain explanation.',
      '- Use ONLY the facts provided. Do not add market facts, prices or numbers of your own, and never predict what happens next.',
      '- Suggest one thing the user can do in this simulator: pause before acting, size smaller, wait a few minutes, use a limit order, or write down a reason first.',
      '- Never suggest a stop-loss or stop order: they do not work in this simulator.',
      '- If the input says the pattern was flagged before, say so plainly ("the third time today"): repetition is the point to coach.',
      '- End with one short reflective question in the "question" field.',
    ].join('\n'),
    buildUserMessage: describeCoachInput,
    tools: [],
    output: CoachFeedback,
    limits: COACH_LIMITS,
    check: checkCoach,
    reasoningEffort: 'low',
  }
}

export function runCoach(input: CoachRunInput, deps: { model: ModelCaller; newRunId?: () => string; modelId?: string }): Promise<AgentRun<CoachFeedback>> {
  return runSingleShot(coachSpec(deps.modelId), input, deps)
}

// ─── Deterministic fallback (the pipeline's 'template' path) ──
// Lives in lib/monitor/templates.ts so the browser can use it too.

/** Never fails: built from Monitor's own sentence, so it contains only Monitor's facts. */
export function coachTemplate(event: DecisionEvent): CoachFeedback {
  return feedbackTemplate(event)
}
