import type { LiveSessionState, Order } from '@/types/live'
import type { Action } from '@/lib/engine/live-reducer'
import type { JournalEntry } from '@/lib/session/journal'
import type { ScenarioDataset } from '@/lib/agents/types'
import type { DecisionEvent } from '@/lib/agents/pipeline'
import type { MonitorEventKind } from './thresholds'

// What every Monitor rule sees (2.1). Rules are pure functions of this context:
// no clock, no randomness, no I/O. That's what lets the server re-run them and
// get the same answer as the browser (ADR-002).
// No 'server-only' here: Monitor runs on both sides. Imports from agent code are types only.

export interface MonitorEvent extends DecisionEvent {
  kind: MonitorEventKind
}

export interface RuleContext {
  seq: number
  /** The minute the order was placed at. */
  now: number
  /** The order this PLACE_ORDER created, as the engine recorded it (never REJECTED: rules don't see rejected orders). */
  order: Order
  /** State the reducer applied the action to: positions/cash BEFORE this order. */
  before: LiveSessionState
  after: LiveSessionState
  /** Journal entries before this one. */
  history: readonly JournalEntry<Action>[]
  scenario: ScenarioDataset
  /** Price of `symbol` at `minute` (default: now), exactly as the engine prices it. */
  price(symbol: string, minute?: number): number
  /** Previous session's close: the reference for the HUD's red/green % change. */
  prevClose(symbol: string): number
}

export type Rule = (ctx: RuleContext) => MonitorEvent | null

/**
 * The engine's pricing (close of the 5-minute bar covering the minute), read from
 * the scenario dataset instead of COV-20 constants. A test checks it matches the engine.
 */
export function priceAt(scenario: ScenarioDataset, symbol: string, minute: number): number {
  const tl = scenario.timeline[symbol]
  if (!tl) return 0
  const idx = Math.min(tl.bars.length - 1, Math.floor(Math.max(0, minute) / 5))
  return tl.bars[idx]?.close ?? tl.prevClose
}

/** Cash + market value of positions at `minute`. */
export function equityAt(state: LiveSessionState, price: (symbol: string, minute?: number) => number, minute: number): number {
  let value = state.cash
  for (const sym in state.positions) value += Math.abs(state.positions[sym].qty) * price(sym, minute)
  return value
}

export interface SellResult {
  orderId: string
  symbol: string
  filledAtMin: number
  qty: number
  notional: number
  /** Realised P&L of this SELL against the average cost at the time (the engine's method). */
  realised: number
}

/**
 * Realised P&L per filled SELL, rebuilt from the order list. Orders don't store
 * it, so this replays the engine's average-cost accounting over fills in the
 * order the engine applies them: by fill minute, then by position in the list.
 */
export function sellResults(orders: readonly Order[]): SellResult[] {
  const fills = orders
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.status === 'FILLED' && o.filledAtMin !== undefined && o.filledPrice !== undefined)
    .sort((a, b) => a.o.filledAtMin! - b.o.filledAtMin! || a.i - b.i)
  const book: Record<string, { qty: number; avg: number }> = {}
  const out: SellResult[] = []
  for (const { o } of fills) {
    const pos = book[o.symbol] ?? { qty: 0, avg: 0 }
    const px = o.filledPrice!
    if (o.side === 'BUY') {
      const qty = pos.qty + o.quantity
      book[o.symbol] = { qty, avg: pos.qty > 0 ? (pos.qty * pos.avg + o.quantity * px) / qty : px }
    } else {
      // The engine marks a SELL with no position as FILLED (AUDIT §1.4 #4): it closed nothing.
      const closeQty = Math.min(pos.qty, o.quantity)
      out.push({
        orderId: o.id, symbol: o.symbol, filledAtMin: o.filledAtMin!, qty: closeQty,
        notional: closeQty * px, realised: (px - pos.avg) * closeQty,
      })
      book[o.symbol] = { qty: pos.qty - closeQty, avg: pos.avg }
    }
  }
  return out
}

/** Rounds for facts and summaries: the Coach quotes these numbers verbatim. */
export const r2 = (n: number) => Math.round(n * 100) / 100
export const pct = (fraction: number) => r2(fraction * 100)
