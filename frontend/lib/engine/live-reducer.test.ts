import { describe, it, expect } from 'vitest'
import { reducer, initialState, getPriceAtMinute, type Action } from './live-reducer'
import { SCENARIOS } from './scenarios'
import { play } from '@/lib/session/test-sessions'
import type { LiveSessionState } from '@/types/live'

// P2 engine fixes (AUDIT §1.4 #1–4, 2026-11-04): stop-losses execute, headlines
// are recorded, committed cash/shares can't be spent twice, and an order that
// can't be honoured at fill time is rejected rather than marked FILLED.

const run = (s: LiveSessionState, ...actions: Action[]) => actions.reduce(reducer, s)
const ticks = (s: LiveSessionState, n: number) => { for (let i = 0; i < n; i++) s = reducer(s, { type: 'TICK' }); return s }
const started = () => reducer(initialState('COV-20'), { type: 'START' })
const buy = (symbol: string, quantity: number, extra: object = {}): Action =>
  ({ type: 'PLACE_ORDER', order: { symbol, side: 'BUY', type: 'MARKET', validity: 'DAY', quantity, ...extra } })
const sell = (symbol: string, quantity: number, extra: object = {}): Action =>
  ({ type: 'PLACE_ORDER', order: { symbol, side: 'SELL', type: 'MARKET', validity: 'DAY', quantity, ...extra } })

describe('stop-losses execute (AUDIT §1.4 #1)', () => {
  it('sells the whole position at the first minute the price is at or below the stop', () => {
    let s = run(started(), buy('INDIGO', 10))
    const entry = s.positions.INDIGO.avgPrice
    const stop = Math.round(entry * 0.99 * 100) / 100
    s = reducer(s, { type: 'SET_STOP', symbol: 'INDIGO', stopPrice: stop })

    // The first minute the stop is breached, found from the data, not from the engine.
    let hit = 1
    while (getPriceAtMinute('INDIGO', hit) > stop) hit++
    expect(hit, 'COV-20 is a crash: INDIGO falls 1% at some point').toBeLessThan(375)

    s = ticks(s, hit - 1)
    expect(s.positions.INDIGO?.qty, 'still held the minute before').toBe(10)
    s = ticks(s, 1)
    expect(s.positions.INDIGO).toBeUndefined()
    const fill = s.orders.at(-1)!
    expect(fill).toMatchObject({ side: 'SELL', type: 'SL-M', quantity: 10, status: 'FILLED', triggerPrice: stop, filledAtMin: hit })
    expect(fill.filledPrice).toBe(getPriceAtMinute('INDIGO', hit))
    expect(s.realisedPnL).toBeCloseTo((fill.filledPrice! - entry) * 10)
  })

  it('does not fire while paused, and fires on the first live tick after', () => {
    let s = run(started(), buy('INDIGO', 5))
    s = run(s, { type: 'SET_STOP', symbol: 'INDIGO', stopPrice: 1e9 }, { type: 'PAUSE' }) // any price breaches it
    s = ticks(s, 3)
    expect(s.positions.INDIGO?.qty).toBe(5)
    s = ticks(reducer(s, { type: 'RESUME' }), 1)
    expect(s.positions.INDIGO).toBeUndefined()
  })

  it('removing the stop stops it firing', () => {
    let s = run(started(), buy('INDIGO', 5), { type: 'SET_STOP', symbol: 'INDIGO', stopPrice: 1e9 },
      { type: 'SET_STOP', symbol: 'INDIGO', stopPrice: null })
    s = ticks(s, 5)
    expect(s.positions.INDIGO?.qty).toBe(5)
  })

  it('rejects pending sells of a position the stop has closed', () => {
    let s = run(started(), buy('INDIGO', 5), sell('INDIGO', 5, { type: 'LIMIT', price: 1e9 }))
    expect(s.orders.at(-1)!.status).toBe('PENDING')
    s = ticks(reducer(s, { type: 'SET_STOP', symbol: 'INDIGO', stopPrice: 1e9 }), 1)
    expect(s.orders[1]).toMatchObject({ status: 'REJECTED', reason: 'Position closed by stop-loss' })
    expect(s.orders.filter(o => o.side === 'SELL' && o.status === 'FILLED')).toHaveLength(1)
  })
})

describe('headlines are recorded (AUDIT §1.4 #2)', () => {
  const news = SCENARIOS['COV-20'].dataset.news

  it('firedNewsIds holds exactly the headlines whose time has come, in time order', () => {
    let s = started()
    for (const m of [10, 60, 200, 374]) {
      s = ticks(s, m - s.currentMinute)
      const expected = news.filter(n => n.fireAt <= m).sort((a, b) => a.fireAt - b.fireAt).map(n => n.id)
      expect(s.firedNewsIds, `minute ${m}`).toEqual(expected)
    }
  })

  it('catches up on headlines skipped by SKIP_HALT', () => {
    const halt = SCENARIOS['COV-20'].dataset.circuits[0]
    let s = ticks(started(), halt.fireAt)
    expect(s.status).toBe('HALTED')
    s = reducer(s, { type: 'SKIP_HALT' })
    const due = news.filter(n => n.fireAt <= s.currentMinute).map(n => n.id)
    expect([...s.firedNewsIds].sort()).toEqual([...due].sort())
  })

  it('works for the manifest scenarios too', () => {
    for (const id of ['TAX-19', 'ELEC-24', 'GME-21']) {
      const s = ticks(reducer(initialState(id), { type: 'START' }), 400)
      expect(s.status).toBe('CLOSED')
      expect(s.firedNewsIds.length, id).toBe(SCENARIOS[id].dataset.news.filter(n => n.fireAt <= s.currentMinute).length)
    }
  })
})

describe('committed cash and shares are reserved (AUDIT §1.4 #3–4)', () => {
  it('a second buy cannot spend cash promised to a pending limit buy', () => {
    const price = getPriceAtMinute('TCS', 0)
    const limit = Math.round(price * 0.5 * 100) / 100           // far below: stays pending
    const qty = Math.floor(90_000 / limit)                       // ~90% of the cash
    let s = run(started(), buy('TCS', qty, { type: 'LIMIT', price: limit }))
    expect(s.orders[0].status).toBe('PENDING')
    const affordable = Math.floor(50_000 / price)                // would pass the old check (cash = 100k)
    s = reducer(s, buy('TCS', affordable))
    expect(s.orders[1]).toMatchObject({ status: 'REJECTED', reason: 'Insufficient funds' })
    // ...but what is genuinely left is still spendable
    s = reducer(s, buy('TCS', Math.floor((s.cash - qty * limit) / price) - 1))
    expect(s.orders[2].status).toBe('FILLED')
  })

  it('two pending sells cannot together sell more than the position', () => {
    let s = run(started(), buy('INDIGO', 10), sell('INDIGO', 7, { type: 'LIMIT', price: 1e9 }))
    s = reducer(s, sell('INDIGO', 7, { type: 'LIMIT', price: 1e9 }))
    expect(s.orders[2]).toMatchObject({ status: 'REJECTED', reason: 'Position too small to sell' })
  })

  it('over random play-throughs, cash never goes negative and no sell fills without shares', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const { live } = play(seed)
      expect(live.cash, `seed ${seed}`).toBeGreaterThanOrEqual(-1e-6)
      // Shares bought minus shares sold (incl. square-off) never dips below zero per symbol.
      const held: Record<string, number> = {}
      for (const o of live.orders.filter(o => o.status === 'FILLED').sort((a, b) => a.filledAtMin! - b.filledAtMin!)) {
        held[o.symbol] = (held[o.symbol] ?? 0) + (o.side === 'BUY' ? o.quantity : -o.quantity)
        expect(held[o.symbol], `seed ${seed} ${o.id}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('testing the test: the random play-throughs hit the new paths', () => {
    const all = Array.from({ length: 150 }, (_, i) => play(i + 1).live)
    const orders = all.flatMap(s => s.orders)
    expect(orders.some(o => o.reason?.startsWith('Stop-loss hit')), 'a stop fired').toBe(true)
    expect(orders.some(o => o.reason === 'Insufficient funds'), 'reserved cash rejected a buy').toBe(true)
    expect(orders.some(o => o.reason?.endsWith('at fill')), 'a fill-time re-check rejected an order').toBe(true)
  })
})
