// Replay: rebuild a session's state from its journal (event sourcing, ADR-003).
//
// The journal stores user actions only. Between two entries, time moved by
// TICKs, one per simulated minute, so replay regenerates them: tick until the
// clock reaches the entry's simMinute, then apply the entry. Replay needs no
// knowledge of the engine's states: if a TICK doesn't advance the clock (the
// session is paused, closed, or not started) but the next entry is later, the
// log is inconsistent and replay says so rather than guessing.
//
// Faithful only if the reducer is pure: same state + action → same result.

import type { JournalEntry } from './journal'

export interface ReplayEngine<S extends { currentMinute: number }, A extends { type: string }> {
  reducer: (state: S, action: A) => S
  initialState: () => S
  tick: A
}

export class ReplayError extends Error {
  constructor(message: string, readonly seq: number | null) {
    super(message)
    this.name = 'ReplayError'
  }
}

export interface ReplayOptions {
  /** Keep ticking after the last entry until this minute (or until time stops). */
  untilMinute?: number
}

export interface ReplayStep<S, A> {
  entry: JournalEntry<A>
  /** State the reducer applied the entry to (after regenerating TICKs up to entry.simMinute). */
  before: S
  after: S
}

/**
 * Steps through the journal one entry at a time, exposing the state before and
 * after each action. Monitor (2.1) uses it to judge each decision in context.
 * Throws ReplayError on an inconsistent log, like replay().
 */
export function* replaySteps<S extends { currentMinute: number }, A extends { type: string }>(
  engine: ReplayEngine<S, A>,
  entries: readonly JournalEntry<A>[],
): Generator<ReplayStep<S, A>, S> {
  let state = engine.initialState()
  for (const [i, entry] of entries.entries()) {
    if (entry.seq !== i) throw new ReplayError(`expected seq ${i}, got ${entry.seq}`, entry.seq)
    state = tickTo(engine, state, entry.simMinute, entry.seq, true)
    if (state.currentMinute !== entry.simMinute) {
      throw new ReplayError(
        `entry ${entry.seq} is at minute ${entry.simMinute}, but the clock is already at ${state.currentMinute}`,
        entry.seq)
    }
    const before = state
    state = engine.reducer(state, entry.action)
    yield { entry, before, after: state }
  }
  return state
}

export function replay<S extends { currentMinute: number }, A extends { type: string }>(
  engine: ReplayEngine<S, A>,
  entries: readonly JournalEntry<A>[],
  opts: ReplayOptions = {},
): S {
  const steps = replaySteps(engine, entries)
  let r = steps.next()
  while (!r.done) r = steps.next()
  const state = r.value
  return opts.untilMinute === undefined ? state : tickTo(engine, state, opts.untilMinute, null, false)
}

/** Regenerates TICKs until the clock reaches `minute`. If time stops first: throw, or stop quietly. */
function tickTo<S extends { currentMinute: number }, A extends { type: string }>(
  engine: ReplayEngine<S, A>, start: S, minute: number, seq: number | null, mustReach: boolean,
): S {
  let state = start
  while (state.currentMinute < minute) {
    const next = engine.reducer(state, engine.tick)
    if (next.currentMinute <= state.currentMinute) {
      if (!mustReach) return state
      throw new ReplayError(
        `time stopped at minute ${state.currentMinute}, but entry ${seq} is at minute ${minute}`, seq)
    }
    state = next
  }
  return state
}
