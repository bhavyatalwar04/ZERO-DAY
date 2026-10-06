import { describe, it, expect } from 'vitest'
import { monitorSession } from './monitor'
import { averagingDown, panicSell } from './rules-bhavya'
import { buy, COV20_DATASET, drive, findMoment, px, qtyFor, sell, SYMBOLS } from './test-helpers'

// Spec for Bhavya's rules (rules-bhavya.ts). These fail until the rules are written.
// Fixtures come from COV-20's real price path, so they stay valid if the data changes
// (findMoment throws if no such moment exists).

const detect = (j: ReturnType<typeof drive>) => monitorSession(j.entries, COV20_DATASET)

describe('averaging_down (Bhavya)', () => {
  // A buy minute b and a later minute m (before the halt) where the price is ≥2% below b's.
  const at = findMoment('price ≥2% below a price within the previous 40 minutes', (s, m) => {
    if (m >= 76) return false
    for (let b = Math.max(1, m - 40); b < m; b++) if (px(s, m) <= px(s, b) * 0.98) return true
    return false
  })
  const { symbol, minute: m } = at
  let b = Math.max(1, m - 40)
  for (let k = b; k < m; k++) if (px(symbol, k) > px(symbol, b)) b = k   // highest earlier price = worst entry
  const q1 = qtyFor(symbol, b, 10_000)
  const q2 = qtyFor(symbol, m, 10_000)

  it('fires when buying more of a position that is ≥2% underwater', () => {
    const j = drive([b, buy(symbol, q1), m - b, buy(symbol, q2)])
    const e = detect(j).find(e => e.actionSeq === 2)
    expect(e).toBeDefined()
    expect(e).toMatchObject({ kind: 'averaging_down', simMinute: m, symbol })
    expect(e!.facts).toMatchObject({ existingQty: q1, addedQty: q2 })
    expect(e!.facts.avgPrice).toBeCloseTo(px(symbol, b), 2)
    expect(e!.facts.price).toBeCloseTo(px(symbol, m), 2)
    expect(e!.facts.lossPct).toBeCloseTo((1 - px(symbol, m) / px(symbol, b)) * 100, 1)
    expect(e!.facts.lossPct).toBeGreaterThanOrEqual(2)
    expect(e!.summary).toContain(symbol)
  })

  it('stays quiet when the position is less than 2% underwater', () => {
    // Add to the position in the very next minute: the price has barely moved.
    const near = findMoment('a minute whose next-minute price is within 1%', (s, k) => k < 70 && Math.abs(px(s, k + 1) / px(s, k) - 1) < 0.01)
    const j = drive([near.minute, buy(near.symbol, qtyFor(near.symbol, near.minute, 10_000)), 1, buy(near.symbol, 5)])
    expect(detect(j).map(e => e.kind)).not.toContain('averaging_down')
  })

  it('stays quiet for a first BUY (no existing position) and for a SELL', () => {
    expect(detect(drive([m, buy(symbol, q2)])).map(e => e.kind)).not.toContain('averaging_down')
    const j = drive([b, buy(symbol, q1), m - b, sell(symbol, 1)])
    expect(detect(j).map(e => e.kind)).not.toContain('averaging_down')
  })
})

describe('rules in isolation (the priority order can hide a rule from monitorSession)', () => {
  // Same underwater position for both: avg 100, price 90 now and 95 fifteen minutes ago, prev close 100.
  const ctx = (side: 'BUY' | 'SELL') => ({
    now: 30,
    order: { id: 'o2', side, type: 'MARKET', symbol: 'TCS', quantity: 5 },
    before: { positions: { TCS: { symbol: 'TCS', qty: 10, avgPrice: 100, realisedPnL: 0 } } },
    price: (_s: string, minute = 30) => (minute === 30 ? 90 : 95),
    prevClose: () => 100,
  }) as unknown as Parameters<typeof averagingDown>[0]

  it('averaging_down ignores SELLs, panic_sell ignores BUYs', () => {
    expect(averagingDown(ctx('BUY'))?.kind).toBe('averaging_down')
    expect(averagingDown(ctx('SELL'))).toBeNull()
    expect(panicSell(ctx('SELL'))?.kind).toBe('panic_sell')
    expect(panicSell(ctx('BUY'))).toBeNull()
  })
})

describe('panic_sell (Bhavya) — "on-screen red"', () => {
  const prevClose = (s: string) => COV20_DATASET.timeline[s].prevClose
  const underwater = (s: string, b: number, m: number) => px(s, m) <= px(s, b) * 0.98
  const red = (s: string, m: number) => px(s, m) <= prevClose(s) * 0.95
  const falling = (s: string, m: number) => px(s, m) < px(s, Math.max(0, m - 15))

  /** A buy minute b and a later sell minute m (before the halt) satisfying `ok`. Throws if COV-20 has none. */
  function findTrade(what: string, ok: (s: string, b: number, m: number) => boolean) {
    for (let m = 2; m < 76; m++) for (const s of SYMBOLS) for (let b = 1; b < m; b++) {
      if (ok(s, b, m)) return { s, b, m }
    }
    throw new Error(`No COV-20 trade found for: ${what}`)
  }
  const panicAt = (t: { s: string; b: number; m: number }) => {
    const q = qtyFor(t.s, t.b, 10_000)
    const j = drive([t.b, buy(t.s, q), t.m - t.b, sell(t.s, q)])
    return detect(j).find(e => e.actionSeq === 2)
  }

  it('fires when selling a losing position while the stock is ≥5% red on the day and still falling', () => {
    const t = findTrade('underwater + red + falling', (s, b, m) => underwater(s, b, m) && red(s, m) && falling(s, m))
    const e = panicAt(t)
    expect(e).toBeDefined()
    expect(e).toMatchObject({ kind: 'panic_sell', simMinute: t.m, symbol: t.s })
    expect(e!.facts).toMatchObject({ lookbackMinutes: 15 })
    expect(e!.facts.avgPrice).toBeCloseTo(px(t.s, t.b), 2)
    expect(e!.facts.price).toBeCloseTo(px(t.s, t.m), 2)
    expect(e!.facts.lossPct).toBeCloseTo((1 - px(t.s, t.m) / px(t.s, t.b)) * 100, 1)
    expect(e!.facts.dayDropPct).toBeCloseTo((1 - px(t.s, t.m) / prevClose(t.s)) * 100, 1)
    expect(e!.facts.fallPct).toBeCloseTo((1 - px(t.s, t.m) / px(t.s, Math.max(0, t.m - 15))) * 100, 1)
    expect(e!.summary).toContain(t.s)
  })

  it('stays quiet when the stock is less than 5% red on the day', () => {
    const t = findTrade('underwater + falling, NOT red', (s, b, m) => underwater(s, b, m) && !red(s, m) && falling(s, m))
    expect(panicAt(t)?.kind).not.toBe('panic_sell')
  })

  it('stays quiet when the stock is no longer falling', () => {
    const t = findTrade('underwater + red, NOT falling', (s, b, m) => underwater(s, b, m) && red(s, m) && !falling(s, m))
    expect(panicAt(t)?.kind).not.toBe('panic_sell')
  })

  it('stays quiet when the position is less than 2% underwater', () => {
    const t = findTrade('red + falling, NOT underwater', (s, b, m) => !underwater(s, b, m) && red(s, m) && falling(s, m))
    expect(panicAt(t)?.kind).not.toBe('panic_sell')
  })
})
