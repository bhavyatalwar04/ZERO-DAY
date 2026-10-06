// Monitor thresholds (2.1). PROVISIONAL: design parameters, not empirical
// constants. The concepts are established (disposition effect: Shefrin &
// Statman 1985, Odean 1998; overtrading: Barber & Odean 2000); these numbers
// are our choice, to be checked against the 2.7 eval set. All times are in
// SIMULATED minutes: the log has no trustworthy wall clock.

export const MONITOR_THRESHOLDS = {
  /** A position is "underwater" when price ≤ avg cost × (1 − this). */
  underwaterPct: 0.02,
  /**
   * panic_sell ("on-screen red", decided 2026-10-02): the stock is at least this far
   * below the previous close — the red % change the HUD shows — …
   */
  panicDayDropPct: 0.05,
  /** …and still falling: price now < price this many minutes ago. */
  panicLookbackMin: 15,
  /** revenge_trade: a BUY this soon after a loss-making SELL… */
  revengeWindowMin: 10,
  /** …at least this many times the SELL's size. */
  revengeSizeMultiple: 1.5,
  /** news_reflex: an order this soon after a headline, with no pause between. */
  newsReflexWindowMin: 2,
  /** oversized_position: BUY notional above this share of equity (V1's 30%). */
  oversizedPctOfEquity: 0.30,
  /** overtrading: this many orders within the window. */
  overtradingOrders: 5,
  overtradingWindowMin: 15,
  /** The same event kind can't fire again within this many minutes. */
  cooldownMin: 15,
} as const

/** Highest priority first: an action yields at most one event, the first that matches. */
export const EVENT_PRIORITY = [
  'panic_sell',
  'revenge_trade',
  'averaging_down',
  'news_reflex',
  'oversized_position',
  'overtrading',
] as const

export type MonitorEventKind = (typeof EVENT_PRIORITY)[number]
