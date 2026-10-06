import type { LiveSessionState } from '@/types/live'
import type { Action } from '@/lib/engine/live-reducer'
import { reducer, initialState } from '@/lib/engine/live-reducer'
import type { JournalEntry } from '@/lib/session/journal'
import { replaySteps } from '@/lib/session/replay'
import { monitorSession, type DetectedEvent } from '@/lib/monitor/monitor'
import { MONITOR_THRESHOLDS as T, type MonitorEventKind } from '@/lib/monitor/thresholds'
import { buy, drive, px, qtyFor, sell, COV20_DATASET, SYMBOLS } from '@/lib/monitor/test-helpers'

// ============================================================================
// 2.7 eval set: 15 fixed decision cases from scripted COV-20 sessions
// (ADR-010). 2 per Monitor pattern + 3 harmless trades. Each case is a whole
// journal; the decision under test is its LAST action.
//
// Cases are FOUND in the price data (like the Monitor specs), not hardcoded
// minutes, so they stay valid if the data is re-anchored in M4; cases.test.ts
// asserts Monitor labels every case as intended.
//
// Labels = our operational definitions (ADR-006). Agreement with them is what
// the eval can measure; it is not ground truth about a trader's psychology.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export type ExpectedKind = MonitorEventKind | null

export interface MarketTruth {
  symbol: string
  price: number
  prevClose: number
  /** % vs previous close (what the HUD shows), negative = down */
  dayChangePct: number
  /** % change over the last 15 minutes */
  move15Pct: number
  /** 'down' ≤ −2% on the day, 'up' ≥ +2%, else 'flat' */
  direction: 'down' | 'up' | 'flat'
  niftyDayChangePct: number | null
}

export interface EvalCase {
  id: string
  title: string
  expected: ExpectedKind
  entries: JournalEntry<Action>[]
  /** seq of the decision under test (the last entry) */
  targetSeq: number
  /** what Monitor emits for that action (null for the harmless cases) */
  event: DetectedEvent | null
  /** state just before the decision (what server replay gives Research) */
  before: LiveSessionState
  truth: MarketTruth
}

type Step = Action | number
const ENGINE = { reducer, initialState, tick: { type: 'TICK' } as Action }
/** Halt (circuit at 10:32) starts at minute 77; keep pre-halt cases clear of it. */
const PRE_HALT = 76
const r2 = (n: number) => Math.round(n * 100) / 100
/** Orders placed during the circuit halt are rejected, and Monitor ignores rejected orders. */
const halted = (m: number) => COV20_DATASET.circuits.some(c => m >= c.fireAt && m < c.fireAt + c.haltMinutes)

const quiet = (m: number) => !COV20_DATASET.news.some(n => n.fireAt <= m && m - n.fireAt <= T.newsReflexWindowMin + 1)
const quietRange = (from: number, to: number) => { for (let m = from; m <= to; m++) if (!quiet(m)) return false; return true }

function truthAt(symbol: string, minute: number): MarketTruth {
  const price = px(symbol, minute)
  const prevClose = COV20_DATASET.timeline[symbol].prevClose
  const dayChangePct = r2((price / prevClose - 1) * 100)
  const nifty = COV20_DATASET.indices?.NIFTY?.filter(p => p.minute <= minute).at(-1)
  return {
    symbol, price: r2(price), prevClose, dayChangePct,
    move15Pct: r2((price / px(symbol, Math.max(0, minute - 15)) - 1) * 100),
    direction: dayChangePct <= -2 ? 'down' : dayChangePct >= 2 ? 'up' : 'flat',
    niftyDayChangePct: nifty ? r2(nifty.pctChange * 100) : null,
  }
}

/** Steps → a case. `symbol` is the stock of the decision under test. */
function build(id: string, title: string, expected: ExpectedKind, symbol: string, steps: Step[]): EvalCase {
  const j = drive(steps)
  const entries = j.entries
  const target = entries[entries.length - 1]
  const event = monitorSession(entries, COV20_DATASET).find(e => e.actionSeq === target.seq) ?? null
  let before: LiveSessionState | null = null
  for (const s of replaySteps(ENGINE, entries)) if (s.entry.seq === target.seq) before = s.before
  return { id, title, expected, entries, targetSeq: target.seq, event, before: before!, truth: truthAt(symbol, target.simMinute) }
}

/** Distinct (symbol, buy minute, decision minute) triples satisfying `ok`, one per symbol, earliest first. */
function trades(what: string, ok: (s: string, b: number, m: number) => boolean, count: number, from = 2, to = PRE_HALT) {
  const out: { s: string; b: number; m: number }[] = []
  for (let m = from; m < to && out.length < count; m++) for (const s of SYMBOLS) {
    if (halted(m)) continue
    if (out.some(t => t.s === s) || out.length >= count) continue
    for (let b = 1; b < m; b++) if (!halted(b) && ok(s, b, m)) { out.push({ s, b, m }); break }
  }
  if (out.length < count) throw new Error(`eval cases: only ${out.length}/${count} trades found for ${what}`)
  return out
}

export function buildCases(): EvalCase[] {
  const cases: EvalCase[] = []
  const underwater = (s: string, b: number, m: number) => px(s, m) <= px(s, b) * 0.97   // clear of the 2% line
  const red = (s: string, m: number) => px(s, m) <= COV20_DATASET.timeline[s].prevClose * 0.95
  const falling = (s: string, m: number) => px(s, m) < px(s, Math.max(0, m - 15))

  // panic_sell: sell the whole losing position while deep red and still falling.
  trades('panic_sell', (s, b, m) => m - b >= 5 && underwater(s, b, m) && red(s, m) && falling(s, m) && quiet(m), 2, 2, 370)
    .forEach((t, i) => {
      const q = qtyFor(t.s, t.b, 15_000)
      cases.push(build(`panic-${i + 1}`, `Sells all ${t.s} at a loss while it is deep red and falling`, 'panic_sell', t.s,
        [t.b, buy(t.s, q), t.m - t.b, sell(t.s, q)]))
    })

  // averaging_down: buy more of an underwater position (not red enough / not a sell, so no panic).
  trades('averaging_down', (s, b, m) => m - b >= 5 && underwater(s, b, m) && quiet(m), 2, 100, 370)
    .forEach((t, i) => {
      cases.push(build(`avgdown-${i + 1}`, `Buys more ${t.s} while the position is underwater`, 'averaging_down', t.s,
        [t.b, buy(t.s, qtyFor(t.s, t.b, 12_000)), t.m - t.b, buy(t.s, qtyFor(t.s, t.m, 12_000))]))
    })

  // revenge_trade: a losing round trip, then a much bigger buy of another stock within minutes.
  trades('revenge_trade', (s, b, m) => m - b === 5 && px(s, m) < px(s, b) * 0.995 && quietRange(b, m + 3), 2, 20, 370)
    .forEach((t, i) => {
      const q = qtyFor(t.s, t.b, 12_000)
      const other = SYMBOLS.find(x => x !== t.s && !(i === 1 && x === 'TCS'))!
      cases.push(build(`revenge-${i + 1}`, `After a losing ${t.s} trade, buys ${other} at about 2.5× the size`, 'revenge_trade', other,
        [t.b, buy(t.s, q), t.m - t.b, sell(t.s, q), 2, buy(other, qtyFor(other, t.m + 2, 30_000))]))
    })

  // news_reflex: a first, small buy in the same minute as a headline.
  COV20_DATASET.news.filter(n => n.fireAt > 5 && n.fireAt < PRE_HALT).slice(0, 2).forEach((n, i) => {
    const s = SYMBOLS[(i * 2 + 1) % SYMBOLS.length]
    cases.push(build(`news-${i + 1}`, `Buys ${s} in the same minute as the headline "${n.headline.slice(0, 50)}…"`, 'news_reflex', s,
      [n.fireAt, buy(s, qtyFor(s, n.fireAt, 5_000))]))
  })

  // oversized_position: one buy of ~45% of the account at a quiet minute.
  ;[[40, 'RELIANCE'], [140, 'TITAN']].forEach(([m0, s], i) => {
    let m = m0 as number
    while (!quiet(m)) m++
    cases.push(build(`oversized-${i + 1}`, `Puts about 45% of the account into ${s} in one order`, 'oversized_position', s as string,
      [m, buy(s as string, qtyFor(s as string, m, 45_000))]))
  })

  // overtrading: five small buys of different stocks in five minutes, at a quiet time.
  ;[45, 150].forEach((m0, i) => {
    let m = m0
    while (!quietRange(m, m + 5)) m++
    const steps: Step[] = [m]
    SYMBOLS.slice(0, 5).forEach((s, k) => { if (k > 0) steps.push(1); steps.push(buy(s, qtyFor(s, m + k, 3_000))) })
    cases.push(build(`overtrade-${i + 1}`, `Places a fifth order within ${T.overtradingWindowMin} minutes`, 'overtrading', SYMBOLS[4], steps))
  })

  // Harmless decisions: Monitor should stay quiet, and so should a coach.
  let m = 50; while (!quiet(m)) m++
  cases.push(build('benign-1', 'A first, modest buy (8% of the account) at a quiet minute', null, 'TCS', [m, buy('TCS', qtyFor('TCS', m, 8_000))]))
  const win = trades('benign sell', (s, b, k) => k - b >= 10 && px(s, k) >= px(s, b) * 1.005 && quiet(k), 1, 95, 300)[0]
  cases.push(build('benign-2', `Sells ${win.s} at a small profit`, null, win.s,
    [win.b, buy(win.s, qtyFor(win.s, win.b, 8_000)), win.m - win.b, sell(win.s, qtyFor(win.s, win.b, 8_000))]))
  const up = trades('benign add', (s, b, k) => k - b >= 10 && px(s, k) >= px(s, b) * 1.003 && quiet(k), 1, 100, 300)[0]
  cases.push(build('benign-3', `Adds a little to a ${up.s} position that is in profit`, null, up.s,
    [up.b, buy(up.s, qtyFor(up.s, up.b, 6_000)), up.m - up.b, buy(up.s, qtyFor(up.s, up.m, 4_000))]))

  return cases
}
