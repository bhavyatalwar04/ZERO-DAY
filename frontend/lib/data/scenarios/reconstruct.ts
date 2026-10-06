import type { IntradayBar, StockTimeline } from '@/types/live'

// ============================================================================
// 4.3 Intraday reconstruction from REAL daily bars (ADR-009).
// Free sources have real daily open/high/low/close, but no historical minute
// data. This builds a 1-minute path that:
//   - starts at the real open and ends at the real close,
//   - touches the real high and the real low exactly once each (at seeded
//     times inside windows the scenario manifest may set, e.g. "the high comes
//     after the 10:30 announcement"), and never goes outside them,
//   - co-moves with the market: each stock's minute moves are partly the index's
//     moves (correlation rho), as on a real day,
// then aggregates it into 5-minute bars (what the engine and chart use).
// So every DAILY number is real; the intraday SHAPE is a plausible reconstruction,
// labelled as such in the UI and the report. Deterministic (seeded), so session
// replay and the server re-check stay exact.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export interface DailyBar { open: number; high: number; low: number; close: number; prevClose: number; volume: number }

/** Minute windows [from, to] (inclusive) where the day's high / low may fall. */
export interface ExtremeHints { highAt?: [number, number]; lowAt?: [number, number] }

export interface BuildOptions {
  sessionMinutes: number
  barMinutes?: number
  seed: string
  hints?: ExtremeHints
  /** the market's 1-minute log-returns to co-move with (from the index path) */
  market?: number[]
  /** correlation with the market's moves, −1..1 (negative: moves against it, like VIX) */
  rho?: number
}

// ─── PRNG (seeded, deterministic) ───────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h
}

/** Standard normal from two uniforms (Box–Muller). */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

const r2 = (n: number) => Math.round(n * 100) / 100

// ─── The path ───────────────────────────────────────────────

function pickTime(rand: () => number, [from, to]: [number, number]): number {
  return from + Math.floor(rand() * (to - from + 1))
}

/**
 * Where the high and low fall. A price that opens at its high (gap-down crash) has
 * its high at minute 0; one that closes at its low, at the last minute; and so on.
 * Otherwise: the hint window if given, else "the extreme against the day's direction
 * comes first" (an up day dips early and peaks late).
 */
export function extremeTimes(d: DailyBar, n: number, rand: () => number, hints: ExtremeHints = {}): { tHigh: number; tLow: number } {
  const last = n - 1
  const up = d.close >= d.open
  const early: [number, number] = [1, Math.floor(n * 0.3)]
  const late: [number, number] = [Math.floor(n * 0.45), last - 1]
  let tHigh = d.high === d.open ? 0 : d.high === d.close ? last : pickTime(rand, hints.highAt ?? (up ? late : early))
  let tLow = d.low === d.open ? 0 : d.low === d.close ? last : pickTime(rand, hints.lowAt ?? (up ? early : late))
  if (tHigh === tLow) {
    // Both extremes in one minute is impossible for a path; nudge the one with room.
    if (tLow < last - 1) tLow += 1; else tHigh = Math.max(0, tHigh - 1)
  }
  return { tHigh, tLow }
}

/**
 * A 1-minute price path through anchors, as Brownian bridges between consecutive anchors:
 * cumulative noise S_i, pinned so the segment starts at a and ends at b:
 *   x_i = a + S_i − (i/n)·(S_n − (b − a))
 * then folded back inside (low, high) so only the anchors touch the extremes.
 */
export function minutePath(d: DailyBar, opts: BuildOptions): number[] {
  const n = opts.sessionMinutes
  const rand = mulberry32(seedOf(opts.seed))
  const { tHigh, tLow } = extremeTimes(d, n, rand, opts.hints)
  const anchors = new Map<number, number>([[0, d.open], [n - 1, d.close]])
  anchors.set(tHigh, d.high)
  anchors.set(tLow, d.low)
  const times = [...anchors.keys()].sort((a, b) => a - b)

  // Per-minute volatility from the day's range (Parkinson-style scale), in price units.
  const sigma = Math.max((d.high - d.low) / (2.5 * Math.sqrt(n)), d.open * 1e-5)
  const rho = opts.rho ?? 0.6
  const mkt = opts.market
  const mktSd = mkt && mkt.length > 1 ? Math.sqrt(mkt.reduce((s, x) => s + x * x, 0) / mkt.length) || 1 : 1
  const noise = (i: number) => {
    const own = gaussian(rand)
    const common = mkt ? (mkt[i] ?? 0) / mktSd : 0
    return sigma * (mkt ? rho * common + Math.sqrt(1 - rho * rho) * own : own)
  }

  const path = new Array<number>(n)
  const margin = (d.high - d.low) * 0.002
  const lo = d.low + margin, hi = d.high - margin
  for (let k = 0; k < times.length - 1; k++) {
    const t0 = times[k], t1 = times[k + 1]
    const a = anchors.get(t0)!, b = anchors.get(t1)!
    const steps = t1 - t0
    const s = [0]
    for (let i = 1; i <= steps; i++) s.push(s[i - 1] + noise(t0 + i))
    for (let i = 0; i <= steps; i++) {
      let x = a + s[i] - (i / steps) * (s[steps] - (b - a))
      if (i > 0 && i < steps) {
        // Fold back inside the day's range (a reflection, not a clamp, so no flat lines).
        for (let guard = 0; (x < lo || x > hi) && guard < 8; guard++) x = x < lo ? 2 * lo - x : 2 * hi - x
        x = Math.min(hi, Math.max(lo, x))
      }
      path[t0 + i] = x
    }
  }
  for (const [t, v] of anchors) path[t] = v
  return path.map(r2)
}

/** Volume per minute: the real daily volume spread in the usual U-shape (busy open and close). */
function minuteVolumes(total: number, n: number, rand: () => number): number[] {
  const w = Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1)
    return (1 + 2.5 * (1 - x) ** 6 + 1.5 * x ** 6) * (0.75 + 0.5 * rand())
  })
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map(v => Math.round((v / sum) * total))
}

export function toBars(path: number[], volumes: number[], barMinutes = 5): IntradayBar[] {
  const bars: IntradayBar[] = []
  for (let m = 0; m < path.length; m += barMinutes) {
    const slice = path.slice(m, m + barMinutes)
    bars.push({
      minute: m,
      open: slice[0], close: slice[slice.length - 1],
      high: Math.max(...slice), low: Math.min(...slice),
      volume: volumes.slice(m, m + barMinutes).reduce((a, b) => a + b, 0),
    })
  }
  return bars
}

export function buildTimeline(symbol: string, d: DailyBar, opts: BuildOptions): StockTimeline {
  const path = minutePath(d, opts)
  const vols = minuteVolumes(d.volume, opts.sessionMinutes, mulberry32(seedOf(`${opts.seed}:vol`)))
  return { symbol, prevClose: d.prevClose, bars: toBars(path, vols, opts.barMinutes ?? 5) }
}

/** 1-minute log-returns of a path: the "market" input for co-moving stocks. */
export function logReturns(path: number[]): number[] {
  return path.map((p, i) => (i === 0 ? 0 : Math.log(p / path[i - 1])))
}
