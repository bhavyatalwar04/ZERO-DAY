import { describe, it, expect } from 'vitest'
import type { Order } from '@/types/live'
import { SESSION_MINUTES } from '@/lib/engine/live-reducer'
import { buy, drive, px, qtyFor, sell, COV20_DATASET } from '@/lib/monitor/test-helpers'
import { maxDrawdownPct, sessionSharpe, holdTimes, financialMetrics } from './metrics'
import { scorecard, buyAndHold, ruleBased } from './scorecard'

const fill = (id: string, side: 'BUY' | 'SELL', symbol: string, quantity: number, at: number, price = 100): Order =>
  ({ id, side, symbol, quantity, type: 'MARKET', validity: 'DAY', status: 'FILLED', placedAtMin: at, filledAtMin: at, filledPrice: price })

describe('5.1 metrics (hand-checked examples)', () => {
  it('max drawdown: the worst fall from a running peak', () => {
    expect(maxDrawdownPct([100, 120, 90, 130, 117])).toBe(25)      // 120 → 90
    expect(maxDrawdownPct([100, 101, 102])).toBe(0)
  })

  it('session Sharpe: mean/std of minute returns × √n; undefined when equity never moves', () => {
    expect(sessionSharpe([100, 100, 100, 100])).toBeNull()
    // returns +1%, −1%, +1%, −1%: mean 0 → Sharpe 0
    expect(sessionSharpe([100, 101, 99.99, 100.9899, 99.980001])).toBeCloseTo(0, 1)
    expect(sessionSharpe([100, 101, 102.5, 103])!).toBeGreaterThan(0)
  })

  it('hold time: FIFO lots, quantity-weighted', () => {
    const h = holdTimes([fill('1', 'BUY', 'A', 10, 5), fill('2', 'BUY', 'A', 10, 15), fill('3', 'SELL', 'A', 15, 25)])
    expect(h).toEqual([{ minutes: 20, qty: 10 }, { minutes: 10, qty: 5 }])
  })

  it('win rate and round trips from realised P&L', () => {
    const s = drive([10, buy('TCS', 5), 20, sell('TCS', 5)])
    const f = financialMetrics(s.live)
    expect(f.roundTrips).toBe(1)
    expect(f.winRatePct).toBe(px('TCS', 30) > px('TCS', 10) ? 100 : 0)
    expect(f.avgHoldMinutes).toBe(20)
    expect(f.ordersPlaced).toBe(2)
  })
})

describe('5.5 baselines (through the real engine)', () => {
  it('buy-and-hold on the crash day loses money; holding cash returns 0', () => {
    const bh = buyAndHold(COV20_DATASET)
    expect(bh.returnPct).toBeLessThan(0)
    expect(bh.maxDrawdownPct).toBeGreaterThan(0)
  })

  it('the cut-losers rule exits positions, so it falls less than buy-and-hold on a crash', () => {
    const bh = buyAndHold(COV20_DATASET)
    const rule = ruleBased(COV20_DATASET)
    expect(rule.maxDrawdownPct).toBeLessThan(bh.maxDrawdownPct)
  })
})

describe('5.3 scorecard', () => {
  // A small session with one flagged order (oversized) and one clean one.
  const q = qtyFor('RELIANCE', 40, 45_000)
  const j = drive([40, buy('RELIANCE', q), 60, sell('RELIANCE', q), 10, buy('TCS', 2)])

  it('is computed from the journal alone and ticks a no-END session to the bell', () => {
    const sc = scorecard(j.entries, COV20_DATASET)
    expect(sc.reachedClose).toBe(true)
    expect(sc.lastMinute).toBe(SESSION_MINUTES)
    expect(sc.financial.ordersPlaced).toBe(3)
    expect(sc.behaviour.events.oversized_position).toBe(1)
    expect(sc.behaviour.acceptedOrders).toBe(3)
    expect(sc.behaviour.flaggedOrders).toBe(1)
    expect(sc.behaviour.disciplineScore).toBe(67)
    expect(sc.vsBuyAndHoldPts).toBeCloseTo(sc.financial.returnPct - sc.baselines.buyAndHold.returnPct, 2)
  })

  it('a session ended early with END stops where it ended', () => {
    const early = drive([20, buy('TCS', 1), 5, { type: 'END' }])
    const sc = scorecard(early.entries, COV20_DATASET)
    expect(sc.reachedClose).toBe(false)
    expect(sc.lastMinute).toBe(25)
  })

  it('no orders: behaviour scores are null, not perfect', () => {
    const idle = drive([30])
    const sc = scorecard(idle.entries, COV20_DATASET)
    expect(sc.behaviour.disciplineScore).toBeNull()
    expect(sc.financial.returnPct).toBe(0)
  })
})
