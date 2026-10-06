import { describe, it, expect } from 'vitest'
import { adx, rsi, sma, vwap } from './indicators'

describe('sma', () => {
  it('averages the last n values', () => expect(sma([1, 2, 3, 4, 5], 3)).toBe(4))
  it('is null with fewer than n values (never a made-up value)', () => expect(sma([1, 2], 3)).toBeNull())
})

describe('rsi (Wilder)', () => {
  it('is null without period + 1 closes', () => {
    expect(rsi(Array(14).fill(10), 14)).toBeNull()
    expect(rsi(Array(15).fill(10), 14)).toBe(50)
  })

  it('only gains → 100, only losses → 0', () => {
    expect(rsi(Array.from({ length: 20 }, (_, i) => 100 + i))).toBe(100)
    expect(rsi(Array.from({ length: 20 }, (_, i) => 100 - i))).toBe(0)
  })

  it('equal alternating gains and losses → 50', () => {
    const closes = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 100 : 101))
    expect(rsi(closes)).toBeCloseTo(50, 10)
  })

  it('matches a hand computation of the seed and one smoothing step (period 3)', () => {
    // changes: +1, −2, +3 (seed), then −1
    // seed: avgGain = (1 + 3) / 3 = 4/3, avgLoss = 2/3
    // step: avgGain = (4/3 × 2 + 0) / 3 = 8/9, avgLoss = (2/3 × 2 + 1) / 3 = 7/9
    // RSI = 100 − 100 / (1 + 8/7) = 100 × 8/15 = 53.33…
    expect(rsi([10, 11, 9, 12, 11], 3)).toBeCloseTo(800 / 15, 10)
  })

  it('testing the test: a simple (unsmoothed) average gives a different answer on the same data', () => {
    // last 3 changes: −2, +3, −1 → avgGain 1, avgLoss 1 → 50, not 53.33
    expect(rsi([10, 11, 9, 12, 11], 3)).not.toBeCloseTo(50, 1)
  })
})

describe('vwap', () => {
  it('weights the typical price by volume', () => {
    const bars = [{ high: 12, low: 8, close: 10, volume: 100 }, { high: 22, low: 18, close: 20, volume: 300 }]
    expect(vwap(bars)).toBeCloseTo((10 * 100 + 20 * 300) / 400, 10)
  })
  it('is null with no volume', () => expect(vwap([])).toBeNull())
})

describe('adx (Wilder)', () => {
  const trend = Array.from({ length: 40 }, (_, i) => ({ high: 101 + i, low: 99 + i, close: 100.5 + i }))
  const chop = Array.from({ length: 40 }, (_, i) => (i % 2 ? { high: 102, low: 98, close: 101 } : { high: 101, low: 97, close: 99 }))

  it('a steady trend reads strong; a back-and-forth market reads weak', () => {
    expect(adx(trend)!).toBeGreaterThan(50)
    expect(adx(chop)!).toBeLessThan(25)
  })

  it('needs 2 × period bars: null instead of a made-up value', () => {
    expect(adx(trend.slice(0, 27))).toBeNull()
    expect(adx(trend.slice(0, 28))).not.toBeNull()
  })
})
