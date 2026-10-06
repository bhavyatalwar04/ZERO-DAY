import { describe, it, expect } from 'vitest'
import { reducer, initialState, type Action } from '@/lib/engine/live-reducer'
import { replay } from './replay'
import { play } from './test-sessions'

// Fidelity test for the real engine: play random sessions through the journaled
// reducer, then rebuild each one from its journal alone (after a JSON round trip,
// as it would come back from session_actions) and require the same state.
// This only passes if the reducer is pure — it fails while order ids come from
// Date.now()/Math.random() (AUDIT §1.4 #5, fixed 2026-10-02).

const engine = { reducer, initialState, tick: { type: 'TICK' } as Action }

describe('replay against the real engine (3.3)', () => {
  const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1)
  const sessions = SEEDS.map(play)

  it('rebuilds every random session exactly from its journal', () => {
    for (const [i, j] of sessions.entries()) {
      const stored = JSON.parse(JSON.stringify(j.entries))
      const rebuilt = replay(engine, stored, { untilMinute: j.live.currentMinute })
      expect(rebuilt, `seed ${SEEDS[i]}`).toEqual(j.live)
    }
  })

  it('testing the test: the random sessions exercise the hard paths', () => {
    const all = sessions.map(j => j.live)
    const orders = all.flatMap(s => s.orders)
    expect(all.some(s => s.status === 'CLOSED' && s.currentMinute === 375), 'closed by the bell').toBe(true)
    expect(all.some(s => s.status === 'CLOSED' && s.currentMinute < 375), 'ended early').toBe(true)
    expect(sessions.some(j => j.entries.some(e => e.action.type === 'SKIP_HALT' && e.simMinute >= 77 && e.simMinute < 92)),
      'skipped a real halt').toBe(true)
    expect(orders.some(o => o.type === 'LIMIT' && o.status === 'FILLED' && o.filledAtMin! > o.placedAtMin), 'limit filled later').toBe(true)
    expect(orders.some(o => o.status === 'CANCELLED'), 'cancelled an order').toBe(true)
    expect(orders.some(o => o.status === 'REJECTED'), 'rejected an order').toBe(true)
  })
})
