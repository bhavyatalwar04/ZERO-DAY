import type { LiveSessionState, Order } from '@/types/live'
import { STARTING_CASH } from '@/lib/engine/live-reducer'
import { sellResults } from '@/lib/monitor/context'

// ============================================================================
// 5.1 Financial metrics for one session, from its final (replayed) state.
// Pure; the server computes them by replay at session end (5.4), so a client
// can't send flattering numbers. Each metric is explained where it's computed.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export interface FinancialMetrics {
  startEquity: number
  finalEquity: number
  returnPct: number
  /** worst peak-to-trough fall of equity during the session, % of the peak (≥ 0) */
  maxDrawdownPct: number
  /** mean/std of per-minute equity returns × √(minutes); null if equity never moved. NOT annualised. */
  sessionSharpe: number | null
  /** closed round trips (FIFO lots) */
  roundTrips: number
  /** share of sells with positive realised P&L, %; null with no sells */
  winRatePct: number | null
  /** quantity-weighted minutes from buy fill to sell fill; null with no closed lots */
  avgHoldMinutes: number | null
  ordersPlaced: number
  ordersFilled: number
  ordersRejected: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Max drawdown: walk the equity curve keeping the running peak; at each point the
 * drawdown is (peak − equity) / peak. The answer is the largest one. It measures the
 * worst loss a trader sat through, which a final return hides (a session can end
 * flat after being 15% down).
 */
export function maxDrawdownPct(equity: readonly number[]): number {
  let peak = -Infinity
  let worst = 0
  for (const e of equity) {
    peak = Math.max(peak, e)
    if (peak > 0) worst = Math.max(worst, (peak - e) / peak)
  }
  return r2(worst * 100)
}

/**
 * Sharpe ratio (Sharpe 1966/1994) = mean excess return / standard deviation of returns:
 * return per unit of risk. Here, per-minute returns r_t = E_t / E_{t−1} − 1 over one
 * session, risk-free rate taken as 0 for a single day, scaled by √n so it doesn't depend
 * on the bar size. It is a SESSION Sharpe: comparable between sessions of the same
 * scenario, not to the annualised Sharpe ratios funds report. Sample standard deviation.
 */
export function sessionSharpe(equity: readonly number[]): number | null {
  const rets: number[] = []
  for (let i = 1; i < equity.length; i++) if (equity[i - 1] > 0) rets.push(equity[i] / equity[i - 1] - 1)
  if (rets.length < 2) return null
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)
  const sd = Math.sqrt(variance)
  if (sd < 1e-12) return null   // flat equity (no position): Sharpe is undefined, not 0
  return r2((mean / sd) * Math.sqrt(rets.length))
}

/**
 * Hold time by FIFO lots: each SELL closes the oldest open BUY quantity first. The
 * engine itself keeps an average-cost position (no lots), so this is a reporting
 * convention, the standard one for "how long did you hold".
 */
export function holdTimes(orders: readonly Order[]): { minutes: number; qty: number }[] {
  const fills = orders.filter(o => o.status === 'FILLED' && o.filledAtMin !== undefined)
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.filledAtMin! - b.o.filledAtMin! || a.i - b.i)
    .map(x => x.o)
  const lots: Record<string, { at: number; qty: number }[]> = {}
  const out: { minutes: number; qty: number }[] = []
  for (const o of fills) {
    const book = (lots[o.symbol] ??= [])
    if (o.side === 'BUY') { book.push({ at: o.filledAtMin!, qty: o.quantity }); continue }
    let left = o.quantity
    while (left > 0 && book.length) {
      const lot = book[0]
      const q = Math.min(left, lot.qty)
      out.push({ minutes: o.filledAtMin! - lot.at, qty: q })
      lot.qty -= q
      left -= q
      if (lot.qty === 0) book.shift()
    }
  }
  return out
}

export function financialMetrics(state: LiveSessionState): FinancialMetrics {
  const curve = state.equityCurve.map(p => p.equity)
  const equity = [STARTING_CASH, ...curve]
  const finalEquity = equity[equity.length - 1]
  const sells = sellResults(state.orders)
  const holds = holdTimes(state.orders)
  const heldQty = holds.reduce((n, h) => n + h.qty, 0)
  return {
    startEquity: STARTING_CASH,
    finalEquity: r2(finalEquity),
    returnPct: r2((finalEquity / STARTING_CASH - 1) * 100),
    maxDrawdownPct: maxDrawdownPct(equity),
    sessionSharpe: sessionSharpe(equity),
    roundTrips: sells.length,
    winRatePct: sells.length ? r2((sells.filter(s => s.realised > 0).length / sells.length) * 100) : null,
    avgHoldMinutes: heldQty ? r2(holds.reduce((n, h) => n + h.minutes * h.qty, 0) / heldQty) : null,
    ordersPlaced: state.orders.length,
    ordersFilled: state.orders.filter(o => o.status === 'FILLED').length,
    ordersRejected: state.orders.filter(o => o.status === 'REJECTED').length,
  }
}
