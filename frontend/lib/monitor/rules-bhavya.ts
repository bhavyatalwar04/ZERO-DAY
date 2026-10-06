import { MONITOR_THRESHOLDS as T } from './thresholds'
import { pct, r2, type Rule } from './context'

// ============================================================================
// Bhavya's rules (2.1): the two core behavioural-finance ideas.
// Spec: rules-bhavya.test.ts. Specs and thresholds decided by Bhavya (ADR-006);
// implementations written by Claude at Bhavya's request (2026-10-03).
//
// You have, in the context (see context.ts → RuleContext):
//   order   the order just placed (side, symbol, quantity, price?)
//   before  state BEFORE the order: before.positions[symbol] = { qty, avgPrice }
//   now     the minute it was placed
//   price(symbol, minute?)  the engine's price (default minute: now)
//   prevClose(symbol)       previous close: the HUD's % change is measured against it
// Thresholds: T.underwaterPct (0.02), T.panicDayDropPct (0.05), T.panicLookbackMin (15).
// Helpers: r2(n) rounds to 2 dp; pct(0.041) → 4.1.
// Return null when the rule doesn't apply, or an event:
//   { kind, simMinute: now, symbol, facts: { …numbers/strings/booleans }, summary: '<one plain sentence>' }
// ============================================================================

/**
 * panic_sell ("on-screen red", ADR-006): selling a losing position while the screen
 * shows the stock deep red on the day and still falling.
 * Fires when ALL of:
 *   - it's a SELL, and there is a position in `before` with qty > 0
 *   - price now ≤ avgPrice × (1 − T.underwaterPct)                  (selling at a loss)
 *   - price now ≤ prevClose × (1 − T.panicDayDropPct)               (≥5% red on the HUD)
 *   - price now < price T.panicLookbackMin minutes ago               (still falling; clamp that minute at 0)
 * Facts (the test checks these names): lossPct (how far below avg cost, in %),
 *   dayDropPct (how far below the previous close, in %), fallPct (the fall over the
 *   lookback, in %), lookbackMinutes, avgPrice, price.
 */
export const panicSell: Rule = ({ order, before, now, price, prevClose }) => {
  if (order.side !== 'SELL') return null
  const pos = before.positions[order.symbol]
  if (!pos || pos.qty <= 0) return null
  const p = price(order.symbol)
  const close = prevClose(order.symbol)
  const then = Math.max(0, now - T.panicLookbackMin)
  const pThen = price(order.symbol, then)
  const losing = p <= pos.avgPrice * (1 - T.underwaterPct)
  const red = p <= close * (1 - T.panicDayDropPct)
  const falling = p < pThen
  if (!losing || !red || !falling) return null
  const lossPct = pct(1 - p / pos.avgPrice)
  const dayDropPct = pct(1 - p / close)
  const fallPct = pct(1 - p / pThen)
  const lookback = now - then
  return {
    kind: 'panic_sell', simMinute: now, symbol: order.symbol,
    facts: { lossPct, dayDropPct, fallPct, lookbackMinutes: lookback, avgPrice: r2(pos.avgPrice), price: r2(p) },
    summary: `Sold ${order.symbol} at ${r2(p)}, ${lossPct}% below the average cost of ${r2(pos.avgPrice)}, while it was ${dayDropPct}% below the previous close and had fallen ${fallPct}% in the last ${lookback} minute${lookback === 1 ? '' : 's'}.`,
  }
}

/**
 * averaging_down: buying more of a position that is already underwater.
 * Fires when ALL of:
 *   - it's a BUY, and there is a position in `before` with qty > 0
 *   - price now ≤ avgPrice × (1 − T.underwaterPct)
 * Facts: lossPct, avgPrice, price, existingQty, addedQty.
 */
export const averagingDown: Rule = ({ order, before, now, price }) => {
  if (order.side !== 'BUY') return null
  const pos = before.positions[order.symbol]
  if (!pos || pos.qty <= 0) return null
  const p = price(order.symbol)
  if (p > pos.avgPrice * (1 - T.underwaterPct)) return null
  const lossPct = pct(1 - p / pos.avgPrice)
  return {
    kind: 'averaging_down', simMinute: now, symbol: order.symbol,
    facts: { lossPct, avgPrice: r2(pos.avgPrice), price: r2(p), existingQty: pos.qty, addedQty: order.quantity },
    summary: `Bought ${order.quantity} more ${order.symbol} at ${r2(p)} while the existing ${pos.qty} shares were ${lossPct}% below their average cost of ${r2(pos.avgPrice)}.`,
  }
}
