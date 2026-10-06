// Test helpers for Monitor (imported only by *.test.ts files).
import type { LiveSessionState } from '@/types/live'
import { reducer, initialState, SESSION_MINUTES, SYMBOLS, type Action } from '@/lib/engine/live-reducer'
import { COV20_DATASET } from '@/lib/engine/cov20-dataset'
import { emptyJournal, withJournal, type Journaled } from '@/lib/session/journal'
import { priceAt } from './context'

const journaled = withJournal(reducer)
export const TICK: Action = { type: 'TICK' }

/** Plays START, then each step: a number = that many TICKs, otherwise an action. */
export function drive(steps: (Action | number)[]): Journaled<LiveSessionState, Action> {
  let j = journaled(emptyJournal<LiveSessionState, Action>(initialState()), { type: 'START' })
  for (const step of steps) {
    if (typeof step === 'number') for (let i = 0; i < step; i++) j = journaled(j, TICK)
    else j = journaled(j, step)
  }
  return j
}

/** Ticks needed to go from the current minute of `steps` to `minute`. */
export const ticksTo = (from: number, to: number) => Math.max(0, to - from)

const order = (side: 'BUY' | 'SELL', symbol: string, quantity: number): Action => ({
  type: 'PLACE_ORDER', order: { symbol, side, type: 'MARKET', validity: 'DAY', quantity },
})
export const buy = (symbol: string, quantity: number) => order('BUY', symbol, quantity)
export const sell = (symbol: string, quantity: number) => order('SELL', symbol, quantity)

export const px = (symbol: string, minute: number) => priceAt(COV20_DATASET, symbol, minute)

/** Quantity whose notional at `minute` is about `amount`. */
export const qtyFor = (symbol: string, minute: number, amount: number) => Math.max(1, Math.floor(amount / px(symbol, minute)))

/** First (symbol, minute) in COV-20 satisfying `pred`, scanning minutes in [from, to). Throws if none: the fixture must exist. */
export function findMoment(what: string, pred: (symbol: string, minute: number) => boolean, from = 1, to = SESSION_MINUTES - 1) {
  for (let m = from; m < to; m++) for (const s of SYMBOLS) if (pred(s, m)) return { symbol: s, minute: m }
  throw new Error(`No COV-20 moment found for: ${what}`)
}

export { COV20_DATASET, SYMBOLS }
