import type { IntradayBar, NewsEvent } from '@/types/live'
import type { ScenarioDataset } from '../types'

// ============================================================================
// The market as it looked at minute `now` (2.4). Research tools read the
// scenario ONLY through this view, so they can't see the future even by
// mistake. The smoke run (2026-09-23) caught qwen reading later prices.
//
// What "visible at minute m" means, matching what the engine shows the user:
//   - The engine prices minute m at the CLOSE of the 5-minute bar covering m
//     (AUDIT §1.4 #10), so that close is visible.
//   - Earlier bars are complete history: fully visible.
//   - The current bar's open/high/low/volume describe minutes still to come, so
//     they are NOT exposed. Only its close (= the displayed price) is.
//   - News and circuit halts with fireAt ≤ m; index points up to the current bar.
// Written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

export interface MarketView {
  readonly scenarioId: string
  readonly now: number
  symbols(): string[]
  /** Engine price at `minute` (≤ now; later minutes are clamped to now). */
  price(symbol: string, minute?: number): number
  prevClose(symbol: string): number
  /** Bars that ended before the current one: complete OHLCV history. */
  completedBars(symbol: string): IntradayBar[]
  /** Closes of all bars up to and including the current one (its close is the displayed price). */
  closes(symbol: string): number[]
  news(): NewsEvent[]
  /** Index name → { value, pctChange (fraction vs previous close) } for every point up to now. */
  indexSeries(name: string): { minute: number; value: number; pctChange: number }[]
  indexNames(): string[]
  /** Halts that had started by now. */
  halts(): { startedAtMin: number; endsAtMin: number; level: number }[]
}

const barIndex = (minute: number) => Math.floor(Math.max(0, minute) / 5)

export function marketAt(scenario: ScenarioDataset, now: number): MarketView {
  const current = barIndex(now)
  const tl = (symbol: string) => {
    const t = scenario.timeline[symbol]
    if (!t) throw new Error(`Unknown symbol "${symbol}". Known: ${Object.keys(scenario.timeline).join(', ')}`)
    return t
  }
  const priceAt = (symbol: string, minute: number) => {
    const bars = tl(symbol).bars
    const idx = Math.min(bars.length - 1, barIndex(Math.min(minute, now)))
    return bars[idx]?.close ?? tl(symbol).prevClose
  }
  return {
    scenarioId: scenario.scenarioId,
    now,
    symbols: () => Object.keys(scenario.timeline),
    price: (symbol, minute = now) => priceAt(symbol, minute),
    prevClose: symbol => tl(symbol).prevClose,
    completedBars: symbol => tl(symbol).bars.slice(0, Math.min(current, tl(symbol).bars.length)),
    closes: symbol => tl(symbol).bars.slice(0, current + 1).map(b => b.close),
    news: () => scenario.news.filter(n => n.fireAt <= now),
    indexSeries: name => (scenario.indices?.[name] ?? []).slice(0, current + 1),
    indexNames: () => Object.keys(scenario.indices ?? {}),
    halts: () => scenario.circuits
      .filter(c => c.fireAt <= now)
      .map(c => ({ startedAtMin: c.fireAt, endsAtMin: c.fireAt + c.haltMinutes, level: c.level })),
  }
}
