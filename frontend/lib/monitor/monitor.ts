import type { LiveSessionState } from '@/types/live'
import { reducer, initialState, type Action } from '@/lib/engine/live-reducer'
import type { JournalEntry } from '@/lib/session/journal'
import { replaySteps } from '@/lib/session/replay'
import type { ScenarioDataset } from '@/lib/agents/types'
import { EVENT_PRIORITY, MONITOR_THRESHOLDS as T, type MonitorEventKind } from './thresholds'
import { priceAt, type MonitorEvent, type Rule, type RuleContext } from './context'
import { newsReflex, oversizedPosition, overtrading, revengeTrade } from './rules'
import { averagingDown, panicSell } from './rules-bhavya'

// ============================================================================
// Monitor (2.1, ADR-001): deterministic rules, no LLM. Judges each logged
// PLACE_ORDER in context and emits at most one DecisionEvent per action.
// The same code runs in the browser (to decide when to ask for feedback) and
// on the server (to re-check the claim before spending tokens, ADR-002).
// Framework written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

export const RULES: Record<MonitorEventKind, Rule> = {
  panic_sell: panicSell,
  revenge_trade: revengeTrade,
  averaging_down: averagingDown,
  news_reflex: newsReflex,
  oversized_position: oversizedPosition,
  overtrading,
}

export interface DetectedEvent extends MonitorEvent {
  /** The journal entry (session_actions.seq) that triggered it. */
  actionSeq: number
}

export interface MonitorStep {
  entry: JournalEntry<Action>
  before: LiveSessionState
  after: LiveSessionState
  history: readonly JournalEntry<Action>[]
}

/**
 * One action → at most one event. `earlier` = events already emitted this
 * session, for the cooldown. Only accepted orders are judged: a rejected order
 * changed nothing, and coaching it would mostly coach the engine's own checks.
 */
export function monitorStep(step: MonitorStep, scenario: ScenarioDataset, earlier: readonly DetectedEvent[]): DetectedEvent | null {
  const { entry, before, after, history } = step
  if (entry.action.type !== 'PLACE_ORDER') return null
  const order = after.orders[after.orders.length - 1]
  if (!order || after.orders.length !== before.orders.length + 1 || order.status === 'REJECTED') return null

  const ctx: RuleContext = {
    seq: entry.seq, now: entry.simMinute, order, before, after, history, scenario,
    price: (symbol, minute = entry.simMinute) => priceAt(scenario, symbol, minute),
    prevClose: symbol => scenario.timeline[symbol]?.prevClose ?? 0,
  }
  for (const kind of EVENT_PRIORITY) {
    const coolingDown = earlier.some(e => e.kind === kind && ctx.now - e.simMinute < T.cooldownMin)
    if (coolingDown) continue
    const event = RULES[kind](ctx)
    if (event) return { ...event, kind, actionSeq: entry.seq }
  }
  return null
}

/** The engine, starting from the given scenario (M4: replays must use the session's own prices). */
export const engineFor = (scenarioId: string) => ({ reducer, initialState: () => initialState(scenarioId), tick: { type: 'TICK' } as Action })

/**
 * Every event in a session, from its journal alone. The server's re-check
 * (ADR-002): replay the stored log, run Monitor over it, and look for the
 * claimed event. Deterministic, so browser and server agree.
 */
export function monitorSession(entries: readonly JournalEntry<Action>[], scenario: ScenarioDataset): DetectedEvent[] {
  const events: DetectedEvent[] = []
  for (const { entry, before, after } of replaySteps(engineFor(scenario.scenarioId), entries)) {
    const event = monitorStep({ entry, before, after, history: entries.slice(0, entry.seq) }, scenario, events)
    if (event) events.push(event)
  }
  return events
}
