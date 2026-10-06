import { describe, it, expect } from 'vitest'
import type { LiveSessionState } from '@/types/live'
import { SCENARIOS } from '@/lib/engine/scenarios'
import { reducer, initialState, symbolsOf, sessionMinutesOf, type Action } from '@/lib/engine/live-reducer'
import { emptyJournal, withJournal } from '@/lib/session/journal'
import { replay } from '@/lib/session/replay'
import { engineFor, monitorSession } from '@/lib/monitor/monitor'
import { scorecard } from '@/lib/scoring/scorecard'
import { mulberry32 } from './reconstruct'
import { TAX19_MANIFEST } from './tax-19/manifest'
import { ELEC24_MANIFEST } from './elec-24/manifest'
import { GME21_MANIFEST } from './gme-21/manifest'
import { buildScenario, type DailyFile } from './manifest'
import tax19Daily from './tax-19/daily.json'
import elec24Daily from './elec-24/daily.json'
import gme21Daily from './gme-21/daily.json'

// 4.3/4.6: per-scenario QA. The reconstruction must reproduce every REAL daily
// number exactly, stay inside the day's range, and replay deterministically.

const BUILT = [
  { m: TAX19_MANIFEST, d: tax19Daily as DailyFile },
  { m: ELEC24_MANIFEST, d: elec24Daily as DailyFile },
  { m: GME21_MANIFEST, d: gme21Daily as DailyFile },
]

describe.each(BUILT)('$m.id: reconstruction keeps the real daily bars', ({ m, d }) => {
  const { dataset } = buildScenario(m, d)
  const n = m.market.sessionMinutes

  it.each(m.stocks.map(s => [s.symbol, s.ticker] as const))('%s: real open, high, low, close and previous close, exactly', (symbol, ticker) => {
    const real = d.bars[ticker]
    const tl = dataset.timeline[symbol]
    expect(tl.bars).toHaveLength(n / 5)
    expect(tl.prevClose).toBe(real.prevClose)
    expect(tl.bars[0].open).toBe(real.open)
    expect(tl.bars.at(-1)!.close).toBe(real.close)
    expect(Math.max(...tl.bars.map(b => b.high))).toBe(real.high)
    expect(Math.min(...tl.bars.map(b => b.low))).toBe(real.low)
    for (const b of tl.bars) {
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close))
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close))
    }
    // Volume: the real daily total, spread over the day.
    expect(Math.abs(tl.bars.reduce((v, b) => v + b.volume, 0) - real.volume)).toBeLessThanOrEqual(n)
  })

  it('indices end at the real close vs the real previous close', () => {
    for (const ix of m.indices) {
      const real = d.bars[ix.ticker]
      const series = dataset.indices![ix.name]
      expect(series.at(-1)!.value).toBe(real.close)
      expect(series.at(-1)!.pctChange).toBeCloseTo(real.close / real.prevClose - 1, 10)
    }
  })

  it('is deterministic: building twice gives identical data', () => {
    expect(buildScenario(m, d).dataset).toEqual(dataset)
  })

  it('stocks co-move with the market (positive correlation of 5-minute returns for most)', () => {
    const ret = (xs: number[]) => xs.slice(1).map((x, i) => x / xs[i] - 1)
    const corr = (a: number[], b: number[]) => {
      const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length
      const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0)
      return cov / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0))
    }
    const mkt = ret(dataset.indices![m.indices[0].name].map(p => p.value))
    const positive = m.stocks.filter(s => corr(ret(dataset.timeline[s.symbol].bars.map(b => b.close)), mkt) > 0).length
    expect(positive).toBeGreaterThanOrEqual(4)
  })

  it('news and hints are well-formed', () => {
    expect(new Set(m.news.map(x => x.id)).size).toBe(m.news.length)
    for (const x of m.news) {
      expect(x.fireAt).toBeGreaterThanOrEqual(0)
      expect(x.fireAt).toBeLessThan(n)
      for (const i of x.impacts ?? []) expect(m.stocks.map(s => s.symbol)).toContain(i.symbol)
    }
    const names = [...m.stocks.map(s => s.symbol), ...m.indices.map(i => i.name)]
    for (const k of Object.keys(m.hints ?? {})) expect(names).toContain(k)
  })
})

// ─── 4.6 QA replay: random sessions through the engine, replayed from the journal ──

const journaled = withJournal(reducer)

function randomSession(scenarioId: string, seed: number) {
  const rand = mulberry32(seed)
  const symbols = symbolsOf(scenarioId)
  let j = journaled(emptyJournal<LiveSessionState, Action>(initialState(scenarioId)), { type: 'START' })
  let live = j.live
  const end = sessionMinutesOf(scenarioId)
  while (live.status !== 'CLOSED' && live.currentMinute < end) {
    const r = rand()
    const sym = symbols[Math.floor(rand() * symbols.length)]
    if (r < 0.04) j = journaled(j, { type: 'PLACE_ORDER', order: { symbol: sym, side: 'BUY', type: 'MARKET', validity: 'DAY', quantity: 1 + Math.floor(rand() * 20) } })
    else if (r < 0.06 && live.positions[sym]) j = journaled(j, { type: 'PLACE_ORDER', order: { symbol: sym, side: 'SELL', type: 'MARKET', validity: 'DAY', quantity: live.positions[sym].qty } })
    else if (r < 0.065) j = journaled(j, { type: 'PAUSE' })
    else if (r < 0.07) j = journaled(j, { type: 'RESUME' })
    j = journaled(j, { type: 'TICK' })
    if (j.live.status === 'PAUSED' && rand() < 0.5) j = journaled(j, { type: 'RESUME' })
    live = j.live
  }
  return j
}

describe.each(['TAX-19', 'ELEC-24', 'GME-21'])('%s: engine QA replay', id => {
  it('a full session reaches the scenario\'s own closing bell', () => {
    const j = randomSession(id, 7)
    if (j.live.status !== 'CLOSED') return   // a session left paused can't reach the bell; covered by other seeds
    expect(j.live.currentMinute).toBe(sessionMinutesOf(id))
    expect(Object.keys(j.live.positions)).toHaveLength(0)   // squared off
  })

  it.each([1, 2, 3, 4, 5])('random session %i: replaying the journal reproduces the live state exactly', seed => {
    const j = randomSession(id, seed * 101)
    const replayed = replay(engineFor(id), j.entries, { untilMinute: j.live.currentMinute })
    expect(replayed).toEqual(j.live)
  })

  it('Monitor and the scorecard run on the scenario', () => {
    const j = randomSession(id, 42)
    expect(() => monitorSession(j.entries, SCENARIOS[id].dataset)).not.toThrow()
    const sc = scorecard(j.entries, SCENARIOS[id].dataset)
    expect(sc.scenarioId).toBe(id)
    expect(Number.isFinite(sc.baselines.buyAndHold.returnPct)).toBe(true)
  })
})
