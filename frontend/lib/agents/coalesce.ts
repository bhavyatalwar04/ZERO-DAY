// ============================================================================
// Client-side coalescing for decision events (roadmap 1.4, decision 4).
// No 'server-only': this runs in the browser, the one place a session lives.
// On Vercel, server instances don't share memory, so this can't live there.
//
// One run at a time. Events arriving while busy don't queue up: only the
// LATEST waits; any older waiting event is dropped and reported via onSkipped
// (Monitor still logged it; it just gets no AI feedback).
// ============================================================================

export interface Coalescer<E> {
  submit(event: E): void
  /** true while a run is in flight */
  readonly busy: boolean
}

export function createCoalescer<E, R>(opts: {
  run: (event: E) => Promise<R>
  onResult: (result: R, event: E) => void
  onSkipped?: (event: E) => void
  onError?: (err: unknown, event: E) => void
}): Coalescer<E> {
  let busy = false
  let waiting: E | null = null

  async function drain(first: E) {
    busy = true
    let current: E | null = first
    while (current !== null) {
      try {
        opts.onResult(await opts.run(current), current)
      } catch (err) {
        opts.onError?.(err, current)
      }
      current = waiting
      waiting = null
    }
    busy = false
  }

  return {
    submit(event) {
      if (!busy) { void drain(event); return }
      if (waiting !== null) opts.onSkipped?.(waiting)
      waiting = event
    },
    get busy() { return busy },
  }
}
