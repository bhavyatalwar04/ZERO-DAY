import { describe, it, expect } from 'vitest'
import { getPriceAtMinute, SESSION_MINUTES } from '@/lib/engine/live-reducer'
import { play } from '@/lib/session/test-sessions'
import { monitorSession, type DetectedEvent } from './monitor'
import { sellResults } from './context'
import { MONITOR_THRESHOLDS as T } from './thresholds'
import { buy, COV20_DATASET, drive, findMoment, px, qtyFor, sell, SYMBOLS } from './test-helpers'

const detect = (j: ReturnType<typeof drive>) => monitorSession(j.entries, COV20_DATASET)
const kinds = (events: DetectedEvent[]) => events.map(e => e.kind)

// ─── Plumbing the rules rely on ──────────────────────────────

describe('Monitor plumbing', () => {
  it('prices exactly like the engine, for every symbol and minute (drift check)', () => {
    for (const s of SYMBOLS) for (let m = 0; m <= SESSION_MINUTES + 5; m++) {
      expect(px(s, m), `${s}@${m}`).toBe(getPriceAtMinute(s, m))
    }
  })

  it('sellResults reproduces the engine\'s realised P&L (150 random sessions, excluding the bell square-off)', () => {
    let checked = 0
    for (let seed = 1; seed <= 150; seed++) {
      const { live } = play(seed)
      if (live.currentMinute >= SESSION_MINUTES) continue   // square-off realises P&L without orders
      const total = sellResults(live.orders).reduce((sum, s) => sum + s.realised, 0)
      expect(total, `seed ${seed}`).toBeCloseTo(live.realisedPnL, 6)
      checked++
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('only accepted orders are judged: non-order actions and rejected orders give no events', () => {
    const j = drive([1, { type: 'PAUSE' }, { type: 'RESUME' }, { type: 'SET_ACTIVE', symbol: 'TCS' },
      sell('TCS', 10)])   // rejected: no position
    expect(j.live.orders.at(-1)?.status).toBe('REJECTED')
    expect(detect(j)).toEqual([])
  })

  it('a rejected order that WOULD match a rule (an oversized BUY beyond the cash) gives no event', () => {
    const j = drive([1, buy('INDIGO', qtyFor('INDIGO', 1, 150_000))])
    expect(j.live.orders.at(-1)).toMatchObject({ status: 'REJECTED', reason: 'Insufficient funds' })
    expect(detect(j)).toEqual([])
  })

  it('is deterministic and survives the JSON round trip (browser and server agree)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { entries } = play(seed)
      const a = monitorSession(entries, COV20_DATASET)
      expect(monitorSession(JSON.parse(JSON.stringify(entries)), COV20_DATASET), `seed ${seed}`).toEqual(a)
    }
  })

  it('every event points at the PLACE_ORDER entry that triggered it, at its minute', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { entries } = play(seed)
      for (const e of monitorSession(entries, COV20_DATASET)) {
        expect(entries[e.actionSeq].action.type).toBe('PLACE_ORDER')
        expect(entries[e.actionSeq].simMinute).toBe(e.simMinute)
      }
    }
  })
})

// ─── Claude's rules ──────────────────────────────────────────

describe('oversized_position', () => {
  it('fires above 30% of equity, with the share as a fact', () => {
    const j = drive([1, buy('INDIGO', qtyFor('INDIGO', 1, 40_000))])
    const [e] = detect(j)
    expect(e).toMatchObject({ kind: 'oversized_position', simMinute: 1, symbol: 'INDIGO', actionSeq: 1 })
    expect(e.facts.pctOfEquity).toBeGreaterThan(30)
    expect(e.facts.pctOfEquity).toBeLessThan(41)
    expect(e.summary).toMatch(/% of the account in one order/)
  })

  it('stays quiet at or below 30%', () => {
    expect(detect(drive([1, buy('INDIGO', qtyFor('INDIGO', 1, 29_000))]))).toEqual([])
  })
})

describe('overtrading', () => {
  // Start of a 30-minute stretch with no headline in or just before it (so news_reflex can't
  // interfere) and clear of the circuit halt (orders can't be placed while HALTED).
  const q = Array.from({ length: 300 }, (_, i) => i + 1)
    .find(m => !COV20_DATASET.news.some(n => n.fireAt >= m - 3 && n.fireAt <= m + 30) && (m + 30 < 76 || m > 93))!

  it('fixture exists', () => expect(q).toBeDefined())

  it('fires on the 5th order within 15 minutes', () => {
    const j = drive([q, buy('TCS', 1), 1, buy('TCS', 1), 1, buy('TCS', 1), 1, buy('TCS', 1), 1, buy('TCS', 1)])
    expect(detect(j)).toEqual([expect.objectContaining({ kind: 'overtrading', simMinute: q + 4, actionSeq: 5, facts: { ordersInWindow: 5, windowMinutes: 15 } })])
  })

  it('stays quiet for 4 orders, or 5 spread over more than 15 minutes', () => {
    expect(detect(drive([q, buy('TCS', 1), 1, buy('TCS', 1), 1, buy('TCS', 1), 1, buy('TCS', 1)]))).toEqual([])
    expect(detect(drive([q, buy('TCS', 1), 4, buy('TCS', 1), 4, buy('TCS', 1), 4, buy('TCS', 1), 4, buy('TCS', 1)]))).toEqual([])
  })

  it('cooldown: the same kind fires at most once per 15 minutes', () => {
    const steps: (number | ReturnType<typeof buy>)[] = [q - 1]
    for (let i = 0; i < 10; i++) steps.push(1, buy('TCS', 1))     // orders at minutes q..q+9
    steps.push(10, buy('TCS', 1))                                  // minute q+19
    const events = detect(drive(steps))
    expect(events.map(e => [e.kind, e.simMinute])).toEqual([['overtrading', q + 4], ['overtrading', q + 19]])
  })
})

describe('news_reflex', () => {
  // A headline with no other headline in the 3 minutes after it, outside the circuit halt.
  const news = COV20_DATASET.news.find(n => n.fireAt >= 2 && n.fireAt < 70 &&
    !COV20_DATASET.news.some(o => o !== n && o.fireAt > n.fireAt && o.fireAt <= n.fireAt + 3))!

  it('fixture exists', () => expect(news).toBeDefined())

  it('fires for an order within 2 minutes of a headline, with the headline as facts', () => {
    const [e] = detect(drive([news.fireAt + 1, buy('TCS', 1)]))
    expect(e).toMatchObject({ kind: 'news_reflex', simMinute: news.fireAt + 1 })
    expect(e.facts).toMatchObject({ newsId: news.id, minutesAfterNews: 1, classification: news.classification })
    expect(e.summary).toContain(news.headline)
  })

  it('a pause after the headline means the user stopped to think: no event', () => {
    expect(detect(drive([news.fireAt, { type: 'PAUSE' }, { type: 'RESUME' }, 1, buy('TCS', 1)]))).toEqual([])
  })

  it('a pause BEFORE the headline doesn\'t count', () => {
    const j = drive([news.fireAt - 1, { type: 'PAUSE' }, { type: 'RESUME' }, 2, buy('TCS', 1)])
    expect(kinds(detect(j))).toEqual(['news_reflex'])
  })

  it('stays quiet 3 minutes after', () => {
    expect(detect(drive([news.fireAt + 3, buy('TCS', 1)]))).toEqual([])
  })
})

describe('revenge_trade', () => {
  // Buy, then sell at a loss a few minutes later.
  const { symbol, minute } = findMoment('a 5-minute loss outside the halt', (s, m) => m + 5 < 70 && px(s, m + 5) < px(s, m) * 0.998)
  const sellAt = minute + 5
  const q = qtyFor(symbol, minute, 15_000)
  const lossTrade = [minute, buy(symbol, q), 5, sell(symbol, q)]

  it('fires for a bigger BUY within 10 minutes of a loss-making SELL', () => {
    const j = drive([...lossTrade, 2, buy('TCS', qtyFor('TCS', sellAt + 2, 25_000))])
    const e = detect(j).find(e => e.kind === 'revenge_trade')
    expect(e).toMatchObject({ simMinute: sellAt + 2, symbol: 'TCS' })
    expect(e!.facts).toMatchObject({ previousSymbol: symbol, minutesAfterLoss: 2 })
    expect(e!.facts.sizeMultiple).toBeGreaterThanOrEqual(T.revengeSizeMultiple)
    expect(e!.facts.previousLoss).toBeGreaterThan(0)
  })

  it('stays quiet for a small BUY, after the window, or after a profitable SELL', () => {
    expect(kinds(detect(drive([...lossTrade, 2, buy('TCS', 1)])))).not.toContain('revenge_trade')
    expect(kinds(detect(drive([...lossTrade, 11, buy('TCS', qtyFor('TCS', sellAt + 11, 25_000))])))).not.toContain('revenge_trade')
    const gain = findMoment('a 5-minute gain', (s, m) => m + 5 < 70 && px(s, m + 5) > px(s, m) * 1.002)
    const g = qtyFor(gain.symbol, gain.minute, 15_000)
    const j = drive([gain.minute, buy(gain.symbol, g), 5, sell(gain.symbol, g), 2, buy('TCS', qtyFor('TCS', gain.minute + 7, 25_000))])
    expect(kinds(detect(j))).not.toContain('revenge_trade')
  })

  it('priority: a BUY that is both revenge and oversized is reported as revenge_trade', () => {
    const j = drive([...lossTrade, 2, buy('TCS', qtyFor('TCS', sellAt + 2, 40_000))])
    const last = detect(j).at(-1)!
    expect(last.kind).toBe('revenge_trade')
    expect(last.simMinute).toBe(sellAt + 2)
  })
})
