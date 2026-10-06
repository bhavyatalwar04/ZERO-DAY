import 'server-only'
import { z } from 'zod'
import { clockAt, NSE, type MarketSpec } from '@/lib/engine/markets'
import type { AnyToolDef, ToolContext, ToolDef } from '../types'
import { rsi, sma, vwap } from '@/lib/indicators/indicators'
import { marketAt, type MarketView } from './market-view'

// ============================================================================
// Research tools (2.4). Read-only, small outputs (every result is re-sent to the
// model on each later step), numbers rounded to 2 dp.
//
// No-lookahead by construction:
//   - tools take a LOOKBACK, never a time range, so the model can't ask about later;
//   - tools read the scenario only through marketAt(…, simMinute) (market-view.ts);
//   - tools.test.ts checks every tool gives the same output on a dataset cut at simMinute.
// Written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

const r2 = (n: number) => Math.round(n * 100) / 100
const pctChange = (from: number, to: number) => (from === 0 ? 0 : r2(((to - from) / from) * 100))

/** Session clock in the scenario's local market time (M4: NSE 09:15 IST, NYSE 09:30 ET). Absent market = NSE. */
export function clock(minute: number, market: MarketSpec = NSE): string {
  return clockAt(Math.max(0, minute), market)
}

const view = (ctx: ToolContext): MarketView => marketAt(ctx.scenario, ctx.session.simMinute)

function knownSymbol(m: MarketView, symbol: string): string {
  const s = symbol.toUpperCase()
  if (!m.symbols().includes(s)) throw new Error(`Unknown symbol "${symbol}". Use one of: ${m.symbols().join(', ')}`)
  return s
}

const Symbol = z.string().min(1).max(20).describe('Stock symbol, e.g. INDIGO')

// ─── get_price_window ───────────────────────────────────────

const PriceWindow = z.object({
  symbol: z.string(), from: z.string(), to: z.string(),
  startPrice: z.number(), price: z.number(), changePct: z.number(),
  high: z.number(), low: z.number(),
  prevClose: z.number(), vsPrevClosePct: z.number(),
})

export const getPriceWindow: ToolDef<{ symbol: string; lookbackMinutes: number }, z.infer<typeof PriceWindow>> = {
  name: 'get_price_window',
  description: 'How one stock moved over the last N minutes, ending now: start price, current price, % change, high and low, and % vs the previous day\'s close. You can only look back, never ahead.',
  input: z.object({ symbol: Symbol, lookbackMinutes: z.number().int().min(5).max(180).describe('How far back to look, in minutes (5–180)') }),
  output: PriceWindow,
  run: async ({ symbol, lookbackMinutes }, ctx) => {
    const m = view(ctx)
    const s = knownSymbol(m, symbol)
    const start = Math.max(0, m.now - lookbackMinutes)
    const startPrice = m.price(s, start)
    const price = m.price(s)
    const inWindow = m.completedBars(s).filter(b => b.minute + 5 > start)
    const highs = [startPrice, price, ...inWindow.map(b => b.high)]
    const lows = [startPrice, price, ...inWindow.map(b => b.low)]
    return {
      symbol: s, from: clock(start, ctx.scenario.market), to: clock(m.now, ctx.scenario.market),
      startPrice: r2(startPrice), price: r2(price), changePct: pctChange(startPrice, price),
      high: r2(Math.max(...highs)), low: r2(Math.min(...lows)),
      prevClose: r2(m.prevClose(s)), vsPrevClosePct: pctChange(m.prevClose(s), price),
    }
  },
}

// ─── get_indicators ─────────────────────────────────────────

const Indicators = z.object({
  symbol: z.string(), at: z.string(), price: z.number(), barsAvailable: z.number(),
  rsi14: z.number().nullable(),
  sma20min: z.number().nullable(), sma60min: z.number().nullable(), priceVsSma60minPct: z.number().nullable(),
  vwap: z.number().nullable(), priceVsVwapPct: z.number().nullable(),
  dayHigh: z.number(), dayLow: z.number(), fromDayHighPct: z.number(), fromDayLowPct: z.number(),
  notes: z.array(z.string()),
})

export const getIndicators: ToolDef<{ symbol: string }, z.infer<typeof Indicators>> = {
  name: 'get_indicators',
  description: 'Technical indicators for one stock right now, on 5-minute bars: RSI(14), 20- and 60-minute moving averages, session VWAP, and distance from the day\'s high and low. A value is null when there is not enough data yet (see notes).',
  input: z.object({ symbol: Symbol }),
  output: Indicators,
  run: async ({ symbol }, ctx) => {
    const m = view(ctx)
    const s = knownSymbol(m, symbol)
    const closes = m.closes(s)
    const done = m.completedBars(s)
    const price = m.price(s)
    const notes: string[] = []
    const r = rsi(closes, 14)
    if (r === null) notes.push(`rsi14 needs 15 bars (75 minutes); ${closes.length} available`)
    const s20 = sma(closes, 4)
    const s60 = sma(closes, 12)
    if (s60 === null) notes.push(`sma60min needs 12 bars (60 minutes); ${closes.length} available`)
    const v = vwap(done)
    if (v === null) notes.push('vwap needs at least one completed bar')
    const dayHigh = Math.max(price, ...done.map(b => b.high))
    const dayLow = Math.min(price, ...done.map(b => b.low))
    return {
      symbol: s, at: clock(m.now, ctx.scenario.market), price: r2(price), barsAvailable: closes.length,
      rsi14: r === null ? null : r2(r),
      sma20min: s20 === null ? null : r2(s20),
      sma60min: s60 === null ? null : r2(s60),
      priceVsSma60minPct: s60 === null ? null : pctChange(s60, price),
      vwap: v === null ? null : r2(v),
      priceVsVwapPct: v === null ? null : pctChange(v, price),
      dayHigh: r2(dayHigh), dayLow: r2(dayLow),
      fromDayHighPct: pctChange(dayHigh, price), fromDayLowPct: pctChange(dayLow, price),
      notes,
    }
  },
}

// ─── get_news ───────────────────────────────────────────────

const News = z.object({
  headlines: z.array(z.object({ time: z.string(), minutesAgo: z.number(), headline: z.string(), source: z.string(), severity: z.string() })),
  totalInWindow: z.number(),
})

export const getNews: ToolDef<{ lookbackMinutes: number }, z.infer<typeof News>> = {
  name: 'get_news',
  description: 'Headlines published in the last N minutes, newest first (at most 8). Whether a headline matters is for you to judge.',
  input: z.object({ lookbackMinutes: z.number().int().min(1).max(375).describe('How far back to look, in minutes') }),
  output: News,
  run: async ({ lookbackMinutes }, ctx) => {
    const m = view(ctx)
    const inWindow = m.news().filter(n => m.now - n.fireAt <= lookbackMinutes).sort((a, b) => b.fireAt - a.fireAt)
    return {
      // signal/noise classification and per-stock impacts are withheld: they are the scenario's answer key
      headlines: inWindow.slice(0, 8).map(n => ({
        time: clock(n.fireAt, ctx.scenario.market), minutesAgo: m.now - n.fireAt, headline: n.headline,
        source: n.source ?? 'unknown', severity: n.severity,
      })),
      totalInWindow: inWindow.length,
    }
  },
}

// ─── get_market ─────────────────────────────────────────────

const Market = z.object({
  at: z.string(),
  indices: z.array(z.object({ name: z.string(), value: z.number(), vsPrevClosePct: z.number(), changeOverWindowPct: z.number() })),
  halts: z.array(z.object({ level: z.number(), from: z.string(), until: z.string(), activeNow: z.boolean() })),
})

export const getMarket: ToolDef<{ lookbackMinutes: number }, z.infer<typeof Market>> = {
  name: 'get_market',
  description: 'The wider market now: index levels (e.g. NIFTY, SENSEX, VIX) with % vs previous close and % change over the last N minutes, plus any circuit-breaker halts so far today.',
  input: z.object({ lookbackMinutes: z.number().int().min(5).max(180).describe('Window for the % change, in minutes') }),
  output: Market,
  run: async ({ lookbackMinutes }, ctx) => {
    const m = view(ctx)
    const startBar = Math.floor(Math.max(0, m.now - lookbackMinutes) / 5)
    const indices = m.indexNames().flatMap(name => {
      const series = m.indexSeries(name)
      if (series.length === 0) return []
      const last = series[series.length - 1]
      const first = series[Math.min(startBar, series.length - 1)]
      return [{ name, value: r2(last.value), vsPrevClosePct: r2(last.pctChange * 100), changeOverWindowPct: pctChange(first.value, last.value) }]
    })
    const halts = m.halts().map(h => ({
      level: h.level, from: clock(h.startedAtMin, ctx.scenario.market), until: clock(h.endsAtMin, ctx.scenario.market), activeNow: m.now < h.endsAtMin,
    }))
    return { at: clock(m.now, ctx.scenario.market), indices, halts }
  },
}

// ─── get_position ───────────────────────────────────────────

const Position = z.object({
  symbol: z.string(), qty: z.number(), avgPrice: z.number().nullable(), price: z.number(),
  unrealisedPnL: z.number().nullable(), unrealisedPct: z.number().nullable(),
  openOrders: z.array(z.object({ side: z.string(), type: z.string(), quantity: z.number(), limitPrice: z.number().nullable(), triggerPrice: z.number().nullable(), placedAt: z.string() })),
  cash: z.number(), realisedPnLToday: z.number(),
})

export const getPosition: ToolDef<{ symbol: string }, z.infer<typeof Position>> = {
  name: 'get_position',
  description: 'The user\'s holding in one stock at the moment of the decision: quantity, average cost, unrealised P&L, open orders, plus account cash and realised P&L today.',
  input: z.object({ symbol: Symbol }),
  output: Position,
  run: async ({ symbol }, ctx) => {
    const m = view(ctx)
    const s = knownSymbol(m, symbol)
    const state = ctx.session.state
    const pos = state.positions[s]
    const price = m.price(s)
    const qty = pos?.qty ?? 0
    return {
      symbol: s, qty, avgPrice: qty ? r2(pos!.avgPrice) : null, price: r2(price),
      unrealisedPnL: qty ? r2((price - pos!.avgPrice) * qty) : null,
      unrealisedPct: qty ? pctChange(pos!.avgPrice, price) : null,
      // Stop prices are omitted on purpose: stop-losses never execute in this engine (AUDIT §1.4 #1, P2).
      openOrders: state.orders.filter(o => o.symbol === s && o.status === 'PENDING').map(o => ({
        side: o.side, type: o.type, quantity: o.quantity,
        limitPrice: o.price ?? null, triggerPrice: o.triggerPrice ?? null, placedAt: clock(o.placedAtMin, ctx.scenario.market),
      })),
      cash: r2(state.cash), realisedPnLToday: r2(state.realisedPnL),
    }
  },
}

export const RESEARCH_TOOLS: AnyToolDef[] = [getPriceWindow, getIndicators, getNews, getMarket, getPosition]

/**
 * The tools for one scenario: `symbol` becomes an enum of that scenario's symbols, so
 * the JSON schema the model sees lists the valid choices. Live run 2026-10-02: with a
 * free-text symbol, qwen asked twice for "TRO" and the error message didn't correct it.
 */
export function researchTools(symbols: readonly string[]): AnyToolDef[] {
  if (symbols.length === 0) return RESEARCH_TOOLS
  const SymbolEnum = z.enum(symbols as [string, ...string[]]).describe('Stock symbol')
  return RESEARCH_TOOLS.map(t => {
    const input = t.input as unknown as z.ZodObject<z.ZodRawShape>
    return 'symbol' in input.shape ? { ...t, input: input.extend({ symbol: SymbolEnum }) } : t
  })
}
