// The session journal: a log of every user action, recorded by the reducer itself.
//
// Why inside the reducer, not around dispatch: a log entry needs the sim minute
// the reducer *actually applied* the action at. Reading it from the last
// rendered state can be one TICK stale (React may queue a timer TICK and a
// click before re-rendering), and replay would then apply the click on the
// wrong bar. The wrapper sees exactly the state the reducer sees.
//
// The wrapper is pure (no clock, no randomness), so React StrictMode running it
// twice in development is harmless. It doesn't change the engine's behaviour:
// the wrapped reducer's result is passed through untouched.

export interface JournalEntry<A> {
  /** 0, 1, 2, … in reducer order. Matches session_actions.seq. */
  seq: number
  /** The engine's currentMinute when the reducer applied this action. */
  simMinute: number
  action: A
}

export interface Journaled<S, A> {
  live: S
  entries: JournalEntry<A>[]
}

/** Actions not recorded: TICKs are regenerated during replay. */
export const UNLOGGED_ACTIONS: readonly string[] = ['TICK']

export function emptyJournal<S, A>(live: S): Journaled<S, A> {
  return { live, entries: [] }
}

export function withJournal<S extends { currentMinute: number }, A extends { type: string }>(
  reducer: (state: S, action: A) => S,
) {
  return function journaledReducer(j: Journaled<S, A>, action: A): Journaled<S, A> {
    const live = reducer(j.live, action)
    if (UNLOGGED_ACTIONS.includes(action.type)) {
      // Keep identity on a no-op so React can skip the re-render.
      return live === j.live ? j : { ...j, live }
    }
    // Logged even when it changed nothing (e.g. RESUME while LIVE): attempts are
    // behavioural data, and replaying a no-op reproduces the same no-op.
    const entry: JournalEntry<A> = { seq: j.entries.length, simMinute: j.live.currentMinute, action }
    return { live, entries: [...j.entries, entry] }
  }
}
