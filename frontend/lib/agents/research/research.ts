import 'server-only'
import { z } from 'zod'
import type { MarketSpec } from '@/lib/engine/markets'
import type { AgentRun, AgentSpec } from '../types'
import type { DecisionEvent } from '../pipeline'
import type { ModelCaller } from '../model'
import { runReactAgent, type ReactDeps } from '../react-loop'
import { RESEARCH_LIMITS } from '../budgets'
import { RESEARCH_TOOLS, clock, researchTools } from './tools'
import { groundingSources, ungroundedNumbers } from './grounding'

// ============================================================================
// Research agent (2.3, ADR-001): a ReAct loop that gathers FACTUAL market context
// for one decision Monitor flagged. It does not judge the user; Coach does.
// Written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

/**
 * Provisional until 2.7. qwen (ADR-008): it makes parallel tool calls (fewer round trips),
 * had the only ok live run, and gpt-oss failed forced submits. Coach uses gpt-oss, so the
 * two agents draw on separate per-model rate limits.
 */
export const RESEARCH_MODEL = 'qwen/qwen3.8-27b'

export interface ResearchInput {
  event: DecisionEvent
  /** e.g. "Covid Day Zero: 9 March 2020, NSE (India)" */
  scenarioLabel: string
  /** the scenario's market, for local clock times (M4); absent = NSE */
  market?: MarketSpec
}

const TOOL_NAMES = RESEARCH_TOOLS.map(t => t.name) as [string, ...string[]]

export const ResearchFindings = z.object({
  summary: z.string().min(1).max(600).describe('2-4 sentences of factual market context for the decision. No advice, no judgement of the user.'),
  evidence: z.array(z.object({
    fact: z.string().min(1).max(200).describe('One fact, with numbers copied exactly from a tool result'),
    tool: z.enum(TOOL_NAMES).describe('The tool the fact came from'),
  })).min(1).max(5),
})
export type ResearchFindings = z.infer<typeof ResearchFindings>

export function describeEvent({ event, scenarioLabel, market }: ResearchInput): string {
  const facts = Object.entries(event.facts).map(([k, v]) => `- ${k}: ${v}`).join('\n')
  return [
    `Scenario: ${scenarioLabel}. It is now ${clock(event.simMinute, market)} ${market?.tz ?? 'IST'} (session minute ${event.simMinute}).`,
    `Decision flagged by the monitor: ${event.kind}${event.symbol ? ` on ${event.symbol}` : ''}.`,
    `What happened: ${event.summary}`,
    `Facts:\n${facts}`,
  ].join('\n')
}

/** M6.1: reject a submission containing numbers that no tool returned. */
export function checkGrounding(out: ResearchFindings, steps: Parameters<NonNullable<AgentSpec<ResearchInput, ResearchFindings>['check']>>[1], input: ResearchInput): string | null {
  const claims = [out.summary, ...out.evidence.map(e => e.fact)].join(' ')
  const bad = ungroundedNumbers(claims, groundingSources(steps, describeEvent(input)))
  if (bad.length === 0) return null
  return `These numbers appear in no tool result: ${bad.join(', ')}. Use only numbers returned by the tools (rounding is fine), or call a tool to get the number, then submit again.`
}

/** `symbols`: the scenario's symbols, offered to the model as an enum (empty → free text). */
export function researchSpec(model = RESEARCH_MODEL, symbols: readonly string[] = []): AgentSpec<ResearchInput, ResearchFindings> {
  return {
    name: 'research',
    kind: 'react',
    model,
    systemPrompt: [
      'You are the Research agent in a trading simulator that replays a historical market day.',
      'A user just made a trading decision. Gather the market context around it with the tools, then call submit_findings.',
      'Rules:',
      '- Every number you write must come from a tool result. Your submission is checked, and invented numbers are rejected.',
      '- The tools only show the market up to now. You cannot know what happens later; never speculate about it.',
      '- State facts only. Do not judge the decision or give advice: another agent does that.',
      '- Use at most 3 tool calls, then submit.',   // a "one turn of parallel calls" variant was measured worse (5/12 vs 9/12, 2026-10-03): kept this
    ].join('\n'),
    buildUserMessage: describeEvent,
    tools: researchTools(symbols),
    output: ResearchFindings,
    limits: RESEARCH_LIMITS,
    check: checkGrounding,
  }
}

export function runResearch(
  input: ResearchInput,
  deps: { model: ModelCaller; ctx: ReactDeps['ctx']; newRunId?: () => string; modelId?: string },
): Promise<AgentRun<ResearchFindings>> {
  return runReactAgent(researchSpec(deps.modelId, Object.keys(deps.ctx.scenario.timeline)), input, deps)
}
