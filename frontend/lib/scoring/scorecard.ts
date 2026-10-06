import type { LiveSessionState } from '@/types/live'
import type { ScenarioDataset } from '@/lib/agents/types'
import { reducer, initialState, getPriceAtMinute, sessionMinutesOf, type Action } from '@/lib/engine/live-reducer'
import { engineFor } from '@/lib/monitor/monitor'
import type { JournalEntry } from '@/lib/session/journal'
import { replay } from '@/lib/session/replay'
import { monitorSession } from '@/lib/monitor/monitor'
import { EVENT_PRIORITY, type MonitorEventKind } from '@/lib/monitor/thresholds'
import { financialMetrics, type FinancialMetrics } from './metrics'
import type { StudyCondition } from '@/lib/study/condition'

// ============================================================================
// 5.2 behavioural metrics, 5.5 baselines, 5.3 the end-of-scenario scorecard.
// Everything is computed from the session's journal by replay: the same source
// of truth as the audit trail (ADR-003). Stored in sessions.result at session
// end (5.4) so progression across sessions can be read back.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export const SCORECARD_VERSION = 1

export interface BehaviourMetrics {
  events: Record<MonitorEventKind, number>
  /** orders the engine accepted (Monitor only judges these) */
  acceptedOrders: number
  /** accepted orders that Monitor flagged (at most one event per order) */
  flaggedOrders: number
  /** flagged orders per 10 accepted orders; null with no orders */
  flaggedPer10: number | null
  /**
   * 0–100: share of accepted orders that showed none of the six patterns.
   * Deliberately simple and explainable; null with no orders (no decisions to judge).
   */
  disciplineScore: number | null
}

export interface BaselineResult { returnPct: number; maxDrawdownPct: number; sessionSharpe: number | null }

export interface Scorecard {
  version: number
  scenarioId: string
  /** did the session reach the closing bell (vs ended early)? */
  reachedClose: boolean
  lastMinute: number
  financial: FinancialMetrics
  behaviour: BehaviourMetrics
  baselines: { buyAndHold: BaselineResult; ruleBased: BaselineResult; cash: BaselineResult }
  /** user's return minus buy-and-hold's, in percentage points */
  vsBuyAndHoldPts: number
  /** 5.4 study group, when study mode was on (docs/STUDY.md) */
  condition?: StudyCondition
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function behaviourMetrics(entries: readonly JournalEntry<Action>[], state: LiveSessionState, scenario: ScenarioDataset): BehaviourMetrics {
  const found = monitorSession(entries, scenario)
  const events = Object.fromEntries(EVENT_PRIORITY.map(k => [k, found.filter(e => e.kind === k).length])) as Record<MonitorEventKind, number>
  const accepted = state.orders.filter(o => o.status !== 'REJECTED').length
  const flagged = found.length
  return {
    events,
    acceptedOrders: accepted,
    flaggedOrders: flagged,
    flaggedPer10: accepted ? r2((flagged / accepted) * 10) : null,
    disciplineScore: accepted ? Math.round(100 * (1 - flagged / accepted)) : null,
  }
}

// ─── 5.5 Baselines: strategies played through the SAME engine ───
// Same prices, same fills, same square-off at the bell: only the decisions differ.

function play(scenarioId: string, decide: (s: LiveSessionState) => Action[]): LiveSessionState {
  let s = reducer(initialState(scenarioId), { type: 'START' })
  while (s.status !== 'CLOSED') {
    for (const a of decide(s)) s = reducer(s, a)
    s = reducer(s, { type: 'TICK' })
  }
  return s
}

const market = (side: 'BUY' | 'SELL', symbol: string, quantity: number): Action =>
  ({ type: 'PLACE_ORDER', order: { symbol, side, type: 'MARKET', validity: 'DAY', quantity } })

function equalWeightBuys(s: LiveSessionState, symbols: string[], price: (sym: string) => number): Action[] {
  const each = s.cash / symbols.length
  return symbols.map(sym => market('BUY', sym, Math.floor((each * 0.99) / price(sym)))).filter(a => (a as { order: { quantity: number } }).order.quantity > 0)
}

const toBaseline = (s: LiveSessionState): BaselineResult => {
  const f = financialMetrics(s)
  return { returnPct: f.returnPct, maxDrawdownPct: f.maxDrawdownPct, sessionSharpe: f.sessionSharpe }
}

/** Buy every stock in equal weight at the first minute and hold to the bell. */
export function buyAndHold(scenario: ScenarioDataset): BaselineResult {
  const symbols = Object.keys(scenario.timeline)
  const price = (sym: string, minute: number) => getPriceAtMinute(sym, minute, scenario.scenarioId)
  let bought = false
  return toBaseline(play(scenario.scenarioId, s => {
    if (bought || s.currentMinute < 1) return []
    bought = true
    return equalWeightBuys(s, symbols, sym => price(sym, s.currentMinute))
  }))
}

/**
 * A naive rule-based trader: buy equal weight at the first minute, then sell any
 * holding as soon as it is `stopPct` below its average cost, and never re-buy. The
 * mechanical "cut losers" rule many textbooks teach: a yardstick for whether a
 * human's discretion beat a dumb rule.
 */
export function ruleBased(scenario: ScenarioDataset, stopPct = 0.03): BaselineResult {
  const symbols = Object.keys(scenario.timeline)
  const price = (sym: string, minute: number) => getPriceAtMinute(sym, minute, scenario.scenarioId)
  let bought = false
  return toBaseline(play(scenario.scenarioId, s => {
    if (s.currentMinute < 1) return []
    if (!bought) { bought = true; return equalWeightBuys(s, symbols, sym => price(sym, s.currentMinute)) }
    return Object.values(s.positions)
      .filter(p => p.qty > 0 && price(p.symbol, s.currentMinute) <= p.avgPrice * (1 - stopPct))
      .map(p => market('SELL', p.symbol, p.qty))
  }))
}

const baselineCache = new Map<string, Scorecard['baselines']>()

export function baselines(scenario: ScenarioDataset): Scorecard['baselines'] {
  const hit = baselineCache.get(scenario.scenarioId)
  if (hit) return hit
  const out = { buyAndHold: buyAndHold(scenario), ruleBased: ruleBased(scenario), cash: { returnPct: 0, maxDrawdownPct: 0, sessionSharpe: null } }
  baselineCache.set(scenario.scenarioId, out)
  return out
}

/** 5.3: the whole scorecard for one session, from its journal. Throws ReplayError on an inconsistent log. */
export function scorecard(entries: readonly JournalEntry<Action>[], scenario: ScenarioDataset, meta: { condition?: StudyCondition } = {}): Scorecard {
  // TICKs aren't logged (ADR-005), so replay stops at the last action. A session that
  // ran to the bell (no END action) is ticked forward to the close; a paused clock
  // stops the ticking quietly and the session counts as ended where it stopped.
  const endedEarly = entries.at(-1)?.action.type === 'END'
  const sessionEnd = sessionMinutesOf(scenario.scenarioId)
  const state = replay(engineFor(scenario.scenarioId), entries, endedEarly ? {} : { untilMinute: sessionEnd })
  const financial = financialMetrics(state)
  const base = baselines(scenario)
  return {
    version: SCORECARD_VERSION,
    scenarioId: scenario.scenarioId,
    reachedClose: state.currentMinute >= sessionEnd,
    lastMinute: state.currentMinute,
    financial,
    behaviour: behaviourMetrics(entries, state, scenario),
    baselines: base,
    vsBuyAndHoldPts: r2(financial.returnPct - base.buyAndHold.returnPct),
    ...(meta.condition ? { condition: meta.condition } : {}),
  }
}
