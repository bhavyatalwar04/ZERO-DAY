import { z } from 'zod'
import { runSingleShot } from '@/lib/agents/single-shot'
import { COACH_LIMITS } from '@/lib/agents/budgets'
import { COACH_MODEL } from '@/lib/agents/coach/coach'
import { clock } from '@/lib/agents/research/tools'
import { ungroundedNumbers } from '@/lib/agents/research/grounding'
import type { AgentRun, AgentSpec } from '@/lib/agents/types'
import type { ModelCaller } from '@/lib/agents/model'
import { EVENT_PRIORITY, MONITOR_THRESHOLDS as T } from '@/lib/monitor/thresholds'
import { COV20_DATASET, px } from '@/lib/monitor/test-helpers'
import { STOP_LOSS } from './rubric'
import type { EvalCase } from './cases'

// ============================================================================
// System C of the 2.7 eval (ADR-010): "one good prompt", the baseline that answers
// the examiner's question "why three agents?". ONE call to the Coach's model with
// all the raw information the pipeline's agents would see between them (the
// session's orders, positions, prices, headlines, index), the pattern
// definitions, and the same guardrails (grounding + no stop-loss check, one
// repair). It must detect the pattern AND coach in one go.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

const PATTERNS = [...EVENT_PRIORITY, 'none'] as const

export const BaselineOutput = z.object({
  pattern: z.enum(PATTERNS).describe('The behavioural pattern the LAST action shows, or "none"'),
  message: z.string().min(20).max(400).describe('2-3 sentences to the user, in the second person: name the pattern, why it matters, one thing to try instead. If pattern is "none", a one-line acknowledgement'),
  severity: z.enum(['info', 'caution', 'warning']),
  question: z.string().min(5).max(160).describe('One short reflective question for the user'),
})
export type BaselineOutput = z.infer<typeof BaselineOutput>

export const DEFINITIONS = [
  `panic_sell: selling a position that is at least ${T.underwaterPct * 100}% below its average cost while the stock is at least ${T.panicDayDropPct * 100}% below the previous close and lower than ${T.panicLookbackMin} minutes ago.`,
  `revenge_trade: a BUY within ${T.revengeWindowMin} minutes of a loss-making SELL, at least ${T.revengeSizeMultiple}x that sale's size.`,
  `averaging_down: buying more of a position that is at least ${T.underwaterPct * 100}% below its average cost.`,
  `news_reflex: an order within ${T.newsReflexWindowMin} minutes of a headline, without pausing in between.`,
  `oversized_position: a BUY worth more than ${T.oversizedPctOfEquity * 100}% of the account.`,
  `overtrading: ${T.overtradingOrders} or more orders within ${T.overtradingWindowMin} minutes.`,
  'If several apply, report the first in this list.',
].join('\n')

/** Everything the pipeline's agents see between them, as one prompt. Deterministic. */
export function baselineContext(c: EvalCase, scenarioLabel: string): string {
  const target = c.entries.at(-1)!
  const now = target.simMinute
  const a = target.action as Extract<typeof target.action, { type: 'PLACE_ORDER' }>
  const st = c.before
  const equity = st.cash + Object.values(st.positions).reduce((v, p) => v + Math.abs(p.qty) * px(p.symbol, now), 0)
  const orders = st.orders.map(o => `- ${clock(o.placedAtMin ?? 0)} ${o.side} ${o.quantity} ${o.symbol}: ${o.status}${o.filledPrice ? ` at ${o.filledPrice}` : ''}`)
  const positions = Object.values(st.positions).filter(p => p.qty !== 0).map(p => `- ${p.symbol}: ${p.qty} shares, average cost ${p.avgPrice}`)
  const symbols = [...new Set([a.order.symbol, ...st.orders.map(o => o.symbol)])]
  const market = symbols.map(s => {
    const prev = COV20_DATASET.timeline[s].prevClose
    return `- ${s}: price ${px(s, now)}, previous close ${prev}, price ${T.panicLookbackMin} minutes ago ${px(s, Math.max(0, now - T.panicLookbackMin))}`
  })
  const news = COV20_DATASET.news.filter(n => n.fireAt <= now && now - n.fireAt <= 30)
    .map(n => `- ${clock(n.fireAt)} "${n.headline}"`)
  const pauses = c.entries.filter(e => e.action.type === 'PAUSE').map(e => clock(e.simMinute))
  const nifty = c.truth.niftyDayChangePct
  return [
    `Scenario: ${scenarioLabel}. It is now ${clock(now)}.`,
    `The user's LAST action: ${a.order.side} ${a.order.quantity} ${a.order.symbol} (market order) at ${px(a.order.symbol, now)}.`,
    `Account before it: cash ${Math.round(st.cash * 100) / 100}, equity ${Math.round(equity * 100) / 100}.`,
    `Earlier orders this session:\n${orders.join('\n') || '- none'}`,
    `Positions before the last action:\n${positions.join('\n') || '- none'}`,
    `Prices now:\n${market.join('\n')}`,
    nifty !== null ? `NIFTY vs previous close: ${nifty}%.` : '',
    `Headlines in the last 30 minutes:\n${news.join('\n') || '- none'}`,
    `Times the user paused the clock: ${pauses.join(', ') || 'never'}.`,
  ].filter(Boolean).join('\n')
}

/** Everything C was given: numbers in its answer must appear here (its check and the rubric use the same). */
export function baselineSources(c: EvalCase, scenarioLabel: string): string {
  return `${DEFINITIONS}
${baselineContext(c, scenarioLabel)}`
}

export function baselineSpec(scenarioLabel: string, model = COACH_MODEL): AgentSpec<EvalCase, BaselineOutput> {
  return {
    name: 'coach',   // AgentName is the DB's list; this run is never persisted
    kind: 'single_shot',
    model,
    systemPrompt: [
      'You are the coach in a trading simulator that replays a historical market day for learners.',
      'Look at the user\'s LAST action in context and decide whether it shows one of these behavioural patterns:',
      DEFINITIONS,
      'Then give short, specific feedback.',
      'Rules:',
      '- Speak to the user directly ("you"). Be direct and kind.',
      '- Use ONLY the numbers given. Never predict what happens next.',
      '- Suggest one thing the user can do in this simulator: pause before acting, size smaller, wait a few minutes, use a limit order, or write down a reason first.',
      '- Never suggest a stop-loss or stop order: they do not work in this simulator.',
    ].join('\n'),
    buildUserMessage: c => baselineContext(c, scenarioLabel),
    tools: [],
    output: BaselineOutput,
    limits: COACH_LIMITS,
    reasoningEffort: 'low',   // same setting as the Coach
    // The same guardrails the Coach has: grounded numbers, no stop-loss advice, one repair.
    check: (out, _steps, c) => {
      const text = `${out.message} ${out.question}`
      const problems: string[] = []
      if (STOP_LOSS.test(text)) problems.push('Do not mention stop-losses or stop orders.')
      // The definitions (system prompt) are given facts too: "5 orders", "2%" may be quoted.
      const bad = ungroundedNumbers(text, baselineSources(c, scenarioLabel))
      if (bad.length) problems.push(`These numbers are not in the facts you were given: ${bad.join(', ')}.`)
      return problems.length ? problems.join(' ') : null
    },
  }
}

export function runBaseline(c: EvalCase, scenarioLabel: string, model: ModelCaller): Promise<AgentRun<BaselineOutput>> {
  return runSingleShot(baselineSpec(scenarioLabel), c, { model })
}
