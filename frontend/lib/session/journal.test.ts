import { describe, it, expect } from 'vitest'
import { emptyJournal, withJournal, type Journaled } from './journal'
import { replay, ReplayError, type ReplayEngine } from './replay'

// A tiny stand-in engine: a clock that only runs when not paused, and an ADD
// action whose effect depends on the minute it's applied at, so applying it on
// the wrong tick gives a different total.
interface S { currentMinute: number; paused: boolean; total: number }
type A =
  | { type: 'TICK' } | { type: 'PAUSE' } | { type: 'RESUME' }
  | { type: 'ADD'; n: number } | { type: 'JUMP'; to: number }

function reducer(s: S, a: A): S {
  switch (a.type) {
    case 'TICK': return s.paused ? s : { ...s, currentMinute: s.currentMinute + 1 }
    case 'PAUSE': return s.paused ? s : { ...s, paused: true }
    case 'RESUME': return s.paused ? { ...s, paused: false } : s
    case 'ADD': return { ...s, total: s.total + a.n * (s.currentMinute + 1) }
    case 'JUMP': return { ...s, currentMinute: a.to }
  }
}
const initialState = (): S => ({ currentMinute: 0, paused: false, total: 0 })
const TICK: A = { type: 'TICK' }
const engine: ReplayEngine<S, A> = { reducer, initialState, tick: TICK }
const journaled = withJournal(reducer)

function run(actions: A[]): Journaled<S, A> {
  return actions.reduce(journaled, emptyJournal<S, A>(initialState()))
}

describe('withJournal', () => {
  it('records each non-TICK action with the minute it was applied at, in order', () => {
    const j = run([TICK, TICK, { type: 'ADD', n: 1 }, TICK, { type: 'PAUSE' }])
    expect(j.entries).toEqual([
      { seq: 0, simMinute: 2, action: { type: 'ADD', n: 1 } },
      { seq: 1, simMinute: 3, action: { type: 'PAUSE' } },
    ])
  })

  it('passes the engine state through unchanged', () => {
    const actions: A[] = [TICK, { type: 'ADD', n: 2 }, TICK, { type: 'PAUSE' }, TICK]
    expect(run(actions).live).toEqual(actions.reduce(reducer, initialState()))
  })

  it('records the minute BEFORE the action (JUMP is logged at its starting minute)', () => {
    const j = run([TICK, { type: 'JUMP', to: 10 }])
    expect(j.entries[0].simMinute).toBe(1)
    expect(j.live.currentMinute).toBe(10)
  })

  it('logs a logged action even when it is a no-op', () => {
    const j = run([{ type: 'RESUME' }])
    expect(j.entries).toHaveLength(1)
  })

  it('keeps identity on a no-op TICK, so React can skip the render', () => {
    const paused = run([{ type: 'PAUSE' }])
    expect(journaled(paused, TICK)).toBe(paused)
  })

  it('is pure: applying the same action twice to the same input gives equal results (StrictMode)', () => {
    const j = run([TICK, { type: 'ADD', n: 3 }])
    expect(journaled(j, { type: 'ADD', n: 1 })).toEqual(journaled(j, { type: 'ADD', n: 1 }))
  })
})

describe('replay', () => {
  const session: A[] = [
    TICK, TICK, { type: 'ADD', n: 1 }, { type: 'ADD', n: 2 }, TICK,
    { type: 'PAUSE' }, TICK, TICK, { type: 'ADD', n: 5 }, { type: 'RESUME' }, TICK, TICK,
    { type: 'JUMP', to: 20 }, TICK, { type: 'ADD', n: 1 }, TICK, TICK,
  ]

  it('rebuilds the exact live state from the journal (after a JSON round trip, as from the DB)', () => {
    const live = run(session)
    const stored = JSON.parse(JSON.stringify(live.entries))
    expect(replay(engine, stored, { untilMinute: live.live.currentMinute })).toEqual(live.live)
  })

  it('testing the test: an entry shifted by one minute gives a different state', () => {
    const live = run(session)
    const shifted = live.entries.map(e => (e.seq === 0 ? { ...e, simMinute: e.simMinute - 1 } : e))
    expect(replay(engine, shifted, { untilMinute: live.live.currentMinute })).not.toEqual(live.live)
  })

  it('without untilMinute, stops at the last entry', () => {
    const live = run([TICK, { type: 'ADD', n: 1 }, TICK, TICK])
    expect(replay(engine, live.entries).currentMinute).toBe(1)
  })

  it('untilMinute stops quietly when time stops (session paused at the end)', () => {
    const live = run([TICK, { type: 'PAUSE' }])
    expect(replay(engine, live.entries, { untilMinute: 50 }).currentMinute).toBe(1)
  })

  it('rejects a log whose next entry is later than a stopped clock', () => {
    const entries = [
      { seq: 0, simMinute: 0, action: { type: 'PAUSE' } as A },
      { seq: 1, simMinute: 3, action: { type: 'ADD', n: 1 } as A },
    ]
    expect(() => replay(engine, entries)).toThrow(ReplayError)
    expect(() => replay(engine, entries)).toThrow(/time stopped at minute 0, but entry 1 is at minute 3/)
  })

  it('rejects an entry the clock has already passed', () => {
    const entries = [
      { seq: 0, simMinute: 0, action: { type: 'JUMP', to: 10 } as A },
      { seq: 1, simMinute: 5, action: { type: 'ADD', n: 1 } as A },
    ]
    expect(() => replay(engine, entries)).toThrow(/clock is already at 10/)
  })

  it('rejects a gap in seq', () => {
    const entries = [
      { seq: 0, simMinute: 0, action: { type: 'ADD', n: 1 } as A },
      { seq: 2, simMinute: 0, action: { type: 'ADD', n: 1 } as A },
    ]
    expect(() => replay(engine, entries)).toThrow(/expected seq 1, got 2/)
  })
})
