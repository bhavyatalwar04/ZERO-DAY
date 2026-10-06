import { MONITOR_THRESHOLDS as T } from './thresholds'
import { equityAt, pct, r2, sellResults, type Rule } from './context'

// Monitor rules written by Claude at Bhavya's request (2026-10-02).
// panic_sell and averaging_down are Bhavya's: see rules-bhavya.ts.
// Each rule: one PLACE_ORDER in context → one event or null.

/** A BUY soon after a loss-making SELL, noticeably bigger than it: trying to win the loss back. */
export const revengeTrade: Rule = ({ order, before, now, price }) => {
  if (order.side !== 'BUY') return null
  const lastLoss = sellResults(before.orders)
    .filter(s => s.realised < 0 && now - s.filledAtMin <= T.revengeWindowMin)
    .at(-1)
  if (!lastLoss || lastLoss.notional <= 0) return null
  const notional = order.quantity * (order.price ?? price(order.symbol))
  const multiple = notional / lastLoss.notional
  if (multiple < T.revengeSizeMultiple) return null
  const minutesAfter = now - lastLoss.filledAtMin
  return {
    kind: 'revenge_trade', simMinute: now, symbol: order.symbol,
    facts: {
      buyNotional: r2(notional), previousLoss: r2(-lastLoss.realised), previousSymbol: lastLoss.symbol,
      minutesAfterLoss: minutesAfter, sizeMultiple: r2(multiple),
    },
    summary: `Bought ${order.quantity} ${order.symbol} worth ${r2(notional)}, ${r2(multiple)}× the size of the ${lastLoss.symbol} sale that lost ${r2(-lastLoss.realised)} ${minutesAfter} minute${minutesAfter === 1 ? '' : 's'} earlier.`,
  }
}

/** An order right after a headline, without pausing in between: reacting, not analysing. */
export const newsReflex: Rule = ({ order, now, history, scenario }) => {
  // The latest headline in the window (don't assume the news list is sorted).
  const headline = scenario.news
    .filter(n => n.fireAt <= now && now - n.fireAt <= T.newsReflexWindowMin)
    .reduce<(typeof scenario.news)[number] | null>((latest, n) => (!latest || n.fireAt >= latest.fireAt ? n : latest), null)
  if (!headline) return null
  // A pause after the headline means the user stopped to think: not a reflex.
  if (history.some(e => e.action.type === 'PAUSE' && e.simMinute >= headline.fireAt)) return null
  const minutesAfter = now - headline.fireAt
  const affects = headline.impacts?.some(i => i.symbol === order.symbol) ?? false
  return {
    kind: 'news_reflex', simMinute: now, symbol: order.symbol,
    facts: {
      newsId: headline.id, headline: headline.headline, classification: headline.classification,
      minutesAfterNews: minutesAfter, newsNamesThisStock: affects, side: order.side,
    },
    summary: `Placed a ${order.side} order for ${order.symbol} ${minutesAfter === 0 ? 'in the same minute as' : `${minutesAfter} minute${minutesAfter === 1 ? '' : 's'} after`} the headline "${headline.headline}", without pausing.`,
  }
}

/** A BUY that puts a large share of the account into one order. */
export const oversizedPosition: Rule = ({ order, before, now, price }) => {
  if (order.side !== 'BUY') return null
  const notional = order.quantity * (order.price ?? price(order.symbol))
  const equity = equityAt(before, price, now)
  if (equity <= 0) return null
  const share = notional / equity
  if (share <= T.oversizedPctOfEquity) return null
  return {
    kind: 'oversized_position', simMinute: now, symbol: order.symbol,
    facts: { buyNotional: r2(notional), equity: r2(equity), pctOfEquity: pct(share) },
    summary: `Bought ${order.quantity} ${order.symbol} worth ${r2(notional)}: ${pct(share)}% of the account in one order.`,
  }
}

/** Many orders in a short window. Counts placement attempts, including rejected ones. */
export const overtrading: Rule = ({ order, now, history }) => {
  const recent = history.filter(e => e.action.type === 'PLACE_ORDER' && now - e.simMinute < T.overtradingWindowMin).length + 1
  if (recent < T.overtradingOrders) return null
  return {
    kind: 'overtrading', simMinute: now, symbol: order.symbol,
    facts: { ordersInWindow: recent, windowMinutes: T.overtradingWindowMin },
    summary: `This is order number ${recent} in the last ${T.overtradingWindowMin} minutes.`,
  }
}
