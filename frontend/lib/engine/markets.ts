// ============================================================================
// Market conventions per scenario (M4, ADR-009/011): trading hours, session
// length, currency. COV-20 was NSE-only, so 9:15 IST, 375 minutes and ₹ were
// hardcoded across the engine and UI; scenarios now carry their market.
// Pure data, no 'server-only': engine, agents and UI all use it.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export interface MarketSpec {
  exchange: 'NSE' | 'NYSE'
  /** time-zone label shown next to clock times */
  tz: 'IST' | 'ET'
  /** the opening bell, in minutes after midnight local time */
  openMinuteOfDay: number
  /** minutes from the opening bell to the close: the engine's session length */
  sessionMinutes: number
  currency: 'INR' | 'USD'
  currencySymbol: '₹' | '$'
  /** number formatting (₹1,00,000 vs $100,000) */
  locale: 'en-IN' | 'en-US'
}

export const NSE: MarketSpec = { exchange: 'NSE', tz: 'IST', openMinuteOfDay: 9 * 60 + 15, sessionMinutes: 375, currency: 'INR', currencySymbol: '₹', locale: 'en-IN' }
export const NYSE: MarketSpec = { exchange: 'NYSE', tz: 'ET', openMinuteOfDay: 9 * 60 + 30, sessionMinutes: 390, currency: 'USD', currencySymbol: '$', locale: 'en-US' }

/** Session minute → "HH:MM" local market time. */
export function clockAt(minute: number, market: MarketSpec = NSE): string {
  const total = market.openMinuteOfDay + minute
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** A money amount in the market's currency, e.g. "₹1,00,000" / "$100,000". */
export function formatMoney(amount: number, market: MarketSpec = NSE, decimals = 0): string {
  const sign = amount < 0 ? '−' : ''
  return `${sign}${market.currencySymbol}${Math.abs(amount).toLocaleString(market.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

/** A P&L figure with an explicit sign, rounded to whole units: "+$1,234" / "−₹1,500". */
export function signedMoney(amount: number, market: MarketSpec = NSE): string {
  const rounded = Math.round(amount)
  return `${rounded >= 0 ? '+' : ''}${formatMoney(rounded, market)}`
}
