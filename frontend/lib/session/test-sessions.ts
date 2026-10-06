// Random play-throughs of the real engine, for property-style tests (3.3, 2.1).
// Imported only by *.test.ts files.
import { reducer, initialState, type Action } from '@/lib/engine/live-reducer'
import { COV20_TIMELINE } from '@/lib/data/scenarios/cov-20/timeline'
import type { LiveSessionState } from '@/types/live'
import { emptyJournal, withJournal, type Journaled } from './journal'

const TICK: Action = { type: 'TICK' }
const journaled = withJournal(reducer)
const SYMBOLS = Object.keys(COV20_TIMELINE)

export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomAction(s: LiveSessionState, rand: () => number): Action {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
  const symbol = pick(SYMBOLS)
  const bars = COV20_TIMELINE[symbol].bars
  const ref = bars[Math.min(bars.length - 1, Math.floor(s.currentMinute / 5))].close
  const near = () => Math.round(ref * (0.97 + rand() * 0.06) * 100) / 100
  const r = rand()
  if (r < 0.40) {
    const type = pick(['MARKET', 'LIMIT', 'SL', 'SL-M'] as const)
    const side = rand() < 0.6 ? 'BUY' as const : 'SELL' as const
    return {
      type: 'PLACE_ORDER',
      order: {
        symbol, side, type, validity: 'DAY', quantity: 1 + Math.floor(rand() * 40),
        ...(type !== 'MARKET' && type !== 'SL-M' ? { price: near() } : {}),
        ...(type === 'SL' || type === 'SL-M' ? { triggerPrice: near() } : {}),
      },
    }
  }
  if (r < 0.52) {
    const pending = s.orders.filter(o => o.status === 'PENDING')
    return { type: 'CANCEL_ORDER', id: pending.length && rand() < 0.8 ? pick(pending).id : 'no-such-order' }
  }
  if (r < 0.58) return { type: 'PAUSE' }
  if (r < 0.72) return { type: 'RESUME' }
  if (r < 0.77) return { type: 'SET_SPEED', speed: pick([1, 5, 10] as const) }
  if (r < 0.83) return { type: 'SET_ACTIVE', symbol }
  if (r < 0.89) return { type: 'SET_STOP', symbol, stopPrice: rand() < 0.3 ? null : near() }
  if (r < 0.94) return { type: 'SKIP_HALT' }
  if (r < 0.995) return { type: 'MARK_COACH_SHOWN', coach: pick(['orderType', 'stopLoss', 'sizing'] as const) }
  return { type: 'END' }
}

/** One simulated play-through: START, then ticks interleaved with random user actions. */
export function play(seed: number): Journaled<LiveSessionState, Action> {
  const rand = mulberry32(seed)
  let j = journaled(emptyJournal<LiveSessionState, Action>(initialState()), { type: 'START' })
  for (let i = 0; i < 900 && j.live.status !== 'CLOSED'; i++) {
    j = journaled(j, rand() < 0.7 ? TICK : randomAction(j.live, rand))
  }
  return j
}
